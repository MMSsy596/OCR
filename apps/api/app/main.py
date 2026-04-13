import asyncio
import json
import logging
import shutil
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .auth import require_api_auth
from .db import Base, SessionLocal, engine, ensure_runtime_indexes, get_db
from .downloader import run_url_ingest_job
from .exporter import export_subtitle_file
from .models import JobStatus
from .pipeline import retranslate_project_segments, run_pipeline
from .queue import get_queue
from .settings import get_settings
from .tts_dubber import run_dub_job

settings = get_settings()
settings.storage_path.mkdir(parents=True, exist_ok=True)
web_dist_dir = Path(__file__).resolve().parents[1] / "web_dist"
web_index_file = web_dist_dir / "index.html"
logger = logging.getLogger("solar.ocr.api")

app = FastAPI(
    title=settings.app_name,
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts_list or ["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys([
        settings.web_origin,
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
    ])),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_api_auth(request, call_next):
    await require_api_auth(request)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Cache-Control", "no-store")
    if settings.is_production:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


@app.on_event("startup")
def on_startup() -> None:
    settings.validate_production_guard()
    Base.metadata.create_all(bind=engine)
    ensure_runtime_indexes()
    settings.storage_path.mkdir(parents=True, exist_ok=True)


@app.get("/health")
def health():
    return {"ok": True, "environment": settings.environment}


@app.get("/runtime/capabilities")
def runtime_capabilities():
    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    whisper_path = shutil.which("whisper")
    if not whisper_path:
        venv_whisper = Path(sys.executable).parent / "whisper.exe"
        if venv_whisper.exists():
            whisper_path = str(venv_whisper)
            
    audio_ready = bool(ffmpeg_path and whisper_path)
    return {
        "input_modes": {
            "video_ocr": {
                "available": True,
                "label": "OCR từ khung hình video",
            },
            "audio_asr": {
                "available": audio_ready,
                "label": "Nhận diện từ âm thanh",
                "requires": ["ffmpeg", "whisper"],
            },
        },
        "tools": {
            "ffmpeg": {"available": bool(ffmpeg_path), "path": ffmpeg_path or ""},
            "ffprobe": {"available": bool(ffprobe_path), "path": ffprobe_path or ""},
            "whisper": {"available": bool(whisper_path), "path": whisper_path or ""},
        },
        "recommendations": {
            "audio_asr_ready": audio_ready,
            "audio_asr_hint": (
                "Có thể dùng mode âm thanh ngay."
                if audio_ready
                else "Cần cài ffmpeg và whisper CLI để dùng mode âm thanh."
            ),
        },
    }


def _enforce_upload_constraints(file: UploadFile, request_headers: dict[str, str] | None = None) -> None:
    # Disable size checking temporarily
    # max_bytes = max(1, int(settings.max_upload_size_mb or 512)) * 1024 * 1024
    # headers = request_headers or {}
    # content_length = headers.get("content-length") or headers.get("Content-Length") or ""
    # if content_length.isdigit() and int(content_length) > max_bytes:
    #     raise HTTPException(status_code=413, detail="file_too_large")

    ext = (Path(file.filename or "").suffix or "").lower()
    allowed_exts = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
    if ext and ext not in allowed_exts:
        raise HTTPException(status_code=400, detail="unsupported_video_format")


def _enqueue_pipeline_job(job_id: str, payload: schemas.PipelineStartRequest) -> None:
    import os
    if os.name == "nt":
        raise NotImplementedError("RQ queue not supported on Windows. Falling back to background threads.")
    q = get_queue()
    q.enqueue(
        "app.pipeline.run_pipeline",
        job_id,
        input_mode=payload.input_mode,
        gemini_api_key=payload.gemini_api_key,
        voice_map=payload.voice_map,
        scan_interval_sec=payload.scan_interval_sec,
        audio_provider=payload.audio_provider,
        audio_asr_model=payload.audio_asr_model,
        audio_asr_language=payload.audio_asr_language,
        audio_chunk_sec=payload.audio_chunk_sec,
        audio_chunk_overlap_sec=payload.audio_chunk_overlap_sec,
        job_id=job_id,
    )


def _run_job_in_background(label: str, target, *args, **kwargs) -> None:
    def _runner() -> None:
        try:
            target(*args, **kwargs)
        except Exception:
            logger.exception("Background fallback job failed: %s", label)

    threading.Thread(target=_runner, name=f"solar-{label}", daemon=True).start()


def _resolve_in_dir(base_dir: Path, relative_name: str) -> Path:
    target = (base_dir / relative_name).resolve()
    try:
        target.relative_to(base_dir.resolve())
    except ValueError as ex:
        raise HTTPException(status_code=400, detail="invalid_path") from ex
    return target


def _resolve_storage_artifact(path_text: str) -> Path:
    artifact_path = Path(path_text).resolve()
    try:
        artifact_path.relative_to(settings.storage_path.resolve())
    except ValueError as ex:
        raise HTTPException(status_code=400, detail="artifact_outside_storage") from ex
    return artifact_path


def _enqueue_dub_job(job_id: str, payload: schemas.DubStartRequest) -> None:
    import os
    if os.name == "nt":
        raise NotImplementedError("RQ queue not supported on Windows. Falling back to background threads.")
    q = get_queue()
    q.enqueue(
        "app.tts_dubber.run_dub_job",
        job_id,
        srt_key=payload.srt_key,
        output_format=payload.output_format,
        voice=payload.voice,
        rate=payload.rate,
        volume=payload.volume,
        pitch=payload.pitch,
        match_video_duration=payload.match_video_duration,
        job_id=job_id,
        job_timeout=14400,
    )


def _cleanup_project_generated_files(project_dir: Path, keep_source: Path | None = None) -> None:
    storage_root = settings.storage_path.resolve()

    def _is_safe(path_obj: Path) -> bool:
        try:
            path_obj.resolve().relative_to(storage_root)
            return True
        except ValueError:
            return False

    keep_resolved = keep_source.resolve() if keep_source else None

    for src in project_dir.glob("source.*"):
        if keep_resolved and src.resolve() == keep_resolved:
            continue
        if src.is_file() and _is_safe(src):
            src.unlink(missing_ok=True)

    for pattern in ("output.*", "manual.*", "tts_lines.txt"):
        for item in project_dir.glob(pattern):
            if keep_resolved and item.resolve() == keep_resolved:
                continue
            if item.is_file() and _is_safe(item):
                item.unlink(missing_ok=True)

    dub_tmp = project_dir / "_dub_tmp"
    if dub_tmp.exists() and dub_tmp.is_dir() and _is_safe(dub_tmp):
        shutil.rmtree(dub_tmp, ignore_errors=True)


def _enqueue_url_ingest_job(job_id: str, payload: schemas.UrlIngestStartRequest) -> None:
    q = get_queue()
    q.enqueue(
        "app.downloader.run_url_ingest_job",
        job_id,
        source_url=payload.source_url,
        auto_start_pipeline=payload.auto_start_pipeline,
        input_mode=payload.input_mode,
        gemini_api_key=payload.gemini_api_key,
        voice_map=payload.voice_map,
        scan_interval_sec=payload.scan_interval_sec,
        audio_provider=payload.audio_provider,
        audio_asr_model=payload.audio_asr_model,
        audio_asr_language=payload.audio_asr_language,
        audio_chunk_sec=payload.audio_chunk_sec,
        audio_chunk_overlap_sec=payload.audio_chunk_overlap_sec,
        job_id=job_id,
        job_timeout=14400,
    )


def _is_job_queue_stale(job: models.PipelineJob, timeout_sec: int, now_utc: datetime | None = None) -> bool:
    if job.status != JobStatus.queued:
        return False
    if timeout_sec <= 0:
        return False
    base_time = job.updated_at or job.created_at
    if base_time is None:
        return False
    if base_time.tzinfo is None:
        base_time = base_time.replace(tzinfo=timezone.utc)
    now_ref = now_utc or datetime.now(timezone.utc)
    return (now_ref - base_time).total_seconds() >= float(timeout_sec)


def _mark_stale_queued_jobs(db: Session, jobs: list[models.PipelineJob]) -> bool:
    timeout_sec = max(30, int(settings.queue_stale_timeout_sec or 180))
    now_utc = datetime.now(timezone.utc)
    changed = False
    for job in jobs:
        if not _is_job_queue_stale(job, timeout_sec=timeout_sec, now_utc=now_utc):
            continue
        artifacts = dict(job.artifacts) if isinstance(job.artifacts, dict) else {}
        stale_meta = artifacts.get("stale_queue", {}) if isinstance(artifacts.get("stale_queue"), dict) else {}
        stale_meta.update(
            {
                "marked_at": now_utc.isoformat(),
                "timeout_sec": timeout_sec,
                "queued_created_at": str(job.created_at or ""),
                "queued_updated_at": str(job.updated_at or ""),
            }
        )
        artifacts["stale_queue"] = stale_meta
        artifacts["last_event"] = {
            "time": now_utc.isoformat(),
            "phase": "queue",
            "level": "warning",
            "progress": int(job.progress or 0),
            "message": f"Job queued qua han {timeout_sec}s, danh dau stale_queue_timeout.",
        }
        job.artifacts = artifacts
        job.status = JobStatus.failed
        job.step = "stale_queue_timeout"
        job.error_message = "stale_queue_timeout"
        db.add(job)
        changed = True
    if changed:
        db.commit()
    return changed


@app.post("/projects", response_model=schemas.ProjectRead)
def create_project(payload: schemas.ProjectCreate, db: Session = Depends(get_db)):
    project = crud.create_project(db, payload)
    return _to_project_read(project)


@app.get("/projects", response_model=list[schemas.ProjectRead])
def list_projects(db: Session = Depends(get_db)):
    projects = crud.list_projects(db)
    return [_to_project_read(p) for p in projects]


@app.post("/projects/clear-sessions", response_model=schemas.ClearSessionsResponse)
def clear_sessions(payload: schemas.ClearSessionsRequest, db: Session = Depends(get_db)):
    deleted_ids, skipped_processing = crud.clear_sessions(
        db,
        include_processing=payload.include_processing,
    )
    removed_storage_dirs = 0
    failed_storage_dirs: list[str] = []
    if payload.delete_storage:
        storage_root = settings.storage_path.resolve()
        for project_id in deleted_ids:
            candidate = (settings.storage_path / project_id).resolve()
            try:
                candidate.relative_to(storage_root)
            except ValueError:
                failed_storage_dirs.append(str(candidate))
                continue
            if candidate.exists():
                try:
                    shutil.rmtree(candidate)
                    removed_storage_dirs += 1
                except Exception:
                    failed_storage_dirs.append(str(candidate))
    return schemas.ClearSessionsResponse(
        deleted_projects=len(deleted_ids),
        deleted_project_ids=deleted_ids,
        skipped_processing_projects=skipped_processing,
        removed_storage_dirs=removed_storage_dirs,
        failed_storage_dirs=failed_storage_dirs,
    )


@app.get("/projects/{project_id}", response_model=schemas.ProjectRead)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    return _to_project_read(project)


@app.patch("/projects/{project_id}", response_model=schemas.ProjectRead)
def update_project(project_id: str, payload: schemas.ProjectUpdate, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    project = crud.update_project(db, project, payload)
    return _to_project_read(project)


@app.post("/projects/{project_id}/upload", response_model=schemas.ProjectRead)
def upload_video(project_id: str, request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    _enforce_upload_constraints(file, dict(request.headers))
    project_dir = settings.storage_path / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "video.mp4").suffix or ".mp4"
    target = project_dir / f"source{ext}"

    # Seek to start in case it's not at 0
    file.file.seek(0)
    
    with target.open("wb") as f:
        shutil.copyfileobj(file.file, f)
        
    _cleanup_project_generated_files(project_dir, keep_source=target)
    project = crud.attach_video(db, project, target)
    return _to_project_read(project)


@app.post("/projects/{project_id}/ingest-url/start", response_model=schemas.JobRead)
def start_url_ingest(project_id: str, payload: schemas.UrlIngestStartRequest, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if not payload.source_url or not payload.source_url.strip():
        raise HTTPException(status_code=400, detail="source_url_required")

    job = crud.create_job(db, project_id)
    job.artifacts = {
        "job_kind": "url_ingest",
        "request_payload": payload.model_dump(),
    }
    db.add(job)
    db.commit()
    db.refresh(job)

    try:
        _enqueue_url_ingest_job(job.id, payload)
    except Exception:
        _run_job_in_background(
            f"url-ingest-{job.id}",
            run_url_ingest_job,
            job.id,
            source_url=payload.source_url,
            auto_start_pipeline=payload.auto_start_pipeline,
            gemini_api_key=payload.gemini_api_key,
            voice_map=payload.voice_map,
            scan_interval_sec=payload.scan_interval_sec,
        )
    return job


@app.post("/projects/{project_id}/srt/upload", response_model=schemas.SrtUploadResponse)
def upload_srt_file(project_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    project_dir = settings.storage_path / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    src_name = Path(file.filename or "manual.external.srt")
    ext = src_name.suffix.lower()
    if ext != ".srt":
        raise HTTPException(status_code=400, detail="srt_required")

    stem = src_name.stem.strip() or "manual.external"
    safe_stem = "".join(ch if (ch.isalnum() or ch in {"-", "_", "."}) else "_" for ch in stem)[:80].strip("._")
    safe_stem = safe_stem or "manual.external"
    output_key = f"{safe_stem}.srt"
    output_path = project_dir / output_key
    with output_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return schemas.SrtUploadResponse(
        output_key=output_key,
        output_path=str(output_path),
    )


@app.get("/projects/{project_id}/video")
def stream_video(project_id: str, request: Request, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if not project.video_path:
        raise HTTPException(status_code=404, detail="video_not_found")
    video_path = Path(project.video_path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="video_missing")
        
    file_size = video_path.stat().st_size
    range_header = request.headers.get("Range")
    
    if not range_header:
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": "video/mp4",
        }
        return FileResponse(path=video_path, headers=headers)
        
    try:
        range_match = range_header.replace("bytes=", "").split("-")
        start = int(range_match[0]) if range_match[0] else 0
        end = int(range_match[1]) if len(range_match) > 1 and range_match[1] else file_size - 1
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid_range")

    if start >= file_size or end >= file_size:
        from fastapi import Response
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})
        
    chunk_size = end - start + 1
    
    def file_iterator(path, offset, bytes_to_read):
        with open(path, "rb") as f:
            f.seek(offset)
            chunk = 1024 * 1024  # 1MB chunks
            while bytes_to_read > 0:
                data = f.read(min(chunk, bytes_to_read))
                if not data:
                    break
                yield data
                bytes_to_read -= len(data)

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(chunk_size),
        "Content-Type": "video/mp4",
    }
    return StreamingResponse(
        file_iterator(video_path, start, chunk_size),
        headers=headers,
        status_code=206
    )


@app.post("/projects/{project_id}/pipeline/start", response_model=schemas.JobRead)
def start_pipeline(project_id: str, payload: schemas.PipelineStartRequest, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if not project.video_path:
        raise HTTPException(status_code=400, detail="video_required")

    job = crud.create_job(db, project_id)
    job.artifacts = {
        "job_kind": "pipeline",
        "request_payload": payload.model_dump(),
    }
    db.add(job)
    db.commit()
    db.refresh(job)
    try:
        _enqueue_pipeline_job(job.id, payload)
    except Exception:
        _run_job_in_background(
            f"pipeline-{job.id}",
            run_pipeline,
            job.id,
            input_mode=payload.input_mode,
            gemini_api_key=payload.gemini_api_key,
            voice_map=payload.voice_map,
            scan_interval_sec=payload.scan_interval_sec,
            audio_provider=payload.audio_provider,
            audio_asr_model=payload.audio_asr_model,
            audio_asr_language=payload.audio_asr_language,
            audio_chunk_sec=payload.audio_chunk_sec,
            audio_chunk_overlap_sec=payload.audio_chunk_overlap_sec,
        )
    return job


@app.post("/projects/{project_id}/dub/start", response_model=schemas.JobRead)
def start_dub(project_id: str, payload: schemas.DubStartRequest, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if not project.video_path:
        raise HTTPException(status_code=400, detail="video_required")

    job = crud.create_job(db, project_id)
    job.artifacts = {
        "job_kind": "dub",
        "request_payload": payload.model_dump(),
    }
    db.add(job)
    db.commit()
    db.refresh(job)
    try:
        _enqueue_dub_job(job.id, payload)
    except Exception:
        _run_job_in_background(
            f"dub-{job.id}",
            run_dub_job,
            job.id,
            srt_key=payload.srt_key,
            output_format=payload.output_format,
            voice=payload.voice,
            rate=payload.rate,
            volume=payload.volume,
            pitch=payload.pitch,
            match_video_duration=payload.match_video_duration,
        )
    return job


@app.get("/projects/{project_id}/segments", response_model=list[schemas.SegmentRead])
def get_segments(project_id: str, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    return crud.list_segments(db, project_id)


@app.put("/projects/{project_id}/segments", response_model=list[schemas.SegmentRead])
def save_segments(project_id: str, payload: list[schemas.SegmentUpdate], db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    updates = [item.model_dump() for item in payload]
    return crud.update_segments(db, project_id, updates)


@app.post("/projects/{project_id}/segments/retranslate", response_model=schemas.RetranslateResponse)
def retranslate_segments(project_id: str, payload: schemas.RetranslateRequest, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    result = retranslate_project_segments(project_id, gemini_api_key=payload.gemini_api_key)
    if not result.get("ok"):
        raise HTTPException(status_code=500, detail=result.get("error", "retranslate_failed"))
    return schemas.RetranslateResponse(
        translation_stats=result.get("translation_stats", {"gemini": 0, "deep_translator": 0, "fallback_tag": 0}),
        translation_error_hint=result.get("translation_error_hint", ""),
        segments=result.get("segments", []),
    )


@app.post("/projects/{project_id}/export", response_model=schemas.ExportResponse)
def export_project(project_id: str, payload: schemas.ExportRequest, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if not project.video_path:
        raise HTTPException(status_code=400, detail="video_required")

    segments = crud.list_segments(db, project_id)
    if not segments:
        raise HTTPException(status_code=400, detail="segments_required")

    fmt = payload.export_format.lower().strip()
    mode = payload.content_mode.lower().strip()
    if fmt not in {"srt", "vtt", "csv", "txt", "json"}:
        raise HTTPException(status_code=400, detail="invalid_export_format")
    if mode not in {"raw", "translated", "bilingual"}:
        raise HTTPException(status_code=400, detail="invalid_content_mode")

    project_dir = Path(project.video_path).parent
    output_key = f"manual.{mode}.{fmt}"
    output_path = _resolve_in_dir(project_dir, output_key)

    export_subtitle_file(
        segments=[{"start_sec": s.start_sec, "end_sec": s.end_sec, "raw_text": s.raw_text, "translated_text": s.translated_text} for s in segments],
        output_path=output_path,
        export_format=fmt,
        content_mode=mode,
    )
    return schemas.ExportResponse(
        output_key=output_key,
        download_url=f"/projects/{project_id}/exports/{output_key}",
        output_path=str(output_path),
    )


@app.get("/projects/{project_id}/exports/{output_key}")
def download_project_export(project_id: str, output_key: str, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if not project.video_path:
        raise HTTPException(status_code=404, detail="video_not_found")
    project_dir = Path(project.video_path).parent
    file_path = _resolve_in_dir(project_dir, output_key)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="export_not_found")
    return FileResponse(path=file_path, filename=file_path.name)


@app.get("/projects/{project_id}/jobs", response_model=list[schemas.JobRead])
def list_project_jobs(project_id: str, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    jobs = crud.list_jobs(db, project_id)
    if _mark_stale_queued_jobs(db, jobs):
        jobs = crud.list_jobs(db, project_id)
    return jobs


@app.post("/projects/{project_id}/jobs/retry-stuck", response_model=schemas.RetryJobsResponse)
def retry_stuck_jobs(project_id: str, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if not project.video_path:
        raise HTTPException(status_code=400, detail="video_required")

    jobs = crud.list_jobs(db, project_id)
    if _mark_stale_queued_jobs(db, jobs):
        jobs = crud.list_jobs(db, project_id)
    stuck = [
        job
        for job in jobs
        if job.status in {JobStatus.queued, JobStatus.failed}
        and (job.progress or 0) < 100
    ]

    retried_from: list[str] = []
    created: list[str] = []
    skipped = 0

    for old_job in stuck:
        artifacts = old_job.artifacts if isinstance(old_job.artifacts, dict) else {}
        kind = artifacts.get("job_kind", "")
        request_payload = artifacts.get("request_payload", {}) if isinstance(artifacts.get("request_payload"), dict) else {}

        if kind == "dub":
            payload = schemas.DubStartRequest(**request_payload) if request_payload else schemas.DubStartRequest()
        elif kind in {"pipeline", ""}:
            payload = schemas.PipelineStartRequest(**request_payload) if request_payload else schemas.PipelineStartRequest()
            kind = "pipeline"
        else:
            skipped += 1
            continue

        new_job = crud.create_job(db, project_id)
        new_job.artifacts = {
            "job_kind": kind,
            "request_payload": payload.model_dump(),
            "retried_from_job_id": old_job.id,
        }
        db.add(new_job)
        old_job.status = JobStatus.failed
        old_job.step = "superseded"
        old_job.error_message = f"superseded_by_retry:{new_job.id}"
        db.add(old_job)
        db.commit()
        db.refresh(new_job)

        try:
            if kind == "dub":
                _enqueue_dub_job(new_job.id, payload)  # type: ignore[arg-type]
            else:
                _enqueue_pipeline_job(new_job.id, payload)  # type: ignore[arg-type]
        except Exception:
            if kind == "dub":
                run_dub_job(
                    new_job.id,
                    srt_key=payload.srt_key,  # type: ignore[attr-defined]
                    output_format=payload.output_format,  # type: ignore[attr-defined]
                    voice=payload.voice,  # type: ignore[attr-defined]
                    rate=payload.rate,  # type: ignore[attr-defined]
                    volume=payload.volume,  # type: ignore[attr-defined]
                    pitch=payload.pitch,  # type: ignore[attr-defined]
                    match_video_duration=payload.match_video_duration,  # type: ignore[attr-defined]
                )
            else:
                run_pipeline(
                    new_job.id,
                    input_mode=payload.input_mode,  # type: ignore[attr-defined]
                    gemini_api_key=payload.gemini_api_key,  # type: ignore[attr-defined]
                    voice_map=payload.voice_map,  # type: ignore[attr-defined]
                    scan_interval_sec=payload.scan_interval_sec,  # type: ignore[attr-defined]
                    audio_provider=payload.audio_provider,  # type: ignore[attr-defined]
                    audio_asr_model=payload.audio_asr_model,  # type: ignore[attr-defined]
                    audio_asr_language=payload.audio_asr_language,  # type: ignore[attr-defined]
                    audio_chunk_sec=payload.audio_chunk_sec,  # type: ignore[attr-defined]
                    audio_chunk_overlap_sec=payload.audio_chunk_overlap_sec,  # type: ignore[attr-defined]
                )

        retried_from.append(old_job.id)
        created.append(new_job.id)

    return schemas.RetryJobsResponse(
        retried_count=len(created),
        retried_from_job_ids=retried_from,
        created_job_ids=created,
        skipped_count=skipped,
    )


@app.get("/jobs/{job_id}", response_model=schemas.JobRead)
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")
    _mark_stale_queued_jobs(db, [job])
    db.refresh(job)
    return job


@app.get("/jobs/{job_id}/artifact/{artifact_key}")
def download_artifact(job_id: str, artifact_key: str, db: Session = Depends(get_db)):
    job = crud.get_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")
    if not isinstance(job.artifacts, dict):
        raise HTTPException(status_code=404, detail="artifact_not_found")
    artifact = job.artifacts.get(artifact_key)
    if not artifact:
        raise HTTPException(status_code=404, detail="artifact_not_found")
    artifact_path = _resolve_storage_artifact(str(artifact))
    if not artifact_path.exists():
        raise HTTPException(status_code=404, detail="artifact_missing")
    return FileResponse(path=artifact_path, filename=artifact_path.name)


def _to_project_read(project: models.Project) -> schemas.ProjectRead:
    return schemas.ProjectRead(
        id=project.id,
        name=project.name,
        source_lang=project.source_lang,
        target_lang=project.target_lang,
        status=project.status.value,
        video_path=project.video_path,
        roi=schemas.ROI(x=project.roi_x, y=project.roi_y, w=project.roi_w, h=project.roi_h),
        prompt=project.prompt,
        glossary=project.glossary,
    )


def _job_to_job_read(job: models.PipelineJob) -> schemas.JobRead:
    return schemas.JobRead.model_validate(job)


def _build_project_snapshot(project_id: str) -> dict:
    db = SessionLocal()
    try:
        project = crud.get_project(db, project_id)
        if not project:
            return {"type": "project_missing", "project_id": project_id}
        jobs = crud.list_jobs(db, project_id)
        if _mark_stale_queued_jobs(db, jobs):
            jobs = crud.list_jobs(db, project_id)
        return {
            "type": "snapshot",
            "project": _to_project_read(project).model_dump(),
            "jobs": [_job_to_job_read(job).model_dump() for job in jobs],
        }
    finally:
        db.close()


@app.get("/projects/{project_id}/stream")
async def stream_project(project_id: str):
    initial = _build_project_snapshot(project_id)
    if initial.get("type") == "project_missing":
        raise HTTPException(status_code=404, detail="project_not_found")

    async def _event_generator():
        last_payload = ""
        heartbeat_every = 15
        tick = 0
        while True:
            snapshot = _build_project_snapshot(project_id)
            payload = json.dumps(snapshot, ensure_ascii=False)
            if payload != last_payload:
                last_payload = payload
                yield f"data: {payload}\n\n"
            elif tick % heartbeat_every == 0:
                yield ": keepalive\n\n"
            tick += 1
            await asyncio.sleep(2.0)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.get("/{full_path:path}", include_in_schema=False)
def serve_web_app(full_path: str):
    if not web_index_file.exists():
        raise HTTPException(status_code=404, detail="not_found")

    target = (web_dist_dir / full_path).resolve()
    if full_path:
        try:
            target.relative_to(web_dist_dir.resolve())
        except ValueError:
            raise HTTPException(status_code=404, detail="not_found")
        if target.is_file():
            return FileResponse(path=target)

    return FileResponse(path=web_index_file, media_type="text/html")

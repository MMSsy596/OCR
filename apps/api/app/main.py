import asyncio
import json
import logging
import shutil
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .auth import require_api_auth
from .capcut_exporter import export_to_capcut
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
    return {
        "input_modes": {
            "video_ocr": {
                "available": True,
                "label": "OCR từ khung hình video",
            },
        },
        "tools": {
            "ffmpeg": {"available": bool(ffmpeg_path), "path": ffmpeg_path or ""},
            "ffprobe": {"available": bool(ffprobe_path), "path": ffprobe_path or ""},
        },
        "recommendations": {},
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
        gemini_models=getattr(payload, "gemini_models", None),
        voice_map=payload.voice_map,
        scan_interval_sec=payload.scan_interval_sec,
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
        tts_engine=payload.tts_engine,
        fpt_api_key=payload.fpt_api_key,
        fpt_voice=payload.fpt_voice,
        fpt_speed=payload.fpt_speed,
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
            input_mode=payload.input_mode,
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
            gemini_models=payload.gemini_models,
            voice_map=payload.voice_map,
            scan_interval_sec=payload.scan_interval_sec,
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
            tts_engine=payload.tts_engine,
            fpt_api_key=payload.fpt_api_key,
            fpt_voice=payload.fpt_voice,
            fpt_speed=payload.fpt_speed,
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
    result = retranslate_project_segments(project_id, gemini_api_key=payload.gemini_api_key, gemini_models=payload.gemini_models)
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
                _run_job_in_background(
                    f"dub-retry-{new_job.id}",
                    run_dub_job,
                    new_job.id,
                    srt_key=payload.srt_key,  # type: ignore[attr-defined]
                    output_format=payload.output_format,  # type: ignore[attr-defined]
                    voice=payload.voice,  # type: ignore[attr-defined]
                    rate=payload.rate,  # type: ignore[attr-defined]
                    volume=payload.volume,  # type: ignore[attr-defined]
                    pitch=payload.pitch,  # type: ignore[attr-defined]
                    match_video_duration=payload.match_video_duration,  # type: ignore[attr-defined]
                    tts_engine=getattr(payload, "tts_engine", "edge"),
                    fpt_api_key=getattr(payload, "fpt_api_key", ""),
                    fpt_voice=getattr(payload, "fpt_voice", "banmai"),
                    fpt_speed=getattr(payload, "fpt_speed", 0),
                )
            else:
                run_pipeline(
                    new_job.id,
                    input_mode=payload.input_mode,  # type: ignore[attr-defined]
                    gemini_api_key=payload.gemini_api_key,  # type: ignore[attr-defined]
                    gemini_models=getattr(payload, "gemini_models", None),
                    voice_map=payload.voice_map,  # type: ignore[attr-defined]
                    scan_interval_sec=payload.scan_interval_sec,  # type: ignore[attr-defined]
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
            "project": _to_project_read(project).model_dump(mode="json"),
            "jobs": [_job_to_job_read(job).model_dump(mode="json") for job in jobs],
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
            payload = json.dumps(jsonable_encoder(snapshot), ensure_ascii=False)
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


# ─────────────────────────────────────────────────────────────────────────────
# CapCut Import Endpoints
# ─────────────────────────────────────────────────────────────────────────────

def _get_capcut_root() -> Path | None:
    """Trả về đường dẫn gốc thư mục CapCut draft trên máy hiện tại."""
    import os
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        candidate = Path(local_app_data) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
        if candidate.exists():
            return candidate
    # Fallback: thử tìm theo profile user phổ biến
    home = Path.home()
    fallback = home / "AppData" / "Local" / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
    if fallback.exists():
        return fallback
    return None


def _parse_capcut_draft(draft_folder: Path) -> "schemas.CapCutDraftInfo | None":
    """Đọc draft_meta_info.json và trả về CapCutDraftInfo, bỏ qua nếu lỗi."""
    meta_file = draft_folder / "draft_meta_info.json"
    if not meta_file.exists():
        return None
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except Exception:
        return None

    draft_id = meta.get("draft_id", draft_folder.name)
    draft_name = meta.get("draft_name", draft_folder.name)
    duration_us = meta.get("tm_duration", 0) or 0
    duration_sec = duration_us / 1_000_000

    # Tìm video và SRT trong draft_materials
    video_path = ""
    srt_path = ""
    for material_group in meta.get("draft_materials", []):
        group_type = material_group.get("type", -1)
        for item in material_group.get("value", []):
            item_type = item.get("type", -1)
            metetype = item.get("metetype", "")
            file_path = item.get("file_Path", "") or ""
            if group_type == 0 and item_type == 0 and metetype == "video" and file_path:
                video_path = file_path
            elif group_type == 2 and item_type == 2 and file_path and file_path.endswith(".srt"):
                srt_path = file_path

    cover_path = draft_folder / (meta.get("draft_cover", "draft_cover.jpg") or "draft_cover.jpg")
    import base64
    encoded_folder = base64.urlsafe_b64encode(str(draft_folder).encode()).decode()
    cover_url = f"/capcut/drafts/cover/{encoded_folder}"

    return schemas.CapCutDraftInfo(
        draft_id=draft_id,
        draft_name=draft_name,
        draft_folder=str(draft_folder),
        cover_url=cover_url,
        duration_sec=round(duration_sec, 2),
        has_video=bool(video_path and Path(video_path).exists()),
        video_path=video_path,
        has_srt=bool(srt_path and Path(srt_path).exists()),
        srt_path=srt_path,
    )


@app.get("/capcut/drafts", response_model=list[schemas.CapCutDraftInfo])
def list_capcut_drafts():
    """Quét thư mục CapCut và trả về danh sách draft có sẵn."""
    capcut_root = _get_capcut_root()
    if not capcut_root:
        return []

    drafts: list[schemas.CapCutDraftInfo] = []
    for entry in sorted(capcut_root.iterdir(), key=lambda p: p.stat().st_mtime if p.is_dir() else 0, reverse=True):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        info = _parse_capcut_draft(entry)
        if info:
            drafts.append(info)
    return drafts


@app.get("/capcut/drafts/cover/{encoded_folder}")
def get_capcut_cover(encoded_folder: str):
    """Trả về ảnh thumbnail của CapCut draft."""
    import base64
    try:
        folder_str = base64.urlsafe_b64decode(encoded_folder.encode()).decode()
        folder = Path(folder_str)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_path")

    capcut_root = _get_capcut_root()
    if not capcut_root:
        raise HTTPException(status_code=404, detail="capcut_not_found")

    # Bảo mật: chỉ cho phép đọc ảnh trong thư mục CapCut
    try:
        folder.resolve().relative_to(capcut_root.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="forbidden")

    cover = folder / "draft_cover.jpg"
    if not cover.exists():
        raise HTTPException(status_code=404, detail="cover_not_found")
    return FileResponse(path=cover, media_type="image/jpeg")


@app.post("/capcut/import", response_model=schemas.ProjectRead)
def import_capcut_draft(payload: schemas.CapCutImportRequest, db: Session = Depends(get_db)):
    """Tạo project OCR từ một CapCut draft: copy video + SRT vào storage."""
    draft_folder = Path(payload.draft_folder)
    if not draft_folder.exists() or not draft_folder.is_dir():
        raise HTTPException(status_code=400, detail="draft_folder_not_found")

    # Bảo mật: thư mục phải nằm trong CapCut root
    capcut_root = _get_capcut_root()
    if capcut_root:
        try:
            draft_folder.resolve().relative_to(capcut_root.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="forbidden")

    # Parse meta info
    draft_info = _parse_capcut_draft(draft_folder)
    if not draft_info:
        raise HTTPException(status_code=400, detail="invalid_capcut_draft")

    project_name = (payload.project_name or draft_info.draft_name or draft_folder.name).strip() or "CapCut Import"

    # Tạo project trong DB
    project_payload = schemas.ProjectCreate(
        name=project_name,
        source_lang=payload.source_lang,
        target_lang=payload.target_lang,
        roi=schemas.ROI(x=0.05, y=0.78, w=0.9, h=0.18),
    )
    project = crud.create_project(db, project_payload)

    # Tạo thư mục storage
    project_dir = settings.storage_path / project.id
    project_dir.mkdir(parents=True, exist_ok=True)

    # Copy video
    if draft_info.has_video and draft_info.video_path:
        src_video = Path(draft_info.video_path)
        if src_video.exists():
            ext = src_video.suffix or ".mp4"
            dest_video = project_dir / f"source{ext}"
            shutil.copy2(src_video, dest_video)
            project = crud.attach_video(db, project, dest_video)

    # Copy SRT (nếu có)
    if draft_info.has_srt and draft_info.srt_path:
        src_srt = Path(draft_info.srt_path)
        if src_srt.exists():
            dest_srt = project_dir / "manual.external.srt"
            shutil.copy2(src_srt, dest_srt)

    db.refresh(project)
    return _to_project_read(project)


@app.post("/projects/{project_id}/capcut/export", response_model=schemas.CapCutExportResponse)
def export_project_to_capcut(
    project_id: str,
    payload: schemas.CapCutExportRequest,
    db: Session = Depends(get_db),
):
    """
    Tạo dự án CapCut Draft mới từ kết quả OCR:
    - Video track: video gốc của dự án
    - Subtitle track: các segment đã dịch với timestamp chính xác
    - (Optional) Audio track: file dub nếu include_dub=true
    """
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")

    segments_db = crud.list_segments(db, project_id)
    if not segments_db:
        raise HTTPException(status_code=400, detail="no_segments")

    segments = [
        {
            "start_sec": s.start_sec,
            "end_sec":   s.end_sec,
            "translated_text": s.translated_text or s.raw_text or "",
            "raw_text":        s.raw_text or "",
        }
        for s in segments_db
    ]

    # Xác định đường dẫn audio dub (nếu có)
    dub_path: str | None = None
    if payload.include_dub:
        project_dir = settings.storage_path / project_id
        candidate_patterns = [
            "dub_output.*",
            "output_dub.*",
            "dub.output.*",
            "dub.*",
            "output*.wav",
            "output*.mp3",
            "output*.m4a",
            "output*.aac",
        ]
        audio_exts = {".wav", ".mp3", ".m4a", ".aac"}
        seen_candidates: set[Path] = set()
        for pattern in candidate_patterns:
            for candidate in sorted(project_dir.glob(pattern), key=lambda path: path.stat().st_mtime, reverse=True):
                if candidate in seen_candidates:
                    continue
                seen_candidates.add(candidate)
                if candidate.is_file() and candidate.suffix.lower() in audio_exts:
                    dub_path = str(candidate)
                    break
            if dub_path:
                break

    result = export_to_capcut(
        project_name=project.name,
        video_path=project.video_path,
        segments=segments,
        dub_audio_path=dub_path,
    )

    return schemas.CapCutExportResponse(**result)


# ─────────────────────────────────────────────────────────────────────────────
# Gemini Key Management
# ─────────────────────────────────────────────────────────────────────────────

def _load_gemini_keys_from_env() -> list[str]:
    """Đọc danh sách Gemini keys từ settings (reload cache)."""
    try:
        from .settings import get_settings as _gs
        _gs.cache_clear()
    except Exception:
        pass
    raw = (get_settings().gemini_api_keys or "").strip()
    return [k.strip() for k in raw.split(",") if k.strip()]


def _save_gemini_keys_to_env(keys: list[str]) -> None:
    """Lưu danh sách keys vào file .env."""
    env_path = Path(__file__).resolve().parents[3] / ".env"
    keys_value = ",".join(keys)
    lines: list[str] = []
    found = False
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines(keepends=True)
    new_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("GEMINI_API_KEYS=") or stripped.startswith("GEMINI_API_KEYS ="):
            new_lines.append(f"GEMINI_API_KEYS={keys_value}\n")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"GEMINI_API_KEYS={keys_value}\n")
    env_path.write_text("".join(new_lines), encoding="utf-8")
    # Invalidate settings cache sau khi ghi
    try:
        from .settings import get_settings as _gs
        _gs.cache_clear()
    except Exception:
        pass


def _mask_key(key: str) -> str:
    if len(key) <= 8:
        return "****"
    return "****" + key[-8:]


@app.get("/admin/gemini-keys", response_model=schemas.GeminiKeyListResponse)
def list_gemini_keys():
    """Lấy danh sách Gemini API keys (đã ẩn nội dung)."""
    keys = _load_gemini_keys_from_env()
    items = [
        schemas.GeminiKeyItem(
            index=i,
            key_masked=_mask_key(k),
            key_suffix=k[-6:] if len(k) > 6 else k,
            is_primary=(i == 0),
        )
        for i, k in enumerate(keys)
    ]
    return schemas.GeminiKeyListResponse(keys=items, total=len(items))


@app.post("/admin/gemini-keys", response_model=schemas.GeminiKeyListResponse)
def add_gemini_key(payload: schemas.GeminiKeyAddRequest):
    """Thêm một Gemini API key mới vào cuối danh sách."""
    new_key = (payload.api_key or "").strip()
    if not new_key:
        raise HTTPException(status_code=400, detail="api_key_required")
    keys = _load_gemini_keys_from_env()
    if new_key in keys:
        raise HTTPException(status_code=409, detail="key_already_exists")
    keys.append(new_key)
    _save_gemini_keys_to_env(keys)
    items = [
        schemas.GeminiKeyItem(index=i, key_masked=_mask_key(k), key_suffix=k[-6:] if len(k) > 6 else k, is_primary=(i == 0))
        for i, k in enumerate(keys)
    ]
    return schemas.GeminiKeyListResponse(keys=items, total=len(items))


@app.patch("/admin/gemini-keys/{key_index}", response_model=schemas.GeminiKeyListResponse)
def update_gemini_key(key_index: int, payload: schemas.GeminiKeyUpdateRequest):
    """Cập nhật một Gemini API key theo vị trí."""
    new_key = (payload.api_key or "").strip()
    if not new_key:
        raise HTTPException(status_code=400, detail="api_key_required")
    keys = _load_gemini_keys_from_env()
    if key_index < 0 or key_index >= len(keys):
        raise HTTPException(status_code=404, detail="key_not_found")
    keys[key_index] = new_key
    _save_gemini_keys_to_env(keys)
    items = [
        schemas.GeminiKeyItem(index=i, key_masked=_mask_key(k), key_suffix=k[-6:] if len(k) > 6 else k, is_primary=(i == 0))
        for i, k in enumerate(keys)
    ]
    return schemas.GeminiKeyListResponse(keys=items, total=len(items))


@app.delete("/admin/gemini-keys/{key_index}", response_model=schemas.GeminiKeyDeleteResponse)
def delete_gemini_key(key_index: int):
    """Xóa một Gemini API key theo vị trí."""
    keys = _load_gemini_keys_from_env()
    if key_index < 0 or key_index >= len(keys):
        raise HTTPException(status_code=404, detail="key_not_found")
    keys.pop(key_index)
    _save_gemini_keys_to_env(keys)
    return schemas.GeminiKeyDeleteResponse(ok=True, deleted_index=key_index, remaining=len(keys))


@app.put("/admin/gemini-keys/reorder", response_model=schemas.GeminiKeyListResponse)
def reorder_gemini_keys(payload: schemas.GeminiKeyReorderRequest):
    """Đổi thứ tự các Gemini API keys."""
    keys = _load_gemini_keys_from_env()
    indices = payload.new_order_indices
    if len(indices) != len(keys) or set(indices) != set(range(len(keys))):
        raise HTTPException(status_code=400, detail="invalid_indices")
    
    new_keys = [keys[i] for i in indices]
    _save_gemini_keys_to_env(new_keys)
    
    items = [
        schemas.GeminiKeyItem(index=i, key_masked=_mask_key(k), key_suffix=k[-6:] if len(k) > 6 else k, is_primary=(i == 0))
        for i, k in enumerate(new_keys)
    ]
    return schemas.GeminiKeyListResponse(keys=items, total=len(items))


@app.post("/admin/gemini-keys/{key_index}/test")
def test_gemini_key_by_index(key_index: int):
    """Kiểm tra tính hợp lệ của một Gemini API key theo index lưu trữ."""
    import urllib.request
    import json
    
    keys = _load_gemini_keys_from_env()
    if key_index < 0 or key_index >= len(keys):
        raise HTTPException(status_code=404, detail="key_not_found")
        
    api_key = keys[key_index].strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={api_key}"
    body = {"contents": [{"parts": [{"text": "Hello"}]}]}
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST", headers={"Content-Type": "application/json"})
    
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "candidates" in data:
                return {"ok": True, "message": "Key gọi API thành công."}
            else:
                return {"ok": False, "message": "Key hợp lệ nhưng phản hồi không có candidates."}
    except Exception as ex:
        err_msg = str(ex)
        if hasattr(ex, 'code'):
            if ex.code == 400:
                err_msg = "Lỗi 400: API Key không hợp lệ."
            elif ex.code == 403:
                err_msg = "Lỗi 403: Không có quyền truy cập."
            elif ex.code == 429:
                err_msg = "Lỗi 429: Vượt quá giới hạn (Quota exceeded)."
            try:
                msg_body = ex.read().decode("utf-8", errors="ignore")
                err_msg += f" (Chi tiết: {msg_body[:100]})"
            except:
                pass
        return {"ok": False, "message": f"Thất bại: {err_msg}"}


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

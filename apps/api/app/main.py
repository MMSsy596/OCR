import logging
import shutil
import threading
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .db import Base, engine, ensure_runtime_indexes, get_db
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
logger = logging.getLogger("nanbao.ocr.api")

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_runtime_indexes()
    settings.storage_path.mkdir(parents=True, exist_ok=True)


@app.get("/health")
def health():
    return {"ok": True}


def _enqueue_pipeline_job(job_id: str, payload: schemas.PipelineStartRequest) -> None:
    q = get_queue()
    q.enqueue(
        "app.pipeline.run_pipeline",
        job_id,
        gemini_api_key=payload.gemini_api_key,
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

    threading.Thread(target=_runner, name=f"nanbao-{label}", daemon=True).start()


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
        gemini_api_key=payload.gemini_api_key,
        voice_map=payload.voice_map,
        scan_interval_sec=payload.scan_interval_sec,
        job_id=job_id,
        job_timeout=14400,
    )


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
def upload_video(project_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    project_dir = settings.storage_path / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "video.mp4").suffix or ".mp4"
    target = project_dir / f"source{ext}"
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
def stream_video(project_id: str, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if not project.video_path:
        raise HTTPException(status_code=404, detail="video_not_found")
    video_path = Path(project.video_path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="video_missing")
    return FileResponse(path=video_path)


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
            gemini_api_key=payload.gemini_api_key,
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
    return crud.list_jobs(db, project_id)


@app.post("/projects/{project_id}/jobs/retry-stuck", response_model=schemas.RetryJobsResponse)
def retry_stuck_jobs(project_id: str, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if not project.video_path:
        raise HTTPException(status_code=400, detail="video_required")

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
                    gemini_api_key=payload.gemini_api_key,  # type: ignore[attr-defined]
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

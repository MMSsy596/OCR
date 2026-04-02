import shutil
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .db import Base, engine, get_db
from .exporter import export_subtitle_file
from .pipeline import retranslate_project_segments, run_pipeline
from .queue import get_queue
from .settings import get_settings

settings = get_settings()
settings.storage_path.mkdir(parents=True, exist_ok=True)

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
    settings.storage_path.mkdir(parents=True, exist_ok=True)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/projects", response_model=schemas.ProjectRead)
def create_project(payload: schemas.ProjectCreate, db: Session = Depends(get_db)):
    project = crud.create_project(db, payload)
    return _to_project_read(project)


@app.get("/projects", response_model=list[schemas.ProjectRead])
def list_projects(db: Session = Depends(get_db)):
    projects = crud.list_projects(db)
    return [_to_project_read(p) for p in projects]


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
    project = crud.attach_video(db, project, target)
    return _to_project_read(project)


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
    return FileResponse(path=video_path, filename=video_path.name)


@app.post("/projects/{project_id}/pipeline/start", response_model=schemas.JobRead)
def start_pipeline(project_id: str, payload: schemas.PipelineStartRequest, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    if not project.video_path:
        raise HTTPException(status_code=400, detail="video_required")

    job = crud.create_job(db, project_id)
    try:
        q = get_queue()
        q.enqueue(
            "app.pipeline.run_pipeline",
            job.id,
            gemini_api_key=payload.gemini_api_key,
            voice_map=payload.voice_map,
            scan_interval_sec=payload.scan_interval_sec,
            job_id=job.id,
        )
    except Exception:
        # Fallback local mode when Redis/worker is unavailable.
        run_pipeline(
            job.id,
            gemini_api_key=payload.gemini_api_key,
            voice_map=payload.voice_map,
            scan_interval_sec=payload.scan_interval_sec,
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
    output_path = project_dir / output_key

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
    file_path = project_dir / output_key
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="export_not_found")
    return FileResponse(path=file_path, filename=file_path.name)


@app.get("/projects/{project_id}/jobs", response_model=list[schemas.JobRead])
def list_project_jobs(project_id: str, db: Session = Depends(get_db)):
    project = crud.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    return crud.list_jobs(db, project_id)


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
    artifact_path = Path(artifact)
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

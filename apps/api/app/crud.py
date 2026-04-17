from pathlib import Path

from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session

from .models import PipelineJob, Project, ProjectStatus, SubtitleSegment
from .schemas import ProjectCreate, ProjectUpdate


def create_project(db: Session, payload: ProjectCreate) -> Project:
    obj = Project(
        name=payload.name,
        source_lang=payload.source_lang,
        target_lang=payload.target_lang,
        roi_x=payload.roi.x,
        roi_y=payload.roi.y,
        roi_w=payload.roi.w,
        roi_h=payload.roi.h,
        prompt=payload.prompt,
        glossary=payload.glossary,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


def list_projects(db: Session) -> list[Project]:
    return list(db.scalars(select(Project).order_by(desc(Project.created_at))).all())


def get_project(db: Session, project_id: str) -> Project | None:
    return db.get(Project, project_id)


def attach_video(db: Session, project: Project, saved_path: Path) -> Project:
    # New source video means old subtitle timeline is no longer valid.
    db.query(SubtitleSegment).filter(SubtitleSegment.project_id == project.id).delete()
    project.video_path = str(saved_path)
    project.status = ProjectStatus.draft
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def update_project(db: Session, project: Project, payload: ProjectUpdate) -> Project:
    if payload.name is not None:
        project.name = payload.name
    if payload.source_lang is not None:
        project.source_lang = payload.source_lang
    if payload.target_lang is not None:
        project.target_lang = payload.target_lang
    if payload.roi is not None:
        project.roi_x = payload.roi.x
        project.roi_y = payload.roi.y
        project.roi_w = payload.roi.w
        project.roi_h = payload.roi.h
    if payload.prompt is not None:
        project.prompt = payload.prompt
    if payload.glossary is not None:
        project.glossary = payload.glossary
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def set_project_status(db: Session, project: Project, status: ProjectStatus) -> None:
    project.status = status
    db.add(project)
    db.commit()


def replace_segments(db: Session, project_id: str, segments: list[dict]) -> None:
    db.execute(delete(SubtitleSegment).where(SubtitleSegment.project_id == project_id))
    if segments:
        db.bulk_insert_mappings(
            SubtitleSegment,
            [
                {
                    "project_id": project_id,
                    "start_sec": seg["start_sec"],
                    "end_sec": seg["end_sec"],
                    "raw_text": seg.get("raw_text", ""),
                    "translated_text": seg.get("translated_text", ""),
                    "speaker": seg.get("speaker", "narrator"),
                    "voice": seg.get("voice", "female-soft"),
                    "confidence": seg.get("confidence", 0.9),
                }
                for seg in segments
            ],
        )
    db.commit()


def list_segments(db: Session, project_id: str) -> list[SubtitleSegment]:
    stmt = select(SubtitleSegment).where(SubtitleSegment.project_id == project_id).order_by(SubtitleSegment.start_sec)
    return list(db.scalars(stmt).all())


def update_segments(db: Session, project_id: str, updates: list[dict]) -> list[SubtitleSegment]:
    existing_rows = list(db.scalars(select(SubtitleSegment).where(SubtitleSegment.project_id == project_id)).all())
    existing = {seg.id: seg for seg in existing_rows}

    def _safe_int(val) -> int | None:
        try:
            return int(val)
        except (TypeError, ValueError):
            return None

    keep_ids = {_safe_int(item["id"]) for item in updates if item.get("id") is not None} - {None}

    # Remove segments that are no longer present in editor payload (important for merge actions).
    for seg in existing_rows:
        if seg.id not in keep_ids:
            db.delete(seg)

    for item in updates:
        seg_id = _safe_int(item.get("id"))
        seg = existing.get(seg_id) if seg_id is not None else None
        if seg is None:
            seg = SubtitleSegment(
                project_id=project_id,
                start_sec=float(item["start_sec"]),
                end_sec=float(item["end_sec"]),
                raw_text=item.get("raw_text", ""),
                translated_text=item.get("translated_text", ""),
                speaker=item.get("speaker", "narrator"),
                voice=item.get("voice", "narrator-neutral"),
                confidence=0.9,
            )
        else:
            seg.start_sec = float(item["start_sec"])
            seg.end_sec = float(item["end_sec"])
            seg.raw_text = item.get("raw_text", "")
            seg.translated_text = item.get("translated_text", "")
            seg.speaker = item.get("speaker", seg.speaker or "narrator")
            seg.voice = item.get("voice", seg.voice or "narrator-neutral")
        db.add(seg)
    db.commit()
    return list_segments(db, project_id)


def create_job(db: Session, project_id: str) -> PipelineJob:
    job = PipelineJob(project_id=project_id)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_job(db: Session, job_id: str) -> PipelineJob | None:
    return db.get(PipelineJob, job_id)


def list_jobs(db: Session, project_id: str) -> list[PipelineJob]:
    stmt = select(PipelineJob).where(PipelineJob.project_id == project_id).order_by(desc(PipelineJob.created_at))
    return list(db.scalars(stmt).all())


def clear_sessions(db: Session, include_processing: bool = False) -> tuple[list[str], int]:
    all_projects = db.execute(select(Project.id, Project.status)).all()

    # Bóc tách dạng tuple (id, status)
    to_delete: list[str] = []
    skipped_processing = 0
    for row in all_projects:
        pid, status = row[0], row[1]
        if status == ProjectStatus.processing and not include_processing:
            skipped_processing += 1
            continue
        to_delete.append(pid)

    if to_delete:
        # Bulk delete — 3 câu SQL thay vì N câu
        db.execute(delete(SubtitleSegment).where(SubtitleSegment.project_id.in_(to_delete)))
        db.execute(delete(PipelineJob).where(PipelineJob.project_id.in_(to_delete)))
        db.execute(delete(Project).where(Project.id.in_(to_delete)))
        db.commit()

    return to_delete, skipped_processing

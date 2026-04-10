from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .settings import get_settings

logger = logging.getLogger("nanbao.ocr.job_state")
settings = get_settings()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _project_job_dir(project_id: str) -> Path:
    path = settings.storage_path / project_id / "_jobs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def event_log_path(project_id: str, job_id: str) -> Path:
    return _project_job_dir(project_id) / f"{job_id}.events.jsonl"


def snapshot_log_path(project_id: str, job_id: str) -> Path:
    return _project_job_dir(project_id) / f"{job_id}.snapshot.json"


def prepare_job_artifacts(job: Any) -> dict[str, Any]:
    base = job.artifacts if isinstance(job.artifacts, dict) else {}
    base.setdefault("events", [])
    base.setdefault("stats", {})
    base.setdefault("event_log", str(event_log_path(job.project_id, job.id)))
    return base


def push_event(
    job: Any,
    artifacts: dict[str, Any],
    phase: str,
    message: str,
    progress: int,
    level: str = "info",
    logger_name: str = "job",
) -> None:
    event = {
        "time": utc_now_iso(),
        "phase": phase,
        "level": level,
        "progress": int(progress),
        "message": message,
    }
    events = artifacts.setdefault("events", [])
    events.append(event)
    keep_count = max(10, int(settings.job_inline_event_limit))
    if len(events) > keep_count:
        artifacts["events"] = events[-keep_count:]

    log_path = event_log_path(job.project_id, job.id)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")

    logger.info("[%s][%s][%s%%][%s] %s", logger_name, phase, int(progress), level, message)


def set_stat(artifacts: dict[str, Any], phase: str, payload: dict[str, Any]) -> None:
    stats = artifacts.setdefault("stats", {})
    stats[phase] = payload

    max_stats = max(4, int(settings.job_inline_stats_limit))
    if len(stats) > max_stats:
        ordered_keys = list(stats.keys())
        for key in ordered_keys[:-max_stats]:
            stats.pop(key, None)


def persist_snapshot(job: Any, artifacts: dict[str, Any]) -> None:
    snapshot = {
        "job_id": job.id,
        "project_id": job.project_id,
        "status": str(job.status),
        "progress": int(job.progress or 0),
        "step": job.step or "",
        "error_message": job.error_message or "",
        "artifacts": artifacts,
    }
    out_path = snapshot_log_path(job.project_id, job.id)
    out_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")


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


def stats_dir_path(project_id: str, job_id: str) -> Path:
    path = _project_job_dir(project_id) / f"{job_id}.stats"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _sanitize_phase_name(phase: str) -> str:
    cleaned = "".join(ch if (ch.isalnum() or ch in {"-", "_"}) else "_" for ch in (phase or "phase"))
    return cleaned[:80] or "phase"


def _compact_value(value: Any, depth: int = 0) -> Any:
    if depth >= 3:
        return f"<truncated:{type(value).__name__}>"
    if isinstance(value, dict):
        compact: dict[str, Any] = {}
        for idx, (key, item) in enumerate(value.items()):
            if idx >= 12:
                compact["_extra_keys"] = max(0, len(value) - 12)
                break
            compact[str(key)] = _compact_value(item, depth + 1)
        return compact
    if isinstance(value, list):
        preview = [_compact_value(item, depth + 1) for item in value[:5]]
        if len(value) > 5:
            preview.append(f"<+{len(value) - 5} items>")
        return preview
    if isinstance(value, str):
        limit = max(80, int(settings.job_event_message_limit or 220))
        return value[:limit]
    return value


def prepare_job_artifacts(job: Any) -> dict[str, Any]:
    base = job.artifacts if isinstance(job.artifacts, dict) else {}
    base["job_id"] = job.id
    base["project_id"] = job.project_id
    base.setdefault("event_log", str(event_log_path(job.project_id, job.id)))
    base.setdefault("snapshot_log", str(snapshot_log_path(job.project_id, job.id)))
    base.setdefault("stats_dir", str(stats_dir_path(job.project_id, job.id)))
    base.setdefault("events_preview", [])
    base.setdefault("stats_preview", {})
    base.setdefault("stats_index", {})
    base["events"] = base["events_preview"]
    base["stats"] = base["stats_preview"]
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
    safe_message = (message or "")[: max(80, int(settings.job_event_message_limit or 220))]
    event = {
        "time": utc_now_iso(),
        "phase": phase,
        "level": level,
        "progress": int(progress),
        "message": safe_message,
    }
    events = artifacts.setdefault("events_preview", [])
    events.append(event)
    keep_count = max(6, int(settings.job_inline_event_limit))
    if len(events) > keep_count:
        artifacts["events_preview"] = events[-keep_count:]
    artifacts["events"] = artifacts["events_preview"]
    artifacts["last_event"] = event

    log_path = event_log_path(job.project_id, job.id)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")

    logger.info("[%s][%s][%s%%][%s] %s", logger_name, phase, int(progress), level, safe_message)


def set_stat(artifacts: dict[str, Any], phase: str, payload: dict[str, Any]) -> None:
    project_id = str(artifacts.get("project_id") or "")
    job_id = str(artifacts.get("job_id") or "")
    if project_id and job_id:
        phase_path = stats_dir_path(project_id, job_id) / f"{_sanitize_phase_name(phase)}.json"
        phase_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        stats_index = artifacts.setdefault("stats_index", {})
        stats_index[phase] = {
            "path": str(phase_path),
            "updated_at": utc_now_iso(),
        }

    stats = artifacts.setdefault("stats_preview", {})
    stats[phase] = _compact_value(payload)
    max_stats = max(4, int(settings.job_inline_stats_limit))
    if len(stats) > max_stats:
        ordered_keys = list(stats.keys())
        for key in ordered_keys[:-max_stats]:
            stats.pop(key, None)
    artifacts["stats"] = artifacts["stats_preview"]


def persist_snapshot(job: Any, artifacts: dict[str, Any]) -> None:
    artifacts["job_id"] = job.id
    artifacts["project_id"] = job.project_id
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

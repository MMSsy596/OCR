import ipaddress
import socket
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import parse, request

from sqlalchemy.orm import Session

from . import crud
from .db import SessionLocal
from .models import JobStatus, PipelineJob, Project, ProjectStatus
from .pipeline import run_pipeline
from .queue import get_queue
from .settings import get_settings


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_artifacts(job: PipelineJob) -> dict[str, Any]:
    base = job.artifacts if isinstance(job.artifacts, dict) else {}
    base.setdefault("events", [])
    base.setdefault("stats", {})
    return base


def _push_event(
    artifacts: dict[str, Any],
    phase: str,
    message: str,
    progress: int,
    level: str = "info",
) -> None:
    events = artifacts.setdefault("events", [])
    events.append(
        {
            "time": _utc_now_iso(),
            "phase": phase,
            "level": level,
            "progress": int(progress),
            "message": message,
        }
    )
    if len(events) > 400:
        artifacts["events"] = events[-400:]


def _set_stat(artifacts: dict[str, Any], phase: str, payload: dict[str, Any]) -> None:
    stats = artifacts.setdefault("stats", {})
    stats[phase] = payload


def _update_job(
    db: Session,
    job: PipelineJob,
    status: JobStatus,
    progress: int,
    step: str,
    error_message: str = "",
    artifacts: dict | None = None,
) -> None:
    now = time.monotonic()
    prev_status = job.status
    prev_progress = int(job.progress or 0)
    prev_step = job.step or ""
    force_flush = (
        status != prev_status
        or step != prev_step
        or bool(error_message)
        or int(progress) >= 100
        or status in {JobStatus.done, JobStatus.failed}
    )
    job.status = status
    job.progress = progress
    job.step = step
    job.error_message = error_message
    if artifacts is not None:
        job.artifacts = artifacts
    last_flush = float(getattr(job, "_nanbao_last_flush_at", 0.0))
    last_progress = int(getattr(job, "_nanbao_last_flush_progress", prev_progress))
    if not force_flush and (now - last_flush) < 1.5 and abs(int(progress) - last_progress) < 3:
        return
    db.add(job)
    db.commit()
    db.refresh(job)
    job._nanbao_last_flush_at = now
    job._nanbao_last_flush_progress = int(progress)


def _detect_platform(url_text: str) -> tuple[str, str]:
    parsed = parse.urlparse(url_text)
    host = (parsed.netloc or "").lower()
    if "youtube.com" in host or "youtu.be" in host:
        return "youtube", host
    if "tiktok.com" in host:
        return "tiktok", host
    if "facebook.com" in host or "fb.watch" in host:
        return "facebook", host
    if "instagram.com" in host:
        return "instagram", host
    if "x.com" in host or "twitter.com" in host:
        return "x", host
    if "bilibili.com" in host or "b23.tv" in host:
        return "bilibili", host
    if "dailymotion.com" in host:
        return "dailymotion", host
    if host:
        return "generic", host
    return "unknown", host


def _infer_link_type(url_text: str) -> str:
    lower_path = parse.urlparse(url_text).path.lower()
    for ext in (".mp4", ".mov", ".mkv", ".webm", ".avi", ".flv", ".m4v"):
        if lower_path.endswith(ext):
            return f"direct_video:{ext.lstrip('.')}"
    for ext in (".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"):
        if lower_path.endswith(ext):
            return f"direct_audio:{ext.lstrip('.')}"
    if "m3u8" in lower_path:
        return "stream_playlist:m3u8"
    return "web_video_page"


def _human_bytes(num: float | int) -> str:
    size = float(num or 0)
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    while size >= 1024 and idx < len(units) - 1:
        size /= 1024
        idx += 1
    return f"{size:.1f}{units[idx]}"


def _sanitize_stem(raw: str, fallback: str = "source") -> str:
    safe = "".join(ch if (ch.isalnum() or ch in {"-", "_", "."}) else "_" for ch in (raw or ""))
    safe = safe.strip("._")[:96]
    return safe or fallback


def _is_public_host(host: str) -> bool:
    host = (host or "").strip().lower()
    if not host or host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local"):
        return False
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_global
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    resolved = []
    for info in infos:
        raw_ip = info[4][0]
        try:
            resolved.append(ipaddress.ip_address(raw_ip))
        except ValueError:
            return False
    return bool(resolved) and all(ip.is_global for ip in resolved)


def _validate_source_url(source_url: str) -> str:
    parsed = parse.urlparse((source_url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("unsupported_url_scheme")
    if not _is_public_host(parsed.hostname or ""):
        raise ValueError("blocked_private_or_invalid_host")
    return parsed.geturl()


def _download_direct(
    source_url: str,
    target_dir: Path,
    progress_cb,
) -> tuple[Path, dict[str, Any]]:
    req = request.Request(source_url, method="GET")
    with request.urlopen(req, timeout=60) as resp:
        final_url = resp.geturl() or source_url
        content_type = str(resp.headers.get("Content-Type", "")).split(";")[0].strip().lower()
        content_length = int(resp.headers.get("Content-Length", "0") or 0)
        parsed = parse.urlparse(final_url)
        ext = Path(parsed.path).suffix or ".mp4"
        filename_hint = Path(parsed.path).name or f"source{ext}"
        target = target_dir / _sanitize_stem(Path(filename_hint).stem, fallback="source")
        target = target.with_suffix(ext if ext else ".mp4")

        bytes_done = 0
        last_emit = 0.0
        with target.open("wb") as fh:
            while True:
                chunk = resp.read(1024 * 512)
                if not chunk:
                    break
                fh.write(chunk)
                bytes_done += len(chunk)
                now = time.monotonic()
                if now - last_emit >= 0.8:
                    pct = int((bytes_done / content_length) * 100) if content_length > 0 else 0
                    progress_cb(
                        min(85, max(15, 10 + int(pct * 0.75))),
                        bytes_done,
                        content_length,
                        "",
                        0,
                    )
                    last_emit = now

        return target, {
            "mode": "direct_http",
            "final_url": final_url,
            "content_type": content_type,
            "content_length": content_length,
            "bytes_downloaded": bytes_done,
        }


def _download_with_ytdlp(
    source_url: str,
    target_dir: Path,
    progress_cb,
) -> tuple[Path, dict[str, Any]]:
    try:
        import yt_dlp  # type: ignore
    except Exception as ex:
        raise RuntimeError(f"yt_dlp_unavailable:{str(ex)[:120]}") from ex

    output_template = str(target_dir / "%(title).90s-%(id)s.%(ext)s")
    state: dict[str, Any] = {"target_path": "", "tmp_filename": "", "title": "", "extractor": ""}
    last_emit = {"t": 0.0}

    def _hook(d: dict[str, Any]) -> None:
        status = d.get("status", "")
        now = time.monotonic()
        if status == "downloading":
            downloaded = int(d.get("downloaded_bytes") or 0)
            total = int(d.get("total_bytes") or d.get("total_bytes_estimate") or 0)
            speed = float(d.get("speed") or 0.0)
            eta = int(d.get("eta") or 0)
            if now - last_emit["t"] >= 0.8:
                pct = int((downloaded / total) * 100) if total > 0 else 0
                progress_cb(
                    min(85, max(15, 10 + int(pct * 0.75))),
                    downloaded,
                    total,
                    speed,
                    eta,
                )
                last_emit["t"] = now
            if d.get("tmpfilename"):
                state["tmp_filename"] = str(d["tmpfilename"])
        elif status == "finished":
            state["target_path"] = str(d.get("filename") or "")
            progress_cb(88, int(d.get("downloaded_bytes") or 0), int(d.get("total_bytes") or 0), 0.0, 0)

    options: dict[str, Any] = {
        "outtmpl": output_template,
        "noplaylist": True,
        # Prefer absolute best quality stream pair (video+audio) first.
        "format": "bestvideo*+bestaudio/best",
        "format_sort": ["res", "fps", "hdr", "vcodec", "acodec", "br", "size"],
        "progress_hooks": [_hook],
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(source_url, download=True)
        if not isinstance(info, dict):
            raise RuntimeError("yt_dlp_info_invalid")
        prepared = ydl.prepare_filename(info)
        downloaded_path = state.get("target_path") or prepared
        state["title"] = str(info.get("title") or "")
        state["extractor"] = str(info.get("extractor_key") or info.get("extractor") or "")
        # When merge_output_format=mp4, output can change extension after postprocess.
        candidate = Path(downloaded_path)
        if candidate.exists():
            final_path = candidate
        else:
            mp4_candidate = candidate.with_suffix(".mp4")
            final_path = mp4_candidate if mp4_candidate.exists() else candidate
        if not final_path.exists():
            raise RuntimeError(f"downloaded_file_missing:{final_path}")
        return final_path, {
            "mode": "yt_dlp",
            "title": state["title"],
            "extractor": state["extractor"],
            "bytes_downloaded": int(final_path.stat().st_size),
            "format_id": str(info.get("format_id") or ""),
            "ext": str(info.get("ext") or final_path.suffix.lstrip(".")),
            "height": int(info.get("height") or 0),
            "width": int(info.get("width") or 0),
            "fps": int(info.get("fps") or 0),
            "vcodec": str(info.get("vcodec") or ""),
            "acodec": str(info.get("acodec") or ""),
        }


def _create_pipeline_job(
    db: Session,
    project_id: str,
    parent_job_id: str,
    payload: dict[str, Any],
) -> PipelineJob:
    pj = PipelineJob(project_id=project_id)
    pj.artifacts = {
        "job_kind": "pipeline",
        "request_payload": payload,
        "triggered_by": f"url_ingest:{parent_job_id}",
    }
    db.add(pj)
    db.commit()
    db.refresh(pj)
    return pj


def _cleanup_project_generated_files(project_dir: Path, keep_source: Path | None = None) -> None:
    storage_root = get_settings().storage_path.resolve()

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


def run_url_ingest_job(
    job_id: str,
    source_url: str,
    auto_start_pipeline: bool = True,
    gemini_api_key: str | None = None,
    voice_map: dict[str, str] | None = None,
    scan_interval_sec: float = 1.5,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        source_url = _validate_source_url(source_url)
        job = db.get(PipelineJob, job_id)
        if not job:
            return {"ok": False, "error": "job_not_found"}
        project = db.get(Project, job.project_id)
        if not project:
            _update_job(db, job, JobStatus.failed, 0, "error", "project_not_found")
            return {"ok": False, "error": "project_not_found"}

        project.status = ProjectStatus.processing
        db.add(project)
        db.commit()

        artifacts = _job_artifacts(job)
        platform, host = _detect_platform(source_url)
        link_type = _infer_link_type(source_url)
        _push_event(artifacts, "detect", f"Đã nhận link: host={host or '-'}, platform={platform}, type={link_type}.", 2)
        _set_stat(
            artifacts,
            "detect",
            {
                "source_url": source_url,
                "platform": platform,
                "host": host,
                "link_type": link_type,
                "auto_start_pipeline": bool(auto_start_pipeline),
            },
        )
        _update_job(db, job, JobStatus.running, 2, "detect_link", artifacts=artifacts)

        project_dir = Path(project.video_path).parent if project.video_path else (get_settings().storage_path / project.id)
        project_dir.mkdir(parents=True, exist_ok=True)
        _push_event(artifacts, "download", "Bắt đầu tải nội dung từ URL...", 8)
        _update_job(db, job, JobStatus.running, 8, "download", artifacts=artifacts)

        def _on_progress(progress: int, downloaded: int, total: int, speed: float | str, eta: int) -> None:
            nonlocal artifacts
            speed_text = f"{_human_bytes(float(speed))}/s" if isinstance(speed, (int, float)) and float(speed) > 0 else "-"
            eta_text = f"{eta}s" if eta and eta > 0 else "-"
            _set_stat(
                artifacts,
                "download_live",
                {
                    "downloaded_bytes": downloaded,
                    "total_bytes": total,
                    "downloaded_human": _human_bytes(downloaded),
                    "total_human": _human_bytes(total),
                    "speed": speed_text,
                    "eta": eta_text,
                },
            )
            _update_job(db, job, JobStatus.running, int(progress), "download", artifacts=artifacts)

        download_meta: dict[str, Any]
        if platform in {"youtube", "tiktok", "facebook", "instagram", "x", "bilibili", "dailymotion", "generic"}:
            try:
                downloaded_path, download_meta = _download_with_ytdlp(source_url, project_dir, _on_progress)
            except Exception as ex:
                _push_event(
                    artifacts,
                    "download",
                    f"yt-dlp lỗi ({str(ex)[:180]}), fallback HTTP trực tiếp.",
                    max(12, int(job.progress or 12)),
                    level="warning",
                )
                downloaded_path, download_meta = _download_direct(source_url, project_dir, _on_progress)
        else:
            downloaded_path, download_meta = _download_direct(source_url, project_dir, _on_progress)

        ext = downloaded_path.suffix or ".mp4"
        final_video = project_dir / f"source{ext}"
        if downloaded_path.resolve() != final_video.resolve():
            shutil.copy2(downloaded_path, final_video)
        _cleanup_project_generated_files(project_dir, keep_source=final_video)
        project = crud.attach_video(db, project, final_video)

        _set_stat(
            artifacts,
            "download",
            {
                **download_meta,
                "saved_path": str(final_video),
                "saved_size_bytes": int(final_video.stat().st_size),
            },
        )
        _push_event(
            artifacts,
            "download",
            f"Tải xong {_human_bytes(final_video.stat().st_size)} -> {final_video.name}.",
            92,
        )

        pipeline_job_id = ""
        if auto_start_pipeline:
            request_payload = {
                "gemini_api_key": gemini_api_key,
                "voice_map": voice_map or {},
                "scan_interval_sec": float(scan_interval_sec),
            }
            pipeline_job = _create_pipeline_job(db, project.id, job.id, request_payload)
            pipeline_job_id = pipeline_job.id
            try:
                q = get_queue()
                q.enqueue(
                    "app.pipeline.run_pipeline",
                    pipeline_job.id,
                    gemini_api_key=gemini_api_key,
                    voice_map=voice_map or {},
                    scan_interval_sec=float(scan_interval_sec),
                    job_id=pipeline_job.id,
                )
                _push_event(artifacts, "pipeline", f"Đã xếp hàng auto pipeline: {pipeline_job.id}.", 97)
            except Exception:
                _push_event(
                    artifacts,
                    "pipeline",
                    "Không kết nối queue, chuyển sang chạy pipeline local.",
                    97,
                    level="warning",
                )
                run_pipeline(
                    pipeline_job.id,
                    gemini_api_key=gemini_api_key,
                    voice_map=voice_map or {},
                    scan_interval_sec=float(scan_interval_sec),
                )
        else:
            project.status = ProjectStatus.ready
            db.add(project)
            db.commit()

        artifacts["video_path"] = str(final_video)
        if pipeline_job_id:
            artifacts["triggered_pipeline_job_id"] = pipeline_job_id
        _push_event(
            artifacts,
            "done",
            "Hoàn tất nhập link và tải video.",
            100,
        )
        _update_job(db, job, JobStatus.done, 100, "done", artifacts=artifacts)
        return {"ok": True, "job_id": job.id, "video_path": str(final_video), "triggered_pipeline_job_id": pipeline_job_id}
    except Exception as ex:
        job = db.get(PipelineJob, job_id)
        if job:
            artifacts = _job_artifacts(job)
            _push_event(
                artifacts,
                "error",
                f"Lỗi ingest URL: {str(ex)[:320]}",
                int(job.progress or 0),
                level="error",
            )
            _update_job(db, job, JobStatus.failed, int(job.progress or 0), "error", str(ex), artifacts=artifacts)
        project = db.get(Project, job.project_id) if job else None
        if project:
            project.status = ProjectStatus.failed
            db.add(project)
            db.commit()
        return {"ok": False, "job_id": job_id, "error": str(ex)}
    finally:
        db.close()

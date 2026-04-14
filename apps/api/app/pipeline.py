import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import wave
from queue import Empty, Queue
from pathlib import Path
from typing import Any, Callable
from urllib import error, request
from difflib import SequenceMatcher
from sqlalchemy.orm import Session

from .crud import list_segments, replace_segments
from .db import SessionLocal
from .exporter import export_subtitle_file
from .job_state import persist_snapshot, prepare_job_artifacts, push_event, set_stat
from .models import JobStatus, PipelineJob, Project, ProjectStatus
from .settings import get_settings

logger = logging.getLogger("solar.ocr.pipeline")


def _compute_effective_scan_interval(
    *,
    fps: float,
    total_frames: int,
    requested_interval_sec: float,
) -> tuple[float, int]:
    safe_requested = max(0.1, float(requested_interval_sec))
    if fps <= 0 or total_frames <= 0:
        return safe_requested, 0
    settings = get_settings()
    duration_sec = total_frames / max(fps, 0.001)
    requested_samples = max(1, int(duration_sec / safe_requested))
    max_samples = max(100, int(settings.ocr_max_samples_per_video or 1600))
    if requested_samples <= max_samples:
        return safe_requested, requested_samples
    effective_interval = max(safe_requested, duration_sec / max_samples)
    effective_samples = max(1, int(duration_sec / effective_interval))
    return round(effective_interval, 3), effective_samples


def _update_job(db: Session, job: PipelineJob, status: JobStatus, progress: int, step: str, error_message: str = "", artifacts: dict | None = None) -> None:
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
    last_flush = float(getattr(job, "_solar_last_flush_at", 0.0))
    last_progress = int(getattr(job, "_solar_last_flush_progress", prev_progress))
    if not force_flush and (now - last_flush) < 1.5 and abs(int(progress) - last_progress) < 3:
        return
    if artifacts is not None:
        persist_snapshot(job, artifacts)
    db.add(job)
    db.commit()
    db.refresh(job)
    job._solar_last_flush_at = now
    job._solar_last_flush_progress = int(progress)


def _fake_ocr_segments(project: Project) -> list[dict[str, Any]]:
    # MVP fallback: tao subtitle mau de co pipeline end-to-end.
    lines = [
        "Nhan vat A: Ta se tro lai.",
        "Nhan vat B: Chung ta khong con thoi gian.",
        "Narrator: Troi toi dan, gio mua bat dau.",
        "Nhan vat A: Ke hoach bat dau ngay bay gio.",
        "Nhan vat B: Hay tin vao ta.",
    ]
    output = []
    current = 0.0
    for i, line in enumerate(lines, start=1):
        output.append(
            {
                "start_sec": current,
                "end_sec": current + 2.8,
                "raw_text": line,
                "translated_text": "",
                "speaker": "character_a" if i in (1, 4) else ("character_b" if i in (2, 5) else "narrator"),
                "voice": "male-deep" if i in (1, 4) else ("female-bright" if i in (2, 5) else "narrator-neutral"),
                "confidence": 0.87 + (i * 0.01),
            }
        )
        current += 3.0
    return output


def _build_ocr_variants(cv2: Any, gray: Any, profile: str = "balanced") -> list[tuple[str, Any]]:
    variants: list[tuple[str, Any]] = [("gray", gray)]
    try:
        profile_key = (profile or "balanced").strip().lower()
        upscaled = cv2.resize(gray, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
        variants.append(("gray_up", upscaled))

        if profile_key == "fast":
            return variants

        blur = cv2.GaussianBlur(upscaled, (3, 3), 0)
        variants.append(("blur_up", blur))

        _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.append(("otsu_bin", otsu))

        _, inv_otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        variants.append(("otsu_inv", inv_otsu))

        if profile_key == "balanced":
            return variants

        clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
        clahe_img = clahe.apply(gray)
        clahe_up = cv2.resize(clahe_img, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
        variants.append(("clahe_up", clahe_up))

        _, clahe_bin = cv2.threshold(clahe_up, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.append(("clahe_bin", clahe_bin))

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        morph = cv2.morphologyEx(clahe_bin, cv2.MORPH_CLOSE, kernel, iterations=1)
        variants.append(("clahe_close", morph))
    except Exception:
        return variants
    return variants


def _extract_best_ocr_text(ocr_result: Any) -> tuple[str, float]:
    if not ocr_result:
        return "", 0.0
    texts = []
    scores = []
    for item in ocr_result:
        if len(item) < 3:
            continue
        txt = str(item[1]).strip()
        if not txt:
            continue
        texts.append(txt)
        try:
            scores.append(float(item[2]))
        except Exception:
            scores.append(0.8)
    if not texts:
        return "", 0.0
    text = " ".join(texts).strip()
    text = " ".join(text.split())
    avg_score = sum(scores) / len(scores) if scores else 0.0
    return text, avg_score


def _parse_subtitle_timestamp(value: str) -> float:
    cleaned = (value or "").strip().replace(",", ".")
    match = re.match(r"(?:(\d+):)?(\d{2}):(\d{2})(?:\.(\d{1,3}))?$", cleaned)
    if not match:
        raise ValueError(f"invalid_subtitle_timestamp:{value}")
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    millis_raw = (match.group(4) or "0").ljust(3, "0")[:3]
    return (hours * 3600) + (minutes * 60) + seconds + (int(millis_raw) / 1000.0)


def _parse_srt_segments(
    srt_text: str,
    *,
    start_offset_sec: float = 0.0,
    default_voice: str = "narrator-neutral",
) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    blocks = re.split(r"\r?\n\r?\n+", (srt_text or "").strip())
    for block in blocks:
        lines = [line.strip("\ufeff ").rstrip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        if len(lines) >= 2 and re.fullmatch(r"\d+", lines[0]):
            lines = lines[1:]
        if not lines or "-->" not in lines[0]:
            continue
        timeline = lines[0]
        text_lines = [line.strip() for line in lines[1:] if line.strip()]
        if not text_lines:
            continue
        start_text, end_text = [part.strip() for part in timeline.split("-->", 1)]
        start_sec = _parse_subtitle_timestamp(start_text) + float(start_offset_sec)
        end_sec = _parse_subtitle_timestamp(end_text) + float(start_offset_sec)
        if end_sec <= start_sec:
            end_sec = start_sec + 0.8
        text = " ".join(text_lines)
        text = " ".join(text.split())
        if not text:
            continue
        segments.append(
            {
                "start_sec": round(start_sec, 3),
                "end_sec": round(end_sec, 3),
                "raw_text": text,
                "translated_text": "",
                "speaker": "narrator",
                "voice": default_voice,
                "confidence": 0.92,
            }
        )
    return segments




















def _ocr_segments_from_video(
    project: Project,
    scan_interval_sec: float = 1.0,
    variant_profile: str = "balanced",
    progress_hook: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    meta: dict[str, Any] = {
        "engine": "rapidocr",
        "scan_interval_sec": float(scan_interval_sec),
        "video_path": str(project.video_path or ""),
        "frames_total": 0,
        "frames_sampled": 0,
        "frames_read_ok": 0,
        "frames_read_failed": 0,
        "roi_empty_count": 0,
        "ocr_hit_frames": 0,
        "duplicate_extend_count": 0,
        "skipped_similar_frame_count": 0,
        "ignored_short_text": 0,
        "segments_before_merge": 0,
        "ocr_variant_attempts": 0,
        "ocr_variant_hits": 0,
        "ocr_variant_best": {},
        "variant_profile": variant_profile,
    }
    if not project.video_path:
        meta["engine"] = "missing_video"
        return [], meta
    video_path = Path(project.video_path)
    if not video_path.exists():
        meta["engine"] = "missing_video_file"
        return [], meta
    try:
        import cv2  # type: ignore
        import onnxruntime as ort  # type: ignore
        from rapidocr_onnxruntime import RapidOCR  # type: ignore
    except Exception:
        meta["engine"] = "rapidocr_unavailable"
        return [], meta

    # Keep OCR predictable and avoid saturating all CPU cores when running on CPU.
    cpu_count = max(1, int(os.cpu_count() or 1))
    cpu_threads = max(1, min(4, cpu_count // 2))
    os.environ.setdefault("OMP_NUM_THREADS", str(cpu_threads))
    os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")
    try:
        cv2.setNumThreads(cpu_threads)
    except Exception:
        pass

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        meta["engine"] = "video_open_failed"
        return [], meta

    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    effective_scan_interval, effective_estimated_samples = _compute_effective_scan_interval(
        fps=float(fps),
        total_frames=total_frames,
        requested_interval_sec=scan_interval_sec,
    )
    sample_step = int(max(1, fps * max(0.1, effective_scan_interval)))
    meta["fps"] = float(fps)
    meta["frames_total"] = total_frames
    meta["requested_scan_interval_sec"] = float(scan_interval_sec)
    meta["effective_scan_interval_sec"] = float(effective_scan_interval)
    meta["sample_step_frames"] = int(sample_step)
    meta["estimated_samples"] = int(total_frames // sample_step) + (1 if total_frames % sample_step else 0)
    meta["estimated_samples_capped"] = int(effective_estimated_samples or meta["estimated_samples"])
    meta["long_video_mode"] = bool(effective_scan_interval > (float(scan_interval_sec) + 0.001))
    available_providers = []
    try:
        available_providers = list(ort.get_available_providers())
    except Exception:
        available_providers = []
    use_cuda = "CUDAExecutionProvider" in available_providers

    try:
        engine = RapidOCR(
            use_cuda=use_cuda,
            det_limit_side_len=640 if not use_cuda else 960,
            rec_batch_num=6 if not use_cuda else 10,
            cls_batch_num=6 if not use_cuda else 10,
        )
        meta["engine_init_mode"] = "tuned"
    except Exception as ex:
        # rapidocr-onnxruntime 1.2.3 on Windows can throw KeyError("model_path")
        # when kwargs are provided. Fall back to default init so pipeline still runs.
        engine = RapidOCR()
        meta["engine_init_mode"] = "default_fallback"
        meta["engine_init_error"] = str(ex)[:240]
    meta["execution_provider"] = "CUDAExecutionProvider" if use_cuda else "CPUExecutionProvider"
    meta["cpu_threads"] = cpu_threads
    segments = []
    last_text = ""
    last_signature: tuple[int, int, int] | None = None
    consecutive_similar_skips = 0

    frame_queue: Queue[tuple[int, Any] | None] = Queue(maxsize=6)
    producer_error: list[str] = []

    def _producer() -> None:
        frame_idx = 0
        sampled = 0
        try:
            while True:
                ok, frame = cap.read()
                if not ok or frame is None:
                    break
                if frame_idx % sample_step == 0:
                    sampled += 1
                    frame_queue.put((frame_idx, frame))
                frame_idx += 1
            meta["producer_frames_read"] = frame_idx
            meta["producer_frames_sampled"] = sampled
        except Exception as ex:
            producer_error.append(str(ex))
        finally:
            frame_queue.put(None)

    producer = threading.Thread(target=_producer, name="ocr-frame-producer", daemon=True)
    producer.start()

    while True:
        try:
            item = frame_queue.get(timeout=2.0)
        except Empty:
            if not producer.is_alive():
                break
            continue
        if item is None:
            break
        idx, frame = item
        meta["frames_sampled"] = int(meta["frames_sampled"]) + 1
        meta["frames_read_ok"] = int(meta["frames_read_ok"]) + 1

        h, w = frame.shape[:2]
        x = int(project.roi_x * w)
        y = int(project.roi_y * h)
        rw = int(project.roi_w * w)
        rh = int(project.roi_h * h)
        crop = frame[y : y + rh, x : x + rw]
        if crop.size == 0:
            meta["roi_empty_count"] = int(meta["roi_empty_count"]) + 1
            continue

        # Downscale ROI before OCR to reduce compute while preserving subtitle readability.
        ch, cw = crop.shape[:2]
        if cw > 960:
            scale = 960.0 / float(cw)
            crop = cv2.resize(crop, (960, max(1, int(ch * scale))), interpolation=cv2.INTER_AREA)
            meta["pre_resize_scale"] = round(scale, 4)
            meta["pre_resize_applied"] = True
        else:
            meta.setdefault("pre_resize_scale", 1.0)
            meta.setdefault("pre_resize_applied", False)

        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

        # Smart skip: if sampled frame is visually almost identical, skip OCR for this frame.
        tiny = cv2.resize(gray, (48, 20), interpolation=cv2.INTER_AREA)
        sig_mean = int(tiny.mean())
        sig_std = int(tiny.std())
        sig_diff = 0
        if last_signature is not None:
            sig_diff = abs(sig_mean - last_signature[0]) + abs(sig_std - last_signature[1])
        should_skip_similar = (
            last_signature is not None
            and sig_diff <= 2
            and bool(segments)
            and consecutive_similar_skips < 2
        )
        if should_skip_similar:
            meta["skipped_similar_frame_count"] = int(meta["skipped_similar_frame_count"]) + 1
            consecutive_similar_skips += 1
            if segments:
                extended_end = (idx / fps) + max(0.5, effective_scan_interval)
                segments[-1]["end_sec"] = max(float(segments[-1]["end_sec"]), float(extended_end))
                meta["duplicate_extend_count"] = int(meta["duplicate_extend_count"]) + 1
            continue
        consecutive_similar_skips = 0
        last_signature = (sig_mean, sig_std, sig_diff)

        best_text = ""
        best_score = 0.0
        best_variant = ""
        for variant_name, variant_img in _build_ocr_variants(cv2, gray, variant_profile):
            meta["ocr_variant_attempts"] = int(meta["ocr_variant_attempts"]) + 1
            result = engine(variant_img)
            # rapidocr tra ve tuple (ocr_result, elapsed)
            ocr_result = result[0] if isinstance(result, tuple) else result
            if not ocr_result:
                continue
            candidate_text, candidate_score = _extract_best_ocr_text(ocr_result)
            if len(candidate_text) < 2:
                continue
            if (
                not best_text
                or candidate_score > best_score
                or (candidate_score == best_score and len(candidate_text) > len(best_text))
            ):
                best_text = candidate_text
                best_score = candidate_score
                best_variant = variant_name

        if not best_text:
            continue
        meta["ocr_hit_frames"] = int(meta["ocr_hit_frames"]) + 1
        meta["ocr_variant_hits"] = int(meta["ocr_variant_hits"]) + 1
        variant_best = meta.setdefault("ocr_variant_best", {})
        variant_best[best_variant] = int(variant_best.get(best_variant, 0)) + 1

        text = best_text
        if len(text) < 2:
            meta["ignored_short_text"] = int(meta["ignored_short_text"]) + 1
            continue
        if text == last_text:
            if segments:
                extended_end = (idx / fps) + max(0.5, effective_scan_interval)
                segments[-1]["end_sec"] = max(float(segments[-1]["end_sec"]), float(extended_end))
                meta["duplicate_extend_count"] = int(meta["duplicate_extend_count"]) + 1
            continue

        start_sec = idx / fps
        end_sec = start_sec + max(1.2, effective_scan_interval * 1.5)
        last_text = text
        segments.append(
            {
                "start_sec": start_sec,
                "end_sec": end_sec,
                "raw_text": text,
                "translated_text": "",
                "speaker": "narrator",
                "voice": "narrator-neutral",
                "confidence": best_score or 0.8,
            }
        )

        if progress_hook and (int(meta["frames_sampled"]) % 3 == 0):
            progress_hook(meta.copy())

    producer.join(timeout=1.0)
    cap.release()
    if producer_error:
        meta["producer_error"] = producer_error[0][:240]
    meta["segments_before_merge"] = len(segments)
    if progress_hook:
        progress_hook(meta.copy())
    return segments, meta


def _apply_glossary(text: str, glossary: str) -> str:
    for raw in glossary.splitlines():
        row = raw.strip()
        if not row or "=" not in row:
            continue
        src, dst = row.split("=", 1)
        text = text.replace(src.strip(), dst.strip())
    return text


def _normalize_text_for_compare(text: str) -> str:
    text = (text or "").strip().lower()
    text = re.sub(r"\s+", "", text)
    # Remove common punctuation so OCR jitter does not create false new lines.
    text = re.sub(r"[.,;:!?\"'`~\-_=+*/\\|()[\]{}<>，。！？；：、]", "", text)
    return text


def _is_similar_text(a: str, b: str, ratio_threshold: float = 0.9) -> bool:
    na = _normalize_text_for_compare(a)
    nb = _normalize_text_for_compare(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if len(na) >= 6 and (na in nb or nb in na):
        return True
    ratio = SequenceMatcher(None, na, nb).ratio()
    return ratio >= ratio_threshold


def _merge_adjacent_similar_segments(
    segments: list[dict[str, Any]],
    max_gap_sec: float = 1.0,
    ratio_threshold: float = 0.9,
) -> list[dict[str, Any]]:
    if not segments:
        return []
    ordered = sorted(segments, key=lambda x: float(x["start_sec"]))
    merged: list[dict[str, Any]] = [ordered[0].copy()]
    for seg in ordered[1:]:
        prev = merged[-1]
        gap = float(seg["start_sec"]) - float(prev["end_sec"])
        if gap <= max_gap_sec and _is_similar_text(prev.get("raw_text", ""), seg.get("raw_text", ""), ratio_threshold):
            prev["end_sec"] = max(float(prev["end_sec"]), float(seg["end_sec"]))
            prev_raw = str(prev.get("raw_text", "")).strip()
            cur_raw = str(seg.get("raw_text", "")).strip()
            # Keep the longer candidate as representative source text.
            if len(cur_raw) > len(prev_raw):
                prev["raw_text"] = cur_raw
            prev_translated = str(prev.get("translated_text", "")).strip()
            cur_translated = str(seg.get("translated_text", "")).strip()
            if len(cur_translated) > len(prev_translated):
                prev["translated_text"] = cur_translated
            prev["confidence"] = max(float(prev.get("confidence", 0.0)), float(seg.get("confidence", 0.0)))
            continue
        merged.append(seg.copy())
    return merged


def _call_gemini_translate(
    text: str,
    prompt: str,
    api_key: str,
    source_lang: str,
    target_lang: str,
    context_before: str = "",
    context_after: str = "",
) -> tuple[str, str]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={api_key}"
    system_prompt = (
        "You are expert subtitle translator. Keep tone natural, concise, and cinematic. "
        f"Translate from {source_lang} to {target_lang}. "
        "Preserve meaning, intent, and implied context. Keep pronouns and relationship terms consistent. "
        "Return only translated text for CURRENT_LINE."
    )
    if prompt:
        system_prompt = f"{system_prompt}\nStyle and domain instructions:\n{prompt}"
    user_payload = (
        "CONTEXT_BEFORE:\n"
        f"{context_before or '(none)'}\n\n"
        "CURRENT_LINE:\n"
        f"{text}\n\n"
        "CONTEXT_AFTER:\n"
        f"{context_after or '(none)'}\n\n"
        "Output only the translation of CURRENT_LINE."
    )
    body = {
        "contents": [
            {
                "parts": [
                    {"text": system_prompt},
                    {"text": user_payload},
                ]
            }
        ]
    }
    payload = json.dumps(body).encode("utf-8")
    req = request.Request(url, data=payload, method="POST", headers={"Content-Type": "application/json"})
    try:
        with request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            out = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
                .strip()
            )
            return out, ""
    except error.HTTPError as ex:
        body = ""
        try:
            body = ex.read().decode("utf-8", errors="ignore")
        except Exception:
            body = ""
        return "", f"gemini_http_{ex.code}:{body[:300]}"
    except error.URLError as ex:
        return "", f"gemini_url_error:{ex.reason}"
    except Exception as ex:
        return "", f"gemini_exception:{str(ex)[:300]}"


def _extract_json_block(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return raw
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", raw, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        return fenced.group(1).strip()
    return raw


def _call_gemini_translate_batch(
    lines: list[str],
    prompt: str,
    api_key: str,
    source_lang: str,
    target_lang: str,
    context_before: str = "",
    context_after: str = "",
) -> tuple[list[str], str]:
    if not lines:
        return [], ""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={api_key}"
    system_prompt = (
        "You are expert subtitle translator. "
        f"Translate from {source_lang} to {target_lang}. "
        "Translate with full context continuity and keep natural spoken Vietnamese. "
        "Return ONLY strict JSON with schema: {\"translations\": [\"...\"]}. "
        "The output list length must equal input lines length and preserve order."
    )
    if prompt:
        system_prompt = f"{system_prompt}\nStyle and domain instructions:\n{prompt}"

    numbered = "\n".join([f"{i+1}. {line}" for i, line in enumerate(lines)])
    user_payload = (
        "CONTEXT_BEFORE:\n"
        f"{context_before or '(none)'}\n\n"
        "LINES_TO_TRANSLATE:\n"
        f"{numbered}\n\n"
        "CONTEXT_AFTER:\n"
        f"{context_after or '(none)'}\n\n"
        "Output strict JSON only."
    )
    body = {
        "contents": [
            {
                "parts": [
                    {"text": system_prompt},
                    {"text": user_payload},
                ]
            }
        ]
    }
    payload = json.dumps(body).encode("utf-8")
    req = request.Request(url, data=payload, method="POST", headers={"Content-Type": "application/json"})
    try:
        with request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            out = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
                .strip()
            )
            parsed_text = _extract_json_block(out)
            parsed = json.loads(parsed_text)
            arr = parsed.get("translations", [])
            if not isinstance(arr, list):
                return [], "gemini_batch_invalid_json_schema"
            cleaned = [str(x).strip() for x in arr]
            if len(cleaned) != len(lines) or any(not x for x in cleaned):
                return [], f"gemini_batch_length_mismatch:{len(cleaned)}!={len(lines)}"
            return cleaned, ""
    except error.HTTPError as ex:
        body = ""
        try:
            body = ex.read().decode("utf-8", errors="ignore")
        except Exception:
            body = ""
        return [], f"gemini_batch_http_{ex.code}:{body[:300]}"
    except error.URLError as ex:
        return [], f"gemini_batch_url_error:{ex.reason}"
    except Exception as ex:
        return [], f"gemini_batch_exception:{str(ex)[:300]}"


def _translate_with_fallback(
    text: str,
    prompt: str,
    api_key: str | None,
    backup_api_key: str | None,
    invalid_keys: set[str] | None,
    source_lang: str,
    target_lang: str,
    context_before: str = "",
    context_after: str = "",
) -> tuple[str, str, str]:
    invalid_keys = invalid_keys or set()
    candidate_keys: list[str] = []
    if api_key and api_key not in candidate_keys:
        candidate_keys.append(api_key)
    if backup_api_key and backup_api_key not in candidate_keys:
        candidate_keys.append(backup_api_key)

    err = ""
    for idx, candidate in enumerate(candidate_keys):
        if candidate in invalid_keys:
            continue
        translated, err = _call_gemini_translate(
            text,
            prompt,
            candidate,
            source_lang,
            target_lang,
            context_before=context_before,
            context_after=context_after,
        )
        if translated:
            return translated, "gemini", ""
        # Retry with fallback key only when current key is invalid.
        if _is_gemini_key_error(err):
            invalid_keys.add(candidate)
            continue
        if idx == 0:
            break
    try:
        from deep_translator import GoogleTranslator  # type: ignore

        translated = GoogleTranslator(source="auto", target=target_lang).translate(text)
        if translated:
            return str(translated).strip(), "deep_translator", ""
    except Exception as ex:
        dt_err = f"deep_translator_exception:{str(ex)[:300]}"
    else:
        dt_err = "deep_translator_empty"
    final_err = err if api_key else "gemini_skipped_no_key"
    return f"[{target_lang}] {text}", "fallback_tag", f"{final_err} | {dt_err}"


def _resolve_gemini_keys(runtime_key: str | None) -> tuple[str | None, str | None]:
    runtime = (runtime_key or "").strip()
    keys = (get_settings().gemini_api_keys or "").strip()
    env_keys = [item.strip() for item in keys.split(",") if item.strip()]

    primary = runtime or (env_keys[0] if env_keys else "")
    backup = next((k for k in env_keys if k != primary), "")
    return (primary or None), (backup or None)


def _is_gemini_key_error(err: str) -> bool:
    t = (err or "").lower()
    return ("api key not valid" in t) or ("api_key_invalid" in t) or ("invalid_argument" in t and "api key" in t)


def _translate_project_segments(
    db: Session,
    project: Project,
    primary_api_key: str | None,
    backup_api_key: str | None,
    voice_map: dict[str, str] | None = None,
    progress_hook: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int], str, dict[str, Any]]:
    voice_map = voice_map or {}
    db_segments = list_segments(db, project.id)
    normalized = []
    translation_stats = {"gemini": 0, "deep_translator": 0, "fallback_tag": 0}
    first_translation_error = ""
    fallback_samples: list[dict[str, Any]] = []
    gemini_error_count = 0
    deep_translator_error_count = 0
    batch_prefill: dict[int, str] = {}
    gemini_batch_chunks_ok = 0
    gemini_batch_chunks_failed = 0
    gemini_batch_lines_ok = 0
    invalid_gemini_keys: set[str] = set()

    if (primary_api_key or backup_api_key) and len(db_segments) >= 2:
        chunk_size = 8
        for start in range(0, len(db_segments), chunk_size):
            chunk = db_segments[start : start + chunk_size]
            lines = [seg.raw_text for seg in chunk]
            ctx_before = db_segments[start - 1].raw_text if start > 0 else ""
            end_idx = start + len(chunk)
            ctx_after = db_segments[end_idx].raw_text if end_idx < len(db_segments) else ""
            batch_key = primary_api_key
            if (not batch_key) or (batch_key in invalid_gemini_keys):
                batch_key = backup_api_key
            translated_chunk, batch_err = _call_gemini_translate_batch(
                lines,
                project.prompt,
                batch_key or "",
                project.source_lang,
                project.target_lang,
                context_before=ctx_before,
                context_after=ctx_after,
            )
            if (
                (not translated_chunk)
                and _is_gemini_key_error(batch_err)
                and batch_key
                and backup_api_key
                and batch_key != backup_api_key
            ):
                invalid_gemini_keys.add(batch_key)
                translated_chunk, batch_err = _call_gemini_translate_batch(
                    lines,
                    project.prompt,
                    backup_api_key,
                    project.source_lang,
                    project.target_lang,
                    context_before=ctx_before,
                    context_after=ctx_after,
                )
            if translated_chunk and len(translated_chunk) == len(chunk):
                gemini_batch_chunks_ok += 1
                gemini_batch_lines_ok += len(chunk)
                for seg_item, out_text in zip(chunk, translated_chunk):
                    batch_prefill[seg_item.id] = out_text
            else:
                gemini_batch_chunks_failed += 1
                if batch_err and not first_translation_error:
                    first_translation_error = batch_err
                if "gemini_batch_" in batch_err:
                    gemini_error_count += 1

    for idx, seg in enumerate(db_segments):
        prev_text = db_segments[idx - 1].raw_text if idx > 0 else ""
        next_text = db_segments[idx + 1].raw_text if idx + 1 < len(db_segments) else ""
        if seg.id in batch_prefill:
            txt = batch_prefill[seg.id]
            provider = "gemini"
            err = ""
        else:
            txt, provider, err = _translate_with_fallback(
                seg.raw_text,
                project.prompt,
                primary_api_key,
                backup_api_key,
                invalid_gemini_keys,
                project.source_lang,
                project.target_lang,
                context_before=prev_text,
                context_after=next_text,
            )
        if provider in translation_stats:
            translation_stats[provider] += 1
        if err and not first_translation_error:
            first_translation_error = err
        if "gemini_" in err:
            gemini_error_count += 1
        if "deep_translator_" in err:
            deep_translator_error_count += 1
        if provider != "gemini" and len(fallback_samples) < 12:
            fallback_samples.append(
                {
                    "segment_id": seg.id,
                    "provider": provider,
                    "error": err[:240] if err else "",
                    "raw_excerpt": (seg.raw_text or "")[:80],
                }
            )
        txt = _apply_glossary(txt, project.glossary)
        speaker = seg.speaker
        voice = voice_map.get(speaker, seg.voice)
        normalized.append(
            {
                "start_sec": seg.start_sec,
                "end_sec": seg.end_sec,
                "raw_text": seg.raw_text,
                "translated_text": txt,
                "speaker": speaker,
                "voice": voice,
                "confidence": seg.confidence,
            }
        )
        if progress_hook:
            progress_hook(
                {
                    "done": len(normalized),
                    "total": len(db_segments),
                    "provider_counts": translation_stats.copy(),
                }
            )
    translate_detail = {
        "total_segments": len(db_segments),
        "used_runtime_key": bool(primary_api_key),
        "fallback_key_enabled": bool(backup_api_key),
        "provider_counts": translation_stats.copy(),
        "gemini_error_count": gemini_error_count,
        "deep_translator_error_count": deep_translator_error_count,
        "gemini_batch_chunks_ok": gemini_batch_chunks_ok,
        "gemini_batch_chunks_failed": gemini_batch_chunks_failed,
        "gemini_batch_lines_ok": gemini_batch_lines_ok,
        "fallback_samples": fallback_samples,
    }
    return normalized, translation_stats, first_translation_error, translate_detail


def retranslate_project_segments(project_id: str, gemini_api_key: str | None = None) -> dict[str, Any]:
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if not project:
            return {"ok": False, "error": "project_not_found"}
        primary_key, backup_key = _resolve_gemini_keys(gemini_api_key)
        normalized, translation_stats, first_translation_error, _ = _translate_project_segments(
            db,
            project,
            primary_key,
            backup_key,
            voice_map={},
        )
        replace_segments(db, project.id, normalized)
        updated = list_segments(db, project.id)
        return {
            "ok": True,
            "translation_stats": translation_stats,
            "translation_error_hint": first_translation_error,
            "segments": updated,
        }
    except Exception as ex:
        return {"ok": False, "error": str(ex)}
    finally:
        db.close()


def run_pipeline(
    job_id: str,
    input_mode: str = "video_ocr",
    gemini_api_key: str | None = None,
    voice_map: dict[str, str] | None = None,
    scan_interval_sec: float = 1.5,
) -> dict[str, Any]:
    db = SessionLocal()
    voice_map = voice_map or {}
    try:
        primary_key, backup_key = _resolve_gemini_keys(gemini_api_key)
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

        artifacts = prepare_job_artifacts(job)
        pipeline_input_mode = (input_mode or "video_ocr").strip().lower()
        requested_scan_interval = float(scan_interval_sec)
        effective_scan_interval = requested_scan_interval
        estimated_samples = 0
        fps_probe = 0.0
        frames_probe = 0
        try:
            if project.video_path:
                import cv2  # type: ignore

                cap_probe = cv2.VideoCapture(str(project.video_path))
                fps_probe = float(cap_probe.get(cv2.CAP_PROP_FPS) or 0.0)
                frames_probe = int(cap_probe.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
                cap_probe.release()
                effective_scan_interval, estimated_samples = _compute_effective_scan_interval(
                    fps=fps_probe,
                    total_frames=frames_probe,
                    requested_interval_sec=requested_scan_interval,
                )
        except Exception:
            effective_scan_interval = requested_scan_interval
            estimated_samples = 0
        push_event(
            job,
            artifacts,
            "pipeline",
            (
                f"Bat dau pipeline mode={pipeline_input_mode}, interval OCR yeu cau={requested_scan_interval:.2f}s, "
                f"hieu dung={effective_scan_interval:.2f}s, voice_map={len(voice_map)}."
            ),
            1,
            logger_name="pipeline",
        )
        set_stat(
            artifacts,
            "pipeline",
            {
                "project_id": project.id,
                "source_lang": project.source_lang,
                "target_lang": project.target_lang,
                "input_mode": pipeline_input_mode,
                "scan_interval_sec": requested_scan_interval,
                "effective_scan_interval_sec": effective_scan_interval,
                "estimated_samples": estimated_samples,
                "video_fps": fps_probe,
                "video_frames": frames_probe,
                "voice_map_size": len(voice_map),
                "gemini_key_present": bool(primary_key),
                "gemini_fallback_key_enabled": bool(backup_key),
            },
        )
        _update_job(db, job, JobStatus.running, 1, "init", artifacts=artifacts)
        if pipeline_input_mode == "video_ocr":
            push_event(job, artifacts, "ocr", "Dang tach video thanh frame va OCR...", 5, logger_name="pipeline")
            _update_job(db, job, JobStatus.running, 5, "ocr", artifacts=artifacts)
            last_ocr_progress = 5
            last_ocr_event_sample = 0

            def _on_ocr_progress(live_meta: dict[str, Any]) -> None:
                nonlocal last_ocr_progress, artifacts, last_ocr_event_sample
                sampled = int(live_meta.get("frames_sampled", 0) or 0)
                estimated = int(live_meta.get("estimated_samples", 0) or 0)
                if estimated > 0:
                    ratio = sampled / max(1, estimated)
                    progress = min(30, max(5, 5 + int(ratio * 25)))
                    progress_pct = min(100.0, max(0.0, ratio * 100.0))
                else:
                    progress = min(30, max(6, 5 + min(25, sampled // 2)))
                    progress_pct = 0.0
                ocr_hit_frames = int(live_meta.get("ocr_hit_frames", 0) or 0)
                duplicate_extend_count = int(live_meta.get("duplicate_extend_count", 0) or 0)
                skipped_similar_frame_count = int(live_meta.get("skipped_similar_frame_count", 0) or 0)

                set_stat(
                    artifacts,
                    "ocr_live",
                    {
                        "frames_sampled": sampled,
                        "estimated_samples": estimated,
                        "estimated_samples_known": bool(estimated > 0),
                        "progress_pct": round(progress_pct, 2),
                        "ocr_hit_frames": ocr_hit_frames,
                        "duplicate_extend_count": duplicate_extend_count,
                        "skipped_similar_frame_count": skipped_similar_frame_count,
                    },
                )
                if progress > last_ocr_progress:
                    last_ocr_progress = progress
                    _update_job(db, job, JobStatus.running, progress, "ocr", artifacts=artifacts)

                min_sample_step = max(5, estimated // 20) if estimated > 0 else 10
                if sampled - last_ocr_event_sample >= min_sample_step or (estimated > 0 and sampled >= estimated):
                    last_ocr_event_sample = sampled
                    if estimated > 0:
                        msg = (
                            f"OCR dang chay: da tach {sampled}/{estimated} frame "
                            f"({progress_pct:.1f}%), frame co text={ocr_hit_frames}, "
                            f"bo qua tuong tu={skipped_similar_frame_count}, noi doan={duplicate_extend_count}."
                        )
                    else:
                        msg = (
                            f"OCR dang chay: da xu ly {sampled} frame "
                            f"(chua uoc luong duoc tong so frame), frame co text={ocr_hit_frames}, "
                            f"bo qua tuong tu={skipped_similar_frame_count}, noi doan={duplicate_extend_count}."
                        )
                    push_event(
                        job,
                        artifacts,
                        "ocr",
                        msg,
                        progress,
                        logger_name="pipeline",
                    )
                    _update_job(db, job, JobStatus.running, progress, "ocr", artifacts=artifacts)

            variant_profile = (get_settings().ocr_profile or "balanced").strip().lower()
            if estimated_samples >= int(get_settings().ocr_long_video_threshold_samples):
                variant_profile = "fast"

            segments, ocr_meta = _ocr_segments_from_video(
                project,
                scan_interval_sec=effective_scan_interval,
                variant_profile=variant_profile,
                progress_hook=_on_ocr_progress,
            )
            ocr_source = "rapidocr"
            if not segments:
                push_event(
                    job,
                    artifacts,
                    "ocr",
                    "OCR that khong co ket qua, fallback sang mau subtitle gia lap.",
                    12,
                    level="warning",
                    logger_name="pipeline",
                )
                segments = _fake_ocr_segments(project)
                ocr_source = "fake_fallback"
                ocr_meta = {
                    **ocr_meta,
                    "engine": "fake_fallback",
                    "segments_before_merge": len(segments),
                }
            set_stat(
                artifacts,
                "ocr",
                {
                    **ocr_meta,
                    "source": ocr_source,
                    "segments_raw": len(segments),
                },
            )
            push_event(
                job,
                artifacts,
                "ocr",
                f"OCR xong: {len(segments)} doan text (source={ocr_source}).",
                28,
                logger_name="pipeline",
            )
            segments = _merge_adjacent_similar_segments(
                segments,
                max_gap_sec=max(0.8, effective_scan_interval * 1.5),
                ratio_threshold=0.9,
            )
            set_stat(
                artifacts,
                "dedupe_ocr",
                {
                    "before": int(ocr_meta.get("segments_before_merge", len(segments))),
                    "after": len(segments),
                },
            )
            push_event(job, artifacts, "ocr", f"Sau merge OCR: {len(segments)} doan.", 34, logger_name="pipeline")

        replace_segments(db, project.id, segments)

        push_event(
            job,
            artifacts,
            "translate",
            f"Bat dau dich {len(segments)} doan, gemini_key={'co' if primary_key else 'khong'}, backup_key={'co' if backup_key else 'khong'}.",
            35,
            logger_name="pipeline",
        )
        _update_job(db, job, JobStatus.running, 35, "translate", artifacts=artifacts)
        last_translate_progress = 35

        def _on_translate_progress(live: dict[str, Any]) -> None:
            nonlocal last_translate_progress, artifacts
            total = int(live.get("total", 0) or 0)
            done = int(live.get("done", 0) or 0)
            if total <= 0:
                return
            progress = min(64, max(35, 35 + int((done / total) * 29)))
            if progress <= last_translate_progress:
                return
            last_translate_progress = progress
            set_stat(
                artifacts,
                "translate_live",
                {
                    "done": done,
                    "total": total,
                    "provider_counts": live.get("provider_counts", {}),
                },
            )
            _update_job(db, job, JobStatus.running, progress, "translate", artifacts=artifacts)

        normalized, translation_stats, first_translation_error, translate_detail = _translate_project_segments(
            db,
            project,
            primary_key,
            backup_key,
            voice_map=voice_map,
            progress_hook=_on_translate_progress,
        )
        set_stat(
            artifacts,
            "translate",
            {
                **translate_detail,
                "first_error": first_translation_error[:320] if first_translation_error else "",
            },
        )
        if translation_stats.get("fallback_tag", 0) > 0:
            push_event(
                job,
                artifacts,
                "translate",
                f"Co {translation_stats['fallback_tag']} doan fallback tag vi dich that bai.",
                58,
                level="warning",
                logger_name="pipeline",
            )
        if translation_stats.get("deep_translator", 0) > 0:
            push_event(
                job,
                artifacts,
                "translate",
                f"Deep-translator duoc dung cho {translation_stats['deep_translator']} doan.",
                60,
                logger_name="pipeline",
            )
        push_event(
            job,
            artifacts,
            "translate",
            f"Dich xong: gemini={translation_stats.get('gemini', 0)}, deep_translator={translation_stats.get('deep_translator', 0)}, fallback={translation_stats.get('fallback_tag', 0)}.",
            64,
            logger_name="pipeline",
        )

        push_event(job, artifacts, "dedupe_merge", "Dang merge subtitle trung lap lan cuoi...", 65, logger_name="pipeline")
        _update_job(db, job, JobStatus.running, 65, "dedupe_merge", artifacts=artifacts)
        # MVP: bo qua merge nang cao, chi loai dong trung lien tiep.
        deduped = _merge_adjacent_similar_segments(
            normalized,
            max_gap_sec=max(
                0.8,
                effective_scan_interval * 1.5,
            ),
            ratio_threshold=0.92,
        )
        set_stat(
            artifacts,
            "dedupe_final",
            {
                "before": len(normalized),
                "after": len(deduped),
                "removed": max(0, len(normalized) - len(deduped)),
            },
        )
        push_event(job, artifacts, "dedupe_merge", f"Merge xong: {len(normalized)} -> {len(deduped)} doan.", 78, logger_name="pipeline")
        replace_segments(db, project.id, deduped)

        push_event(job, artifacts, "tts", "Dang tao tts_lines.txt cho long tieng...", 80, logger_name="pipeline")
        _update_job(db, job, JobStatus.running, 80, "tts", artifacts=artifacts)
        project_dir = Path(project.video_path).parent if project.video_path else Path.cwd()
        tts_script = project_dir / "tts_lines.txt"
        with tts_script.open("w", encoding="utf-8") as f:
            for seg in deduped:
                f.write(f"{seg['start_sec']:.2f}-{seg['end_sec']:.2f} [{seg['voice']}] {seg['translated_text']}\n")
        set_stat(
            artifacts,
            "tts_script",
            {
                "path": str(tts_script),
                "lines": len(deduped),
            },
        )

        push_event(job, artifacts, "export", "Dang xuat SRT + JSON...", 90, logger_name="pipeline")
        _update_job(db, job, JobStatus.running, 90, "export", artifacts=artifacts)
        srt_path = project_dir / "output.vi.srt"
        json_path = project_dir / "output.project.json"

        export_subtitle_file(
            segments=deduped,
            output_path=srt_path,
            export_format="srt",
            content_mode="translated",
        )

        with json_path.open("w", encoding="utf-8") as f:
            json.dump(
                {
                    "project_id": project.id,
                    "name": project.name,
                    "source_lang": project.source_lang,
                    "target_lang": project.target_lang,
                    "segments": deduped,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )

        artifacts = {
            **artifacts,
            "srt": str(srt_path),
            "json": str(json_path),
            "tts_script": str(tts_script),
            "input_mode": pipeline_input_mode,
            "translation_stats": translation_stats,
            "translation_error_hint": first_translation_error,
        }
        set_stat(
            artifacts,
            "export",
            {
                "srt_path": str(srt_path),
                "json_path": str(json_path),
                "segments": len(deduped),
            },
        )
        push_event(job, artifacts, "done", "Pipeline hoan tat.", 100, logger_name="pipeline")
        _update_job(db, job, JobStatus.done, 100, "done", artifacts=artifacts)
        project.status = ProjectStatus.ready
        db.add(project)
        db.commit()
        return {"ok": True, "job_id": job_id, "artifacts": artifacts}
    except Exception as ex:
        job = db.get(PipelineJob, job_id)
        if job:
            artifacts = prepare_job_artifacts(job)
            push_event(
                job,
                artifacts,
                "error",
                f"Pipeline loi: {str(ex)[:320]}",
                int(job.progress if job.progress else 0),
                level="error",
                logger_name="pipeline",
            )
            _update_job(db, job, JobStatus.failed, job.progress if job.progress else 0, "error", str(ex), artifacts=artifacts)
        project = db.get(Project, job.project_id) if job else None
        if project:
            project.status = ProjectStatus.failed
            db.add(project)
            db.commit()
        return {"ok": False, "job_id": job_id, "error": str(ex)}
    finally:
        db.close()

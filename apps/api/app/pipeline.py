import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
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
        # cv2 không decode được codec gốc (HEVC, MKV, VP9, AV1...)
        # Thử transcode sang H.264 MP4 tạm bằng ffmpeg rồi retry.
        ffmpeg_bin = shutil.which("ffmpeg")
        if not ffmpeg_bin:
            meta["engine"] = "video_open_failed"
            meta["video_open_detail"] = "cv2 failed and ffmpeg not found"
            return [], meta
        tmp_path = video_path.parent / f"_ocr_tmp_{video_path.stem}.mp4"
        try:
            logger.info("cv2 không mở được %s — transcode sang H.264 tạm: %s", video_path.name, tmp_path.name)
            result = subprocess.run(
                [
                    ffmpeg_bin,
                    "-y",
                    "-i", str(video_path),
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-crf", "23",
                    "-an",          # bỏ âm thanh để nhanh hơn
                    str(tmp_path),
                ],
                capture_output=True,
                timeout=600,
            )
            if result.returncode != 0:
                meta["engine"] = "video_open_failed"
                meta["video_open_detail"] = (
                    f"ffmpeg transcode failed (code {result.returncode}): "
                    + result.stderr.decode("utf-8", errors="ignore")[-300:]
                )
                return [], meta
            cap = cv2.VideoCapture(str(tmp_path))
            if not cap.isOpened():
                tmp_path.unlink(missing_ok=True)
                meta["engine"] = "video_open_failed"
                meta["video_open_detail"] = "cv2 failed even after ffmpeg transcode to H.264"
                return [], meta
            meta["ffmpeg_transcode"] = True
            meta["transcode_tmp"] = str(tmp_path)
            video_path = tmp_path   # dùng file tạm cho phần còn lại
        except subprocess.TimeoutExpired:
            tmp_path.unlink(missing_ok=True)
            meta["engine"] = "video_open_failed"
            meta["video_open_detail"] = "ffmpeg transcode timeout (>600s)"
            return [], meta
        except Exception as ex:
            tmp_path.unlink(missing_ok=True)
            meta["engine"] = "video_open_failed"
            meta["video_open_detail"] = f"ffmpeg exception: {str(ex)[:200]}"
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
                if frame_idx % sample_step == 0:
                    # Frame cần lấy ảnh: grab + decode đầy đủ
                    ok, frame = cap.read()
                    if not ok or frame is None:
                        break
                    sampled += 1
                    frame_queue.put((frame_idx, frame))
                else:
                    # Frame bỏ qua: chỉ dịch chuyển con trỏ, KHÔNG decode
                    ok = cap.grab()
                    if not ok:
                        break
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
            and sig_diff <= 3
            and bool(segments)
        )
        if should_skip_similar:
            meta["skipped_similar_frame_count"] = int(meta["skipped_similar_frame_count"]) + 1
            consecutive_similar_skips += 1
            if segments:
                # Extend end_sec liên tục theo frame hiện tại để lấp đầy khoảng trống
                extended_end = (idx / fps) + max(0.4, effective_scan_interval * 0.6)
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
        # end_sec ban đầu ngắn hơn để bước post-process tự snap/fill sau
        end_sec = start_sec + max(0.8, effective_scan_interval)
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
    # Dọn file tạm nếu đã transcode bằng ffmpeg
    transcode_tmp = meta.get("transcode_tmp")
    if transcode_tmp:
        try:
            Path(transcode_tmp).unlink(missing_ok=True)
        except Exception:
            pass
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


def _fill_subtitle_gaps(
    segments: list[dict[str, Any]],
    max_gap_to_fill_sec: float = 1.5,
    min_gap_between_sec: float = 0.04,
) -> list[dict[str, Any]]:
    """Post-process: snap end_sec về sát start_sec tiếp theo nếu gap nhỏ.
    Giúp loại bỏ khoảng trắng thừa và đảm bảo phụ đề liên tục hơn."""
    if len(segments) < 2:
        return segments
    result = [seg.copy() for seg in segments]
    for i in range(len(result) - 1):
        cur = result[i]
        nxt = result[i + 1]
        cur_end = float(cur["end_sec"])
        nxt_start = float(nxt["start_sec"])
        gap = nxt_start - cur_end
        if gap <= 0:
            # Overlap: cắt bớt end_sec để không overlap
            cur["end_sec"] = max(float(cur["start_sec"]) + 0.1, nxt_start - min_gap_between_sec)
        elif gap <= max_gap_to_fill_sec:
            # Khoảng trống nhỏ: extend end_sec lên gần start tiếp theo
            cur["end_sec"] = nxt_start - min_gap_between_sec
        # Nếu gap lớn hơn max_gap_to_fill_sec → giữ nguyên (cố ý ngừng)
    return result


def _call_gemini_translate(
    text: str,
    prompt: str,
    api_key: str,
    source_lang: str,
    target_lang: str,
    context_before: str = "",
    context_after: str = "",
    model_name: str = "gemini-2.5-flash-lite",
) -> tuple[str, str]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
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
        err_str = f"gemini_http_{ex.code}:{body[:300]}"
        logger.warning("[Gemini] Lỗi HTTP %s | key=***%s | %s", ex.code, api_key[-6:] if api_key and len(api_key) > 6 else "?", body[:200])
        return "", err_str
    except error.URLError as ex:
        logger.warning("[Gemini] Lỗi mạng (URLError) | key=***%s | reason=%s", api_key[-6:] if api_key and len(api_key) > 6 else "?", ex.reason)
        return "", f"gemini_url_error:{ex.reason}"
    except Exception as ex:
        logger.warning("[Gemini] Exception | key=***%s | %s", api_key[-6:] if api_key and len(api_key) > 6 else "?", str(ex)[:200])
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
    model_name: str = "gemini-2.5-flash-lite",
) -> tuple[list[str], str]:
    if not lines:
        return [], ""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
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
        err_str = f"gemini_batch_http_{ex.code}:{body[:300]}"
        logger.warning("[Gemini-Batch] Lỗi HTTP %s | key=***%s | model=%s | %s", ex.code, api_key[-6:] if api_key and len(api_key) > 6 else "?", model_name, body[:200])
        return [], err_str
    except error.URLError as ex:
        logger.warning("[Gemini-Batch] Lỗi mạng (URLError) | key=***%s | model=%s | reason=%s", api_key[-6:] if api_key and len(api_key) > 6 else "?", model_name, ex.reason)
        return [], f"gemini_batch_url_error:{ex.reason}"
    except Exception as ex:
        logger.warning("[Gemini-Batch] Exception | key=***%s | model=%s | %s", api_key[-6:] if api_key and len(api_key) > 6 else "?", model_name, str(ex)[:200])
        return [], f"gemini_batch_exception:{str(ex)[:300]}"


def _load_persistent_gemini_keys() -> list[str]:
    """Load Gemini keys từ file persistent /data/config/gemini_keys.txt."""
    try:
        from pathlib import Path as _Path
        storage_root = _Path(get_settings().storage_root).resolve()
        key_file = storage_root.parent / "config" / "gemini_keys.txt"
        if key_file.exists():
            raw = key_file.read_text(encoding="utf-8").strip()
            return [k.strip() for k in raw.split(",") if k.strip()]
    except Exception:
        pass
    return []


def _resolve_gemini_keys_list(runtime_key: str | None) -> list[str]:
    """Trả về danh sách tất cả Gemini API key theo thứ tự ưu tiên.
    Runtime key (từ form) được đặt lên đầu, tiếp theo là persistent file, rồi .env."""
    runtime_raw = (runtime_key or "").strip()
    runtime_keys = [item.strip() for item in runtime_raw.split(",") if item.strip()]
    
    # Đọc từ persistent file trước
    persistent_keys = _load_persistent_gemini_keys()
    
    # Fallback .env
    env_raw = (get_settings().gemini_api_keys or "").strip()
    env_keys = [item.strip() for item in env_raw.split(",") if item.strip()]
    
    all_keys: list[str] = []
    for k in runtime_keys:
        if k not in all_keys:
            all_keys.append(k)
    for k in persistent_keys:
        if k not in all_keys:
            all_keys.append(k)
    for k in env_keys:
        if k not in all_keys:
            all_keys.append(k)
    return all_keys


def _resolve_gemini_keys(runtime_key: str | None) -> tuple[str | None, str | None]:
    """Backward-compat: trả về (primary, backup) từ danh sách đầy đủ."""
    all_keys = _resolve_gemini_keys_list(runtime_key)
    primary = all_keys[0] if len(all_keys) >= 1 else None
    backup = all_keys[1] if len(all_keys) >= 2 else None
    return primary, backup


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
    all_keys: list[str] | None = None,
    key_switch_log: list[dict] | None = None,
    models: list[str] | None = None,
) -> tuple[str, str, str]:
    """Dịch với fallback qua tất cả key có sẵn, với mỗi key gọi qua list models. Log chi tiết."""
    invalid_keys = invalid_keys or set()
    # Xây dựng danh sách key ứng viên: all_keys ưu tiên nếu có, else dùng api_key+backup
    if all_keys:
        candidate_keys = [k for k in all_keys if k]
    else:
        candidate_keys = []
        if api_key:
            candidate_keys.append(api_key)
        if backup_api_key and backup_api_key not in candidate_keys:
            candidate_keys.append(backup_api_key)

    models_to_try = [m.strip() for m in models if m.strip()] if models else ["gemini-2.5-flash-lite"]
    err = ""
    tried_count = 0
    for idx, candidate in enumerate(candidate_keys):
        if candidate in invalid_keys:
            if key_switch_log is not None:
                key_switch_log.append({
                    "action": "skip_invalid",
                    "key_index": idx,
                    "key_suffix": candidate[-6:] if len(candidate) > 6 else "***",
                })
            continue
        
        for m_idx, model_name in enumerate(models_to_try):
            tried_count += 1
            translated, err = _call_gemini_translate(
                text,
                prompt,
                candidate,
                source_lang,
                target_lang,
                context_before=context_before,
                context_after=context_after,
                model_name=model_name,
            )
            if translated:
                if key_switch_log is not None and tried_count > 1:
                    key_switch_log.append({
                        "action": "success_on_fallback",
                        "key_index": idx,
                        "key_suffix": candidate[-6:] if len(candidate) > 6 else "***",
                        "model": model_name,
                    })
                return translated, "gemini", ""
            
            # Key lỗi → đánh dấu invalid và break để thử key tiếp theo
            if _is_gemini_key_error(err):
                invalid_keys.add(candidate)
                if key_switch_log is not None:
                    next_key = next((k for k in candidate_keys[idx+1:] if k not in invalid_keys), None)
                    key_switch_log.append({
                        "action": "key_invalid_switching",
                        "key_index": idx,
                        "key_suffix": candidate[-6:] if len(candidate) > 6 else "***",
                        "error": err[:200],
                        "switching_to_index": candidate_keys.index(next_key) if next_key else None,
                        "switching_to_suffix": next_key[-6:] if next_key and len(next_key) > 6 else None,
                    })
                break  # Không thử model tiếp theo cho key này
            
            # Lỗi không phải do key (rate limit, nghẽn mạng...) → thử model tiếp theo
            if key_switch_log is not None:
                key_switch_log.append({
                    "action": "non_key_error",
                    "key_index": idx,
                    "key_suffix": candidate[-6:] if len(candidate) > 6 else "***",
                    "model": model_name,
                    "error": err[:200],
                })
    try:
        from deep_translator import GoogleTranslator  # type: ignore

        translated = GoogleTranslator(source="auto", target=target_lang).translate(text)
        if translated:
            if key_switch_log is not None:
                key_switch_log.append({"action": "fallback_deep_translator", "result": "ok"})
            return str(translated).strip(), "deep_translator", ""
    except Exception as ex:
        dt_err = f"deep_translator_exception:{str(ex)[:300]}"
    else:
        dt_err = "deep_translator_empty"
    final_err = err if (api_key or candidate_keys) else "gemini_skipped_no_key"
    if key_switch_log is not None:
        key_switch_log.append({"action": "all_keys_failed", "final_err": final_err[:200], "dt_err": dt_err[:200]})
    return f"[{target_lang}] {text}", "fallback_tag", f"{final_err} | {dt_err}"


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
    all_api_keys: list[str] | None = None,
    models: list[str] | None = None,
    key_event_hook: Callable[[dict], None] | None = None,
    wait_for_key_hook: Callable[[str, str], list[str]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int], str, dict[str, Any]]:
    """Dịch toàn bộ segment. wait_for_key_hook(error_msg, last_err) → list key mới nếu user cấp, [] nếu bỏ qua."""
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
    _invalid_keys_lock = threading.Lock()
    key_switch_events: list[dict] = []  # Log rollback toàn bộ

    # Xây dựng danh sách key đầy đủ
    effective_all_keys: list[str] = all_api_keys if all_api_keys else []
    if not effective_all_keys:
        if primary_api_key:
            effective_all_keys.append(primary_api_key)
        if backup_api_key and backup_api_key not in effective_all_keys:
            effective_all_keys.append(backup_api_key)

    if effective_all_keys and len(db_segments) >= 2:
        chunk_size = 8
        # Chuẩn bị tất cả chunks để submit song song
        chunks_meta: list[tuple[int, list, str, str]] = []
        for start in range(0, len(db_segments), chunk_size):
            chunk = db_segments[start : start + chunk_size]
            ctx_before = db_segments[start - 1].raw_text if start > 0 else ""
            end_idx = start + len(chunk)
            ctx_after = db_segments[end_idx].raw_text if end_idx < len(db_segments) else ""
            chunks_meta.append((start, chunk, ctx_before, ctx_after))

        # Xác định số worker: tối đa 8, tối thiểu 1, không vượt số chunks
        max_parallel = min(8, len(chunks_meta))

        def _translate_one_chunk(
            args: tuple[int, list, str, str],
        ) -> tuple[int, list, list, str, list]:
            """Dịch một chunk, trả về (start, chunk, translated_lines, err, switch_log)."""
            start_idx, chunk, ctx_before, ctx_after = args
            lines = [seg.raw_text for seg in chunk]
            chunk_switch_log: list[dict] = []

            def _log_key_event(ev: dict) -> None:
                """Append vào switch_log VÀ push realtime qua hook nếu có."""
                chunk_switch_log.append(ev)
                if key_event_hook:
                    try:
                        key_event_hook(ev)
                    except Exception:
                        pass

            # Vòng lặp qua tất cả key cho đến khi thành công
            with _invalid_keys_lock:
                remaining_keys = [k for k in effective_all_keys if k not in invalid_gemini_keys]

            translated: list[str] = []
            err = ""
            models_to_try = [m.strip() for m in models if m.strip()] if models else ["gemini-2.5-flash-lite"]
            for k_idx, batch_key in enumerate(remaining_keys):
                key_is_invalid = False
                for model_name in models_to_try:
                    _log_key_event({
                        "action": "trying_key",
                        "key_index": effective_all_keys.index(batch_key) if batch_key in effective_all_keys else k_idx,
                        "key_suffix": batch_key[-6:] if len(batch_key) > 6 else "***",
                        "model": model_name,
                        "chunk_start": start_idx,
                    })
                    translated, err = _call_gemini_translate_batch(
                        lines,
                        project.prompt,
                        batch_key,
                        project.source_lang,
                        project.target_lang,
                        context_before=ctx_before,
                        context_after=ctx_after,
                        model_name=model_name,
                    )
                    if translated and len(translated) == len(lines):
                        if k_idx > 0 or model_name != models_to_try[0]:
                            _log_key_event({
                                "action": "success_on_fallback_key",
                                "key_suffix": batch_key[-6:] if len(batch_key) > 6 else "***",
                                "model": model_name,
                                "fallback_index": k_idx,
                            })
                        break  # Thành công, thoát vòng lặp models

                    # KEY bị lỗi (403/invalid) → không có ích gì thử tiếp model khác
                    if _is_gemini_key_error(err):
                        key_is_invalid = True
                        break  # Thoát models loop sớm — đãnh dấu kiểm tra nhóm key bên ngoài

                    # Lỗi khác (429 rate-limit, network...) → thử model tiếp theo trong cùng key
                    _log_key_event({
                        "action": "model_error_trying_next",
                        "key_suffix": batch_key[-6:] if len(batch_key) > 6 else "***",
                        "model": model_name,
                        "error": err[:200],
                    })

                if translated and len(translated) == len(lines):
                    break  # Thành công, thoát vòng lặp keys

                # Xử lý sau khi hết models của key này
                if key_is_invalid or _is_gemini_key_error(err):
                    with _invalid_keys_lock:
                        invalid_gemini_keys.add(batch_key)
                    next_key = next((k for k in remaining_keys[k_idx+1:] if k not in invalid_gemini_keys), None)
                    _log_key_event({
                        "action": "key_failed_switching",
                        "key_suffix": batch_key[-6:] if len(batch_key) > 6 else "***",
                        "error": err[:300],
                        "switching_to": next_key[-6:] if next_key and len(next_key) > 6 else ("none" if not next_key else "***"),
                    })
                else:
                    # Đã thử hết model của key này, chuyển sang key tiếp
                    _log_key_event({
                        "action": "chunk_error_trying_next",
                        "key_suffix": batch_key[-6:] if len(batch_key) > 6 else "***",
                        "error": err[:300],
                    })
            return start_idx, chunk, translated, err, chunk_switch_log

        batch_chunks_done = 0
        batch_total_segs = len(db_segments)
        with ThreadPoolExecutor(max_workers=max_parallel, thread_name_prefix="gemini-batch") as pool:
            futures = {pool.submit(_translate_one_chunk, args): args for args in chunks_meta}
            for future in as_completed(futures):
                start_idx, chunk, translated_chunk, batch_err, chunk_log = future.result()
                key_switch_events.extend(chunk_log)
                batch_chunks_done += len(chunk)
                if translated_chunk and len(translated_chunk) == len(chunk):
                    gemini_batch_chunks_ok += 1
                    gemini_batch_lines_ok += len(chunk)
                    for seg_item, out_text in zip(chunk, translated_chunk):
                        batch_prefill[seg_item.id] = out_text
                else:
                    gemini_batch_chunks_failed += 1
                    if batch_err and not first_translation_error:
                        first_translation_error = batch_err
                    if "gemini_batch_" in batch_err or "gemini_" in batch_err:
                        gemini_error_count += 1
                # Cập nhật UI sau mỗi chunk hoàn thành — tránh đứng ở 35%
                if progress_hook:
                    try:
                        progress_hook({
                            "done": min(batch_chunks_done, batch_total_segs),
                            "total": batch_total_segs,
                            "provider_counts": translation_stats.copy(),
                        })
                    except Exception:
                        pass

    # --- PAUSE và hỏi user trước khi fallback sang per-segment / deep_translator ---
    failed_chunks = sum(1 for s_id in [seg.id for seg in db_segments] if s_id not in batch_prefill)
    if failed_chunks > 0 and wait_for_key_hook and gemini_batch_chunks_failed > 0:
        last_err = first_translation_error or ""
        new_keys = wait_for_key_hook(
            f"{gemini_batch_chunks_failed} chunk bị thất bại, có {len(invalid_gemini_keys)} key lỗi.",
            last_err,
        )
        if new_keys:
            # User cấp key mới → cập nhật và retry cách chunk chưa dịch
            for nk in new_keys:
                if nk not in effective_all_keys:
                    effective_all_keys.append(nk)
            with _invalid_keys_lock:
                # Xóa các key lỗi khỏi tập invalid nếu user cấp key mới
                invalid_gemini_keys.clear()
            # Retry lại các chunk chưa dịch
            retry_chunks = [args for args in chunks_meta if args[1][0].id not in batch_prefill]
            if retry_chunks:
                with ThreadPoolExecutor(max_workers=min(4, len(retry_chunks)), thread_name_prefix="gemini-retry") as retry_pool:
                    retry_futures = {retry_pool.submit(_translate_one_chunk, args): args for args in retry_chunks}
                    for f in as_completed(retry_futures):
                        r_start, r_chunk, r_translated, r_err, r_log = f.result()
                        key_switch_events.extend(r_log)
                        if r_translated and len(r_translated) == len(r_chunk):
                            gemini_batch_chunks_ok += 1
                            gemini_batch_lines_ok += len(r_chunk)
                            for seg_item, out_text in zip(r_chunk, r_translated):
                                batch_prefill[seg_item.id] = out_text
                        else:
                            if r_err and not first_translation_error:
                                first_translation_error = r_err

    for idx, seg in enumerate(db_segments):
        prev_text = db_segments[idx - 1].raw_text if idx > 0 else ""
        next_text = db_segments[idx + 1].raw_text if idx + 1 < len(db_segments) else ""
        if seg.id in batch_prefill:
            txt = batch_prefill[seg.id]
            provider = "gemini"
            err = ""
        else:
            seg_switch_log: list[dict] = []
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
                all_keys=effective_all_keys if effective_all_keys else None,
                key_switch_log=seg_switch_log,
                models=models,
            )
            if seg_switch_log:
                key_switch_events.extend(seg_switch_log)
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
        "total_keys_available": len(effective_all_keys),
        "used_runtime_key": bool(primary_api_key),
        "fallback_key_enabled": bool(backup_api_key),
        "provider_counts": translation_stats.copy(),
        "gemini_error_count": gemini_error_count,
        "deep_translator_error_count": deep_translator_error_count,
        "gemini_batch_chunks_ok": gemini_batch_chunks_ok,
        "gemini_batch_chunks_failed": gemini_batch_chunks_failed,
        "gemini_batch_lines_ok": gemini_batch_lines_ok,
        "fallback_samples": fallback_samples,
        "key_switch_log": key_switch_events[-50:] if key_switch_events else [],  # giữ tối đa 50 sự kiện
    }
    return normalized, translation_stats, first_translation_error, translate_detail


def retranslate_project_segments(project_id: str, gemini_api_key: str | None = None, gemini_models: str | None = None) -> dict[str, Any]:
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if not project:
            return {"ok": False, "error": "project_not_found"}
        all_keys = _resolve_gemini_keys_list(gemini_api_key)
        primary_key = all_keys[0] if all_keys else None
        backup_key = all_keys[1] if len(all_keys) >= 2 else None
        models = [m.strip() for m in (gemini_models or "").split(",")] if gemini_models else None
        normalized, translation_stats, first_translation_error, _ = _translate_project_segments(
            db,
            project,
            primary_key,
            backup_key,
            voice_map={},
            all_api_keys=all_keys,
            models=models,
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
    gemini_models: str | None = None,
    voice_map: dict[str, str] | None = None,
    scan_interval_sec: float = 1.5,
) -> dict[str, Any]:
    db = SessionLocal()
    voice_map = voice_map or {}
    try:
        all_keys = _resolve_gemini_keys_list(gemini_api_key)
        primary_key = all_keys[0] if all_keys else None
        backup_key = all_keys[1] if len(all_keys) >= 2 else None
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
                "gemini_total_keys": len(all_keys),
            },
        )
        _update_job(db, job, JobStatus.running, 1, "init", artifacts=artifacts)
        if pipeline_input_mode == "video_ocr":
            push_event(job, artifacts, "ocr", "Đang tách video thành frame và OCR...", 5, logger_name="pipeline")
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
                # Xây dựng thông điệp chẩn đoán cụ thể dựa vào engine meta
                ocr_engine = ocr_meta.get("engine", "unknown")
                diag_hints = {
                    "rapidocr_unavailable": (
                        "Thư viện OCR (rapidocr-onnxruntime / cv2) chưa được cài đặt "
                        "trong container. Kiểm tra Dockerfile hoặc requirements.txt."
                    ),
                    "missing_video": "Dự án chưa có đường dẫn video. Vui lòng tải lên video trước khi chạy pipeline.",
                    "missing_video_file": (
                        f"File video không tồn tại trên đĩa: {ocr_meta.get('video_path', '')}. "
                        "Có thể video chưa tải xong hoặc đã bị xóa."
                    ),
                    "video_open_failed": (
                        "cv2 không mở được file video (codec không được hỗ trợ). "
                        "ffmpeg đã được thử nhưng cũng thất bại. "
                        "Kiểm tra chi tiết bên dưới hoặc thử upload lại video dạng .mp4 H.264."
                    ),
                }
                diag_msg = diag_hints.get(ocr_engine, f"OCR trả về 0 đoạn (engine={ocr_engine}).")
                # Bổ sung chi tiết ffmpeg/transcode nếu có
                video_open_detail = ocr_meta.get("video_open_detail", "")
                if video_open_detail and ocr_engine == "video_open_failed":
                    diag_msg = f"{diag_msg} Chi tiết: {video_open_detail[:200]}"
                frames_sampled = int(ocr_meta.get("frames_sampled", 0) or 0)
                frames_total = int(ocr_meta.get("frames_total", 0) or 0)
                producer_error = ocr_meta.get("producer_error", "")
                full_msg = (
                    f"Lỗi OCR: {diag_msg} "
                    f"[frames: {frames_sampled}/{frames_total}"
                    + (f", producer_error={producer_error[:120]}" if producer_error else "")
                    + "]"
                )
                set_stat(
                    artifacts,
                    "ocr",
                    {
                        **ocr_meta,
                        "source": "ocr_empty",
                        "segments_raw": 0,
                        "diag": diag_msg,
                    },
                )
                push_event(
                    job,
                    artifacts,
                    "ocr",
                    full_msg,
                    12,
                    level="error",
                    logger_name="pipeline",
                )
                _update_job(db, job, JobStatus.failed, 12, "ocr_empty", full_msg, artifacts=artifacts)
                return {"ok": False, "job_id": job_id, "error": full_msg}

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
                f"OCR xong: {len(segments)} đoạn text (source={ocr_source}).",
                28,
                logger_name="pipeline",
            )
            segments_before_merge = len(segments)
            segments = _merge_adjacent_similar_segments(
                segments,
                max_gap_sec=max(0.8, effective_scan_interval * 1.5),
                ratio_threshold=0.9,
            )
            # Fill khoảng trống nhỏ giữa các segment OCR
            segments = _fill_subtitle_gaps(
                segments,
                max_gap_to_fill_sec=max(1.0, effective_scan_interval * 1.2),
            )
            set_stat(
                artifacts,
                "dedupe_ocr",
                {
                    "before": segments_before_merge,
                    "after": len(segments),
                },
            )
            push_event(job, artifacts, "ocr", f"Sau merge OCR: {len(segments)} đoạn.", 34, logger_name="pipeline")

        replace_segments(db, project.id, segments)

        push_event(
            job,
            artifacts,
            "translate",
            f"Bat dau dich {len(segments)} doan, so key Gemini={len(all_keys)}, {'co' if primary_key else 'khong co'} key chinh.",
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

        # Hook realtime: push log key dịch ngay khi mỗi API call xảy ra
        _key_event_lock = threading.Lock()

        def _on_key_event(ev: dict) -> None:
            """Gọi từ worker thread — push log key switch lên SSE ngay lập tức."""
            action = ev.get("action", "")
            key_suffix = ev.get("key_suffix", "???")
            model = ev.get("model", "")
            err = (ev.get("error") or "")[:150]
            if action == "trying_key":
                if ev.get("key_index", 0) == 0:
                    return  # key đầu tiên không log — giảm noise
                level = "info"
                msg = f"🔑 Thử fallback key #{ev.get('key_index', 0)+1} (***{key_suffix}) model={model}"
            elif action in ("key_failed_switching", "key_invalid_switching"):
                level = "warning"
                next_s = ev.get("switching_to") or ev.get("switching_to_suffix") or "none"
                msg = f"⚠️ Key ***{key_suffix} lỗi → ***{next_s} | {err}"
            elif action in ("success_on_fallback", "success_on_fallback_key"):
                level = "success"
                msg = f"✅ Key dự phòng ***{key_suffix} thành công (model={model})"
            elif action in ("non_key_error", "chunk_error_trying_next", "model_error_trying_next"):
                level = "warning"
                model_info = f" [{ev.get('model', '?')}]" if ev.get("model") else ""
                msg = f"⚡ key ***{key_suffix}{model_info} lỗi: {err}"
            elif action == "all_keys_failed":
                level = "error"
                msg = f"❌ Tất cả key thất bại: {(ev.get('final_err') or '')[:200]}"
            else:
                return  # skip_invalid và các action ít quan trọng
            with _key_event_lock:
                push_event(job, artifacts, "key_switch", msg, last_translate_progress, level=level, logger_name="pipeline")

        # Hook TẠM DỮNG: hiển thị dialog hỏi user trước khi fallback deep_translator
        def _on_wait_for_key(summary: str, last_err: str) -> list[str]:
            """Set job = waiting_for_key, poll tềi đa 90 giây chờ key mới từ user."""
            nonlocal artifacts
            # Phân tích mã lỗi rõ ràng
            err_code = ""
            err_detail = ""
            if "http_429" in last_err:
                err_code = "429 - Hết quota"
                err_detail = "Key đã vượt giới hạn sử dụng (billing quota). Vui lòng thêm key khác."
            elif "http_403" in last_err:
                err_code = "403 - Key lộ/Không có quyền"
                err_detail = "Key bị báo cáo lộ hoặc không có quyền truy cập model này."
            elif "http_400" in last_err:
                err_code = "400 - Key không hợp lệ"
                err_detail = "API key sai định dạng hoặc không hợp lệ."
            elif "url_error" in last_err:
                err_code = "Lỗi mạng"
                err_detail = "Không thể kết nối tới Gemini API. Kiểm tra mạng của container."
            else:
                err_code = "Lỗi không xác định"
                err_detail = last_err[:200]

            notice = (
                f"⚠️ Tất cả Gemini key đã thất bại [{err_code}]: {err_detail} | {summary} "
                f"| Hệ thống sẽ dùng dịch local (chất lượng thấp) nếu không có key mới trong 90 giây."
            )
            push_event(job, artifacts, "key_switch", notice, last_translate_progress, level="error", logger_name="pipeline")
            _update_job(db, job, JobStatus.waiting_for_key, last_translate_progress, "waiting_for_key",
                        error_message=notice[:300], artifacts=artifacts)

            # Poll tềi đa 90s — kiểm tra file key mới mỗi 3 giây
            wait_deadline = time.monotonic() + 90
            old_key_count = len(all_keys)
            while time.monotonic() < wait_deadline:
                time.sleep(3)
                fresh_keys = _resolve_gemini_keys_list(None)  # reload từ file
                new_found = [k for k in fresh_keys if k not in all_keys]
                if new_found:
                    push_event(job, artifacts, "key_switch",
                               f"🔑 Phát hiện {len(new_found)} key mới — tiếp tục dịch!",
                               last_translate_progress, level="success", logger_name="pipeline")
                    _update_job(db, job, JobStatus.running, last_translate_progress, "translate", artifacts=artifacts)
                    return new_found
            # Hết timeout
            push_event(job, artifacts, "key_switch",
                       "⏱ Đến giời — tiếp tục với bản dịch local (chất lượng có thể thấp hơn).",
                       last_translate_progress, level="warning", logger_name="pipeline")
            _update_job(db, job, JobStatus.running, last_translate_progress, "translate", artifacts=artifacts)
            return []

        models = [m.strip() for m in (gemini_models or "").split(",")] if gemini_models else None
        normalized, translation_stats, first_translation_error, translate_detail = _translate_project_segments(
            db,
            project,
            primary_key,
            backup_key,
            voice_map=voice_map,
            progress_hook=_on_translate_progress,
            all_api_keys=all_keys,
            models=models,
            key_event_hook=_on_key_event,
            wait_for_key_hook=_on_wait_for_key,
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

        push_event(job, artifacts, "dedupe_merge", "Đang merge subtitle trùng lặp lần cuối...", 65, logger_name="pipeline")
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
        # Fill khoảng trống nhỏ lần cuối sau dịch (tránh khoảng trắng thừa trong SRT)
        deduped = _fill_subtitle_gaps(
            deduped,
            max_gap_to_fill_sec=max(1.0, effective_scan_interval * 1.2),
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
        push_event(job, artifacts, "dedupe_merge", f"Merge xong: {len(normalized)} -> {len(deduped)} đoạn.", 78, logger_name="pipeline")
        replace_segments(db, project.id, deduped)

        push_event(job, artifacts, "tts", "Đang tạo tts_lines.txt cho lồng tiếng...", 80, logger_name="pipeline")
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

        push_event(job, artifacts, "export", "Đang xuất SRT + JSON...", 90, logger_name="pipeline")
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
        push_event(job, artifacts, "done", "Pipeline hoàn tất.", 100, logger_name="pipeline")
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

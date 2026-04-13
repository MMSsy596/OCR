import asyncio
import hashlib
import re
import shutil
import subprocess
import time
import urllib.request
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from .db import SessionLocal
from .job_state import persist_snapshot, prepare_job_artifacts, push_event, set_stat
from .models import JobStatus, PipelineJob, Project, ProjectStatus
from .settings import get_settings


TIMESTAMP_RE = re.compile(
    r"(?P<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(?P<end>\d{2}:\d{2}:\d{2}[,.]\d{3})"
)
RATE_RE = re.compile(r"^([+-]?\d{1,3})%$")


@dataclass
class SrtCue:
    start_sec: float
    end_sec: float
    text: str


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


def _parse_timestamp(ts: str) -> float:
    clean = ts.replace(",", ".")
    hh, mm, ss = clean.split(":")
    return int(hh) * 3600 + int(mm) * 60 + float(ss)


def _parse_srt(path: Path) -> list[SrtCue]:
    raw = path.read_text(encoding="utf-8", errors="ignore")
    blocks = re.split(r"\n\s*\n", raw.replace("\r\n", "\n"))
    cues: list[SrtCue] = []
    for block in blocks:
        rows = [row.strip() for row in block.splitlines() if row.strip()]
        if not rows:
            continue
        ts_index = -1
        match = None
        for idx, row in enumerate(rows):
            maybe = TIMESTAMP_RE.search(row)
            if maybe:
                ts_index = idx
                match = maybe
                break
        if not match or ts_index < 0:
            continue
        start = _parse_timestamp(match.group("start"))
        end = _parse_timestamp(match.group("end"))
        text_rows = rows[ts_index + 1 :]
        text = " ".join(row for row in text_rows if row).strip()
        if text and end > start:
            cues.append(SrtCue(start_sec=start, end_sec=end, text=text))
    return sorted(cues, key=lambda x: x.start_sec)


def _probe_media_duration(path: Path) -> float | None:
    if not path.exists():
        return None
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        out = subprocess.run(cmd, check=True, capture_output=True, text=True)
        val = float((out.stdout or "").strip())
        return val if val > 0 else None
    except Exception:
        return None


def _run_cmd(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True)


def _clamp(num: int, min_v: int, max_v: int) -> int:
    return max(min_v, min(num, max_v))


def _parse_rate_percent(rate: str) -> int:
    match = RATE_RE.match((rate or "").strip())
    if not match:
        return 0
    return int(match.group(1))


def _adaptive_rate(text: str, slot_sec: float, base_rate: str) -> str:
    base = _parse_rate_percent(base_rate)
    if slot_sec <= 0:
        return f"{_clamp(base, -50, 100):+d}%"
    char_count = len(re.sub(r"\s+", "", text))
    cps = char_count / max(slot_sec, 0.2)
    boost = 0
    if cps > 14:
        boost = int((cps - 14) * 5)
    final = _clamp(base + boost, -50, 100)
    return f"{final:+d}%"


def _build_atempo_chain(speed_ratio: float) -> str:
    # ffmpeg atempo supports [0.5, 2.0] per filter; chain for >2.0.
    ratio = max(1.0, float(speed_ratio))
    parts: list[str] = []
    while ratio > 2.0:
        parts.append("atempo=2.0")
        ratio /= 2.0
    parts.append(f"atempo={ratio:.6f}")
    return ",".join(parts)


def _fit_wav_to_slot(input_wav: Path, output_wav: Path, slot_sec: float) -> tuple[bool, float, float]:
    """Speed up wav with atempo to fit slot_sec. Returns (applied, before_sec, after_sec)."""
    with wave.open(str(input_wav), "rb") as wav_in:
        frame_rate = wav_in.getframerate() or 24000
        before_sec = wav_in.getnframes() / max(1, frame_rate)
    if slot_sec <= 0:
        return False, before_sec, before_sec
    if before_sec <= slot_sec:
        shutil.copy2(input_wav, output_wav)
        return False, before_sec, before_sec

    speed_ratio = before_sec / slot_sec
    atempo_chain = _build_atempo_chain(speed_ratio)
    _run_cmd(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_wav),
            "-filter:a",
            atempo_chain,
            "-ac",
            "1",
            "-ar",
            "24000",
            "-sample_fmt",
            "s16",
            str(output_wav),
        ]
    )
    with wave.open(str(output_wav), "rb") as wav_out:
        after_sec = wav_out.getnframes() / max(1, wav_out.getframerate() or 24000)
    # Fine tune once if still slightly above slot due rounding/resample.
    if after_sec > (slot_sec * 1.001):
        adjust_ratio = max(1.0, after_sec / slot_sec * 1.02)
        adjust_chain = _build_atempo_chain(adjust_ratio)
        tmp_adjust = output_wav.with_suffix(".fit2.wav")
        _run_cmd(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(output_wav),
                "-filter:a",
                adjust_chain,
                "-ac",
                "1",
                "-ar",
                "24000",
                "-sample_fmt",
                "s16",
                str(tmp_adjust),
            ]
        )
        tmp_adjust.replace(output_wav)
        with wave.open(str(output_wav), "rb") as wav_out:
            after_sec = wav_out.getnframes() / max(1, wav_out.getframerate() or 24000)
    return True, before_sec, after_sec


async def _save_edge_tts(
    text: str,
    output_path: Path,
    voice: str,
    rate: str,
    volume: str,
    pitch: str,
) -> None:
    import edge_tts  # type: ignore

    communicate = edge_tts.Communicate(
        text=text,
        voice=voice,
        rate=rate,
        volume=volume,
        pitch=pitch,
    )
    await communicate.save(str(output_path))


def _save_pyttsx3_wav(text: str, output_path: Path, rate: str = "+0%") -> None:
    import pyttsx3  # type: ignore

    engine = pyttsx3.init()
    voices = engine.getProperty("voices") or []
    voice_id = None
    for voice in voices:
        meta = " ".join(
            str(part)
            for part in [getattr(voice, "id", ""), getattr(voice, "name", ""), getattr(voice, "languages", "")]
            if part
        ).lower()
        if "vi-vn" in meta or "vietnam" in meta:
            voice_id = getattr(voice, "id", None)
            break
    if voice_id:
        engine.setProperty("voice", voice_id)
    base_rate = 180
    percent = _parse_rate_percent(rate)
    target_rate = int(base_rate * (1 + (percent / 100.0)))
    target_rate = max(110, min(target_rate, 280))
    engine.setProperty("rate", target_rate)
    engine.save_to_file(text, str(output_path))
    engine.runAndWait()
    engine.stop()


def _map_gtts_lang(project_lang: str | None, voice: str) -> str:
    voice_l = (voice or "").lower()
    if voice_l.startswith("vi-"):
        return "vi"
    if voice_l.startswith("zh-"):
        return "zh-CN"
    raw = (project_lang or "").strip().lower().replace("_", "-")
    if not raw:
        return "vi"
    base = raw.split("-")[0]
    if base == "vi":
        return "vi"
    if base == "zh":
        return "zh-CN"
    if base == "en":
        return "en"
    if base == "ja":
        return "ja"
    if base == "ko":
        return "ko"
    return "vi"


def _save_gtts_mp3(text: str, output_path: Path, lang: str) -> None:
    from gtts import gTTS  # type: ignore

    tts = gTTS(text=text, lang=lang, slow=False)
    tts.save(str(output_path))


def _resolve_srt_path(project_dir: Path, preferred_key: str) -> Path | None:
    candidates = [
        preferred_key,
        "manual.translated.srt",
        "output.vi.srt",
        "manual.bilingual.srt",
        "manual.raw.srt",
    ]
    for key in candidates:
        p = project_dir / key
        if p.exists():
            return p
    return None


def _make_tts_cache_id(text: str, voice: str, rate: str, volume: str, pitch: str, extra: str = "") -> str:
    raw = "\n".join([text, voice, rate, volume, pitch, extra]).encode("utf-8", errors="ignore")
    return hashlib.sha1(raw).hexdigest()[:20]


def _shared_tts_cache_dir(project_dir: Path) -> Path:
    path = project_dir / "_dub_tmp" / "_shared_cache"
    path.mkdir(parents=True, exist_ok=True)
    return path


FPT_DEFAULT_API_KEY = "gSZ0IfH1XDMKp2I2X5bzAet2EgxhKzDn"


def _save_fpt_tts_wav(text: str, output_path: Path, api_key: str, voice: str, speed: int) -> None:
    """Gọi FPT.AI TTS v5, lưu kết quả (mp3) rồi convert sang WAV 24kHz mono s16."""
    url = "https://api.fpt.ai/hmi/tts/v5"
    speed_str = str(int(speed)) if speed != 0 else ""
    data = text.encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("api-key", api_key or FPT_DEFAULT_API_KEY)
    req.add_header("voice", voice)
    req.add_header("speed", speed_str)
    req.add_header("Content-Type", "application/octet-stream")
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read()

    # FPT trả về JSON có field "async" là URL mp3 hoặc trực tiếp mp3 bytes
    import json as _json
    try:
        result = _json.loads(body)
        mp3_url = result.get("async") or result.get("url") or ""
    except Exception:
        mp3_url = ""

    raw_mp3 = output_path.with_suffix(".fpt.mp3")
    if mp3_url:
        # Tải file mp3 từ URL async
        with urllib.request.urlopen(mp3_url, timeout=30) as r:
            raw_mp3.write_bytes(r.read())
    else:
        # Body chính là raw mp3
        raw_mp3.write_bytes(body)

    _run_cmd([
        "ffmpeg", "-y", "-i", str(raw_mp3),
        "-ac", "1", "-ar", "24000", "-sample_fmt", "s16",
        str(output_path),
    ])
    raw_mp3.unlink(missing_ok=True)

def _render_tts_variant(
    *,
    text: str,
    voice: str,
    rate: str,
    volume: str,
    pitch: str,
    cache_dir: Path,
    gtts_lang: str,
    tts_engine: str = "edge",
    fpt_api_key: str = "",
    fpt_voice: str = "banmai",
    fpt_speed: int = 0,
) -> tuple[Path, str]:
    extra = f"fpt:{fpt_voice}:{fpt_speed}" if tts_engine == "fpt" else ""
    cache_id = _make_tts_cache_id(text, voice, rate, volume, pitch, extra)
    seg_wav = cache_dir / f"{cache_id}.wav"
    if seg_wav.exists():
        return seg_wav, "cache_existing"

    # ── FPT engine ──
    if tts_engine == "fpt":
        try:
            _save_fpt_tts_wav(
                text=text,
                output_path=seg_wav,
                api_key=fpt_api_key or FPT_DEFAULT_API_KEY,
                voice=fpt_voice,
                speed=fpt_speed,
            )
            return seg_wav, "fpt"
        except Exception as fpt_ex:
            # fallback sang edge nếu FPT lỗi
            pass

    # ── Edge / fallback chain ──
    raw_mp3 = cache_dir / f"{cache_id}.edge.mp3"
    gtts_mp3 = cache_dir / f"{cache_id}.gtts.mp3"
    try:
        asyncio.run(
            _save_edge_tts(
                text=text,
                output_path=raw_mp3,
                voice=voice,
                rate=rate,
                volume=volume,
                pitch=pitch,
            )
        )
        _run_cmd([
            "ffmpeg", "-y", "-i", str(raw_mp3),
            "-ac", "1", "-ar", "24000", "-sample_fmt", "s16",
            str(seg_wav),
        ])
        return seg_wav, "fpt_fallback_edge" if tts_engine == "fpt" else "edge"
    except Exception as edge_ex:
        try:
            _save_gtts_mp3(text, gtts_mp3, gtts_lang)
            _run_cmd([
                "ffmpeg", "-y", "-i", str(gtts_mp3),
                "-ac", "1", "-ar", "24000", "-sample_fmt", "s16",
                str(seg_wav),
            ])
            return seg_wav, "gtts"
        except Exception as gtts_ex:
            try:
                _save_pyttsx3_wav(text, seg_wav, rate)
                return seg_wav, "pyttsx3"
            except Exception as py_ex:
                raise RuntimeError(
                    "tts_failed_all_engines: "
                    f"edge={str(edge_ex)[:120]} | gtts={str(gtts_ex)[:120]} | pyttsx3={str(py_ex)[:120]}"
                ) from py_ex



def run_dub_job(
    job_id: str,
    srt_key: str = "manual.translated.srt",
    output_format: str = "wav",
    voice: str = "vi-VN-HoaiMyNeural",
    rate: str = "+0%",
    volume: str = "+0%",
    pitch: str = "+0Hz",
    match_video_duration: bool = True,
    tts_engine: str = "edge",
    fpt_api_key: str = "",
    fpt_voice: str = "banmai",
    fpt_speed: int = 0,
) -> dict:
    db = SessionLocal()
    tmp_dir: Path | None = None
    try:
        job = db.get(PipelineJob, job_id)
        if not job:
            return {"ok": False, "error": "job_not_found"}
        project = db.get(Project, job.project_id)
        if not project:
            _update_job(db, job, JobStatus.failed, 0, "error", "project_not_found")
            return {"ok": False, "error": "project_not_found"}
        if not project.video_path:
            _update_job(db, job, JobStatus.failed, 0, "error", "video_required")
            return {"ok": False, "error": "video_required"}

        project.status = ProjectStatus.processing
        db.add(project)
        db.commit()

        artifacts = prepare_job_artifacts(job)
        set_stat(
            artifacts,
            "dub",
            {
                "voice": voice,
                "rate": rate,
                "volume": volume,
                "pitch": pitch,
                "output_format": output_format,
                "match_video_duration": bool(match_video_duration),
                "tts_engine": tts_engine,
                "fpt_voice": fpt_voice if tts_engine == "fpt" else "",
                "fpt_speed": fpt_speed if tts_engine == "fpt" else 0,
            },
        )
        push_event(job, artifacts, "dub", "Bắt đầu job lồng tiếng từ SRT.", 1, logger_name="tts")
        _update_job(db, job, JobStatus.running, 1, "init", artifacts=artifacts)

        project_dir = Path(project.video_path).parent
        srt_path = _resolve_srt_path(project_dir, srt_key)
        if not srt_path:
            push_event(job, artifacts, "dub", f"Không tìm thấy SRT: {srt_key}", 1, level="error", logger_name="tts")
            _update_job(db, job, JobStatus.failed, 0, "error", "srt_not_found", artifacts=artifacts)
            return {"ok": False, "error": "srt_not_found"}

        push_event(job, artifacts, "parse_srt", f"Đang parse SRT: {srt_path.name}", 5, logger_name="tts")
        _update_job(db, job, JobStatus.running, 5, "parse_srt", artifacts=artifacts)
        cues = _parse_srt(srt_path)
        if not cues:
            push_event(job, artifacts, "parse_srt", "SRT rỗng hoặc không parse được cue.", 5, level="error", logger_name="tts")
            _update_job(db, job, JobStatus.failed, 5, "error", "srt_empty", artifacts=artifacts)
            return {"ok": False, "error": "srt_empty"}

        set_stat(
            artifacts,
            "parse_srt",
            {
                "srt_path": str(srt_path),
                "cue_count": len(cues),
                "first_start_sec": cues[0].start_sec,
                "last_end_sec": cues[-1].end_sec,
            },
        )
        push_event(job, artifacts, "parse_srt", f"Parse xong {len(cues)} cue.", 8, logger_name="tts")

        fmt = (output_format or "wav").lower().strip()
        if fmt not in {"wav", "mp3"}:
            push_event(job, artifacts, "dub", f"Output format không hợp lệ: {output_format}", 8, level="error", logger_name="tts")
            _update_job(db, job, JobStatus.failed, 5, "error", "invalid_output_format", artifacts=artifacts)
            return {"ok": False, "error": "invalid_output_format"}

        tmp_dir = project_dir / "_dub_tmp" / job_id
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)
        tmp_dir.mkdir(parents=True, exist_ok=True)
        cache_dir = _shared_tts_cache_dir(project_dir)

        total = len(cues)
        gtts_lang = _map_gtts_lang(project.target_lang, voice)
        workers = max(1, min(int(get_settings().tts_max_parallel_workers or 3), 6))
        total_chars = sum(len(re.sub(r"\s+", "", cue.text or "")) for cue in cues)
        total_slot_sec = round(sum(max(0.0, cue.end_sec - cue.start_sec) for cue in cues), 3)

        cue_plans: list[tuple] = []
        unique_keys: dict[tuple, None] = {}

        for cue in cues:
            slot_sec = max(0.05, cue.end_sec - cue.start_sec)
            dynamic_rate = _adaptive_rate(cue.text, slot_sec, rate)
            cache_key = (cue.text, voice, dynamic_rate, volume, pitch, tts_engine, fpt_voice, str(fpt_speed))
            cue_plans.append((cue, slot_sec, cache_key))
            unique_keys.setdefault(cache_key, None)

        set_stat(
            artifacts,
            "synthesize_tts",
            {
                "total_cues": total,
                "unique_tts_variants": len(unique_keys),
                "parallel_workers": workers,
                "gtts_lang": gtts_lang,
                "total_chars": total_chars,
                "total_slot_sec": total_slot_sec,
                "shared_cache_dir": str(cache_dir),
            },
        )
        push_event(
            job,
            artifacts,
            "synthesize_tts",
            f"Đang synth {len(unique_keys)} biến thể TTS cho {total} cue bằng {workers} worker.",
            10,
            logger_name="tts",
        )
        _update_job(db, job, JobStatus.running, 10, "synthesize_tts", artifacts=artifacts)

        render_results: dict[tuple, tuple[Path, str]] = {}

        edge_ok = 0
        gtts_ok = 0
        pyttsx3_ok = 0
        render_done = 0
        unique_total = max(1, len(unique_keys))

        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="solar-tts") as executor:
            future_map = {
                executor.submit(
                    _render_tts_variant,
                    text=cache_key[0],
                    voice=cache_key[1],
                    rate=cache_key[2],
                    volume=cache_key[3],
                    pitch=cache_key[4],
                    cache_dir=cache_dir,
                    gtts_lang=gtts_lang,
                    tts_engine=tts_engine,
                    fpt_api_key=fpt_api_key,
                    fpt_voice=fpt_voice,
                    fpt_speed=fpt_speed,
                ): cache_key
                for cache_key in unique_keys.keys()
            }
            for future in as_completed(future_map):
                cache_key = future_map[future]
                wav_path, engine_name = future.result()
                render_results[cache_key] = (wav_path, engine_name)
                render_done += 1
                if engine_name in ("fpt", "fpt_fallback_edge"):
                    edge_ok += 1  # đếm FPT/fallback chung vào edge_ok
                elif engine_name == "edge":
                    edge_ok += 1
                elif engine_name == "gtts":
                    gtts_ok += 1
                elif engine_name == "pyttsx3":
                    pyttsx3_ok += 1

                if render_done == unique_total or render_done % max(1, unique_total // 6) == 0:
                    progress = 10 + int((render_done / unique_total) * 25)
                    set_stat(
                        artifacts,
                        "synthesize_tts",
                        {
                            "total_cues": total,
                            "unique_tts_variants": unique_total,
                            "rendered_variants": render_done,
                            "parallel_workers": workers,
                            "edge_ok": edge_ok,
                            "gtts_ok": gtts_ok,
                            "pyttsx3_ok": pyttsx3_ok,
                            "gtts_lang": gtts_lang,
                            "percent_in_phase": round((render_done / unique_total) * 100, 1),
                        },
                    )
                    push_event(
                        job,
                        artifacts,
                        "synthesize_tts",
                        f"Đã render {render_done}/{unique_total} biến thể TTS.",
                        progress,
                        logger_name="tts",
                    )
                    _update_job(db, job, JobStatus.running, progress, "synthesize_tts", artifacts=artifacts)

        rendered_wavs: list[tuple[SrtCue, Path]] = []
        cache_hit = max(0, total - len(unique_keys))
        cache_miss = len(unique_keys)
        fit_applied = 0
        fit_total_ms_saved = 0.0
        fit_max_speed = 1.0

        for idx, (cue, slot_sec, cache_key) in enumerate(cue_plans, start=1):
            seg_wav, _engine_name = render_results[cache_key]
            fitted_wav = tmp_dir / f"seg_{idx:06d}.fit.wav"
            fit_used, before_sec, after_sec = _fit_wav_to_slot(seg_wav, fitted_wav, slot_sec)
            if fit_used:
                fit_applied += 1
                fit_total_ms_saved += max(0.0, (before_sec - after_sec) * 1000.0)
                if slot_sec > 0:
                    fit_max_speed = max(fit_max_speed, before_sec / slot_sec)
                push_event(
                    job,
                    artifacts,
                    "auto_fit",
                    f"Cue {idx}: auto-fit {before_sec:.2f}s -> {after_sec:.2f}s (slot {slot_sec:.2f}s).",
                    min(80, 35 + int((idx / total) * 45)),
                    logger_name="tts",
                )
                rendered_wavs.append((cue, fitted_wav))
            else:
                rendered_wavs.append((cue, fitted_wav if fitted_wav.exists() else seg_wav))

            if idx == total or idx % max(1, total // 10) == 0:
                progress = 35 + int((idx / total) * 45)
                set_stat(
                    artifacts,
                    "synthesize_tts",
                    {
                        "total_cues": total,
                        "processed_cues": idx,
                        "unique_tts_variants": len(unique_keys),
                        "cache_hit": cache_hit,
                        "cache_miss": cache_miss,
                        "edge_ok": edge_ok,
                        "gtts_ok": gtts_ok,
                        "pyttsx3_ok": pyttsx3_ok,
                        "parallel_workers": workers,
                        "gtts_lang": gtts_lang,
                        "auto_fit_applied": fit_applied,
                        "auto_fit_ratio_percent": round((fit_applied / max(1, idx)) * 100, 1),
                        "auto_fit_saved_ms": round(fit_total_ms_saved, 1),
                        "auto_fit_max_speed_ratio": round(fit_max_speed, 3),
                        "percent_in_phase": round((idx / total) * 100, 1),
                    },
                )
                push_event(
                    job,
                    artifacts,
                    "synthesize_tts",
                    f"Đã chuẩn bị {idx}/{total} cue ({round((idx / total) * 100, 1)}%).",
                    min(progress, 80),
                    logger_name="tts",
                )
                _update_job(db, job, JobStatus.running, min(progress, 80), "synthesize_tts", artifacts=artifacts)

        push_event(job, artifacts, "stitch_timeline", "Đang ghép audio vào timeline...", 85, logger_name="tts")
        _update_job(db, job, JobStatus.running, 85, "stitch_timeline", artifacts=artifacts)
        output_basename = f"dub.{srt_path.stem}.{fmt}"
        output_path = project_dir / output_basename
        wav_output = output_path if fmt == "wav" else (tmp_dir / "dub.final.wav")

        sample_rate = 24000
        frame_bytes = 2
        total_duration = cues[-1].end_sec
        if match_video_duration:
            video_duration = _probe_media_duration(Path(project.video_path))
            if video_duration:
                total_duration = max(total_duration, video_duration)
        target_total_frames = max(1, int(round(total_duration * sample_rate)))

        written_frames = 0
        with wave.open(str(wav_output), "wb") as out_wav:
            out_wav.setnchannels(1)
            out_wav.setsampwidth(frame_bytes)
            out_wav.setframerate(sample_rate)

            for cue, seg_path in rendered_wavs:
                start_frame = max(0, int(round(cue.start_sec * sample_rate)))
                end_frame = max(start_frame + 1, int(round(cue.end_sec * sample_rate)))
                slot_frames = end_frame - start_frame

                if start_frame > written_frames:
                    gap_frames = start_frame - written_frames
                    out_wav.writeframesraw(b"\x00" * (gap_frames * frame_bytes))
                    written_frames += gap_frames

                with wave.open(str(seg_path), "rb") as seg_wav:
                    raw = seg_wav.readframes(seg_wav.getnframes())
                seg_frames = len(raw) // frame_bytes

                if seg_frames >= slot_frames:
                    out_wav.writeframesraw(raw[: slot_frames * frame_bytes])
                else:
                    out_wav.writeframesraw(raw)
                    out_wav.writeframesraw(b"\x00" * ((slot_frames - seg_frames) * frame_bytes))
                written_frames += slot_frames

            if written_frames < target_total_frames:
                tail = target_total_frames - written_frames
                out_wav.writeframesraw(b"\x00" * (tail * frame_bytes))

        set_stat(
            artifacts,
            "stitch_timeline",
            {
                "sample_rate": sample_rate,
                "target_total_frames": target_total_frames,
                "written_frames": written_frames,
                "target_duration_sec": round(total_duration, 3),
                "tail_padding_frames": max(0, target_total_frames - written_frames),
            },
        )

        if fmt == "mp3":
            push_event(job, artifacts, "encode_output", "Đang encode WAV sang MP3...", 95, logger_name="tts")
            _update_job(db, job, JobStatus.running, 95, "encode_output", artifacts=artifacts)
            _run_cmd(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(wav_output),
                    "-codec:a",
                    "libmp3lame",
                    "-b:a",
                    "192k",
                    str(output_path),
                ]
            )

        artifacts = {
            **artifacts,
            "dubbed_audio": str(output_path),
            "dub_srt": str(srt_path),
            "dub_voice": voice,
            "dub_rate": rate,
            "dub_volume": volume,
            "dub_pitch": pitch,
            "dub_output_key": output_basename,
        }
        push_event(job, artifacts, "done", f"Lồng tiếng xong: {output_basename}", 100, logger_name="tts")
        _update_job(db, job, JobStatus.done, 100, "done", artifacts=artifacts)

        project.status = ProjectStatus.ready
        db.add(project)
        db.commit()
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        return {"ok": True, "job_id": job_id, "artifacts": artifacts}
    except Exception as ex:
        job = db.get(PipelineJob, job_id)
        if job:
            artifacts = prepare_job_artifacts(job)
            push_event(
                job,
                artifacts,
                "error",
                f"Dub lỗi: {str(ex)[:320]}",
                int(job.progress if job.progress else 0),
                level="error",
                logger_name="tts",
            )
            _update_job(db, job, JobStatus.failed, job.progress if job.progress else 0, "error", str(ex), artifacts=artifacts)
        if job:
            project = db.get(Project, job.project_id)
            if project:
                project.status = ProjectStatus.failed
                db.add(project)
                db.commit()
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        return {"ok": False, "job_id": job_id, "error": str(ex)}
    finally:
        db.close()

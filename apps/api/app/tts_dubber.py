import asyncio
import re
import shutil
import subprocess
import time
import wave
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import JobStatus, PipelineJob, Project, ProjectStatus


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
    last_flush = float(getattr(job, "_nanbao_last_flush_at", 0.0))
    last_progress = int(getattr(job, "_nanbao_last_flush_progress", prev_progress))
    if not force_flush and (now - last_flush) < 1.5 and abs(int(progress) - last_progress) < 3:
        return
    db.add(job)
    db.commit()
    db.refresh(job)
    job._nanbao_last_flush_at = now
    job._nanbao_last_flush_progress = int(progress)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_artifacts(job: PipelineJob) -> dict:
    base = job.artifacts if isinstance(job.artifacts, dict) else {}
    base.setdefault("events", [])
    base.setdefault("stats", {})
    return base


def _push_event(artifacts: dict, phase: str, message: str, progress: int, level: str = "info") -> None:
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


def _set_stat(artifacts: dict, phase: str, payload: dict) -> None:
    stats = artifacts.setdefault("stats", {})
    stats[phase] = payload


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


def run_dub_job(
    job_id: str,
    srt_key: str = "manual.translated.srt",
    output_format: str = "wav",
    voice: str = "vi-VN-HoaiMyNeural",
    rate: str = "+0%",
    volume: str = "+0%",
    pitch: str = "+0Hz",
    match_video_duration: bool = True,
) -> dict:
    db = SessionLocal()
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
        artifacts = _job_artifacts(job)
        _set_stat(
            artifacts,
            "dub",
            {
                "voice": voice,
                "rate": rate,
                "volume": volume,
                "pitch": pitch,
                "output_format": output_format,
                "match_video_duration": bool(match_video_duration),
            },
        )
        _push_event(artifacts, "dub", "Bắt đầu job lồng tiếng từ SRT.", 1)
        _update_job(db, job, JobStatus.running, 1, "init", artifacts=artifacts)

        project_dir = Path(project.video_path).parent
        srt_path = _resolve_srt_path(project_dir, srt_key)
        if not srt_path:
            _push_event(artifacts, "dub", f"Không tìm thấy SRT: {srt_key}", 1, level="error")
            _update_job(db, job, JobStatus.failed, 0, "error", "srt_not_found", artifacts=artifacts)
            return {"ok": False, "error": "srt_not_found"}

        _push_event(artifacts, "parse_srt", f"Đang parse SRT: {srt_path.name}", 5)
        _update_job(db, job, JobStatus.running, 5, "parse_srt", artifacts=artifacts)
        cues = _parse_srt(srt_path)
        if not cues:
            _push_event(artifacts, "parse_srt", "SRT rỗng hoặc không parse được cue.", 5, level="error")
            _update_job(db, job, JobStatus.failed, 5, "error", "srt_empty", artifacts=artifacts)
            return {"ok": False, "error": "srt_empty"}
        _set_stat(
            artifacts,
            "parse_srt",
            {
                "srt_path": str(srt_path),
                "cue_count": len(cues),
                "first_start_sec": cues[0].start_sec,
                "last_end_sec": cues[-1].end_sec,
            },
        )
        _push_event(artifacts, "parse_srt", f"Parse xong {len(cues)} cue.", 8)

        fmt = (output_format or "wav").lower().strip()
        if fmt not in {"wav", "mp3"}:
            _push_event(artifacts, "dub", f"Output format không hợp lệ: {output_format}", 8, level="error")
            _update_job(db, job, JobStatus.failed, 5, "error", "invalid_output_format", artifacts=artifacts)
            return {"ok": False, "error": "invalid_output_format"}

        tmp_dir = project_dir / "_dub_tmp" / job_id
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)
        tmp_dir.mkdir(parents=True, exist_ok=True)

        _push_event(artifacts, "synthesize_tts", "Đang synth TTS từng cue...", 10)
        _update_job(db, job, JobStatus.running, 10, "synthesize_tts", artifacts=artifacts)
        cache: dict[tuple[str, str, str, str, str], Path] = {}
        rendered_wavs: list[tuple[SrtCue, Path]] = []
        total = len(cues)
        cache_hit = 0
        cache_miss = 0
        edge_ok = 0
        edge_failed = 0
        pyttsx3_ok = 0
        pyttsx3_failed = 0
        gtts_ok = 0
        gtts_failed = 0
        gtts_lang = _map_gtts_lang(project.target_lang, voice)
        fit_applied = 0
        fit_total_ms_saved = 0.0
        fit_max_speed = 1.0
        for idx, cue in enumerate(cues, start=1):
            slot_sec = max(0.05, cue.end_sec - cue.start_sec)
            dynamic_rate = _adaptive_rate(cue.text, slot_sec, rate)
            cache_key = (cue.text, voice, dynamic_rate, volume, pitch)

            if cache_key in cache:
                seg_wav = cache[cache_key]
                cache_hit += 1
            else:
                cache_miss += 1
                raw_mp3 = tmp_dir / f"seg_{idx:06d}.mp3"
                gtts_mp3 = tmp_dir / f"seg_{idx:06d}.gtts.mp3"
                seg_wav = tmp_dir / f"seg_{idx:06d}.wav"
                try:
                    asyncio.run(
                        _save_edge_tts(
                            text=cue.text,
                            output_path=raw_mp3,
                            voice=voice,
                            rate=dynamic_rate,
                            volume=volume,
                            pitch=pitch,
                        )
                    )
                    _run_cmd(
                        [
                            "ffmpeg",
                            "-y",
                            "-i",
                            str(raw_mp3),
                            "-ac",
                            "1",
                            "-ar",
                            "24000",
                            "-sample_fmt",
                            "s16",
                            str(seg_wav),
                        ]
                    )
                    edge_ok += 1
                except Exception as edge_ex:
                    edge_failed += 1
                    _push_event(
                        artifacts,
                        "synthesize_tts",
                        f"Edge-TTS loi cue {idx}, fallback gTTS({gtts_lang})/pyttsx3: {str(edge_ex)[:120]}",
                        min(80, 10 + int((idx / total) * 70)),
                        level="warning",
                    )
                    try:
                        _save_gtts_mp3(cue.text, gtts_mp3, gtts_lang)
                        _run_cmd(
                            [
                                "ffmpeg",
                                "-y",
                                "-i",
                                str(gtts_mp3),
                                "-ac",
                                "1",
                                "-ar",
                                "24000",
                                "-sample_fmt",
                                "s16",
                                str(seg_wav),
                            ]
                        )
                        gtts_ok += 1
                    except Exception as gtts_ex:
                        gtts_failed += 1
                        try:
                            _save_pyttsx3_wav(cue.text, seg_wav, dynamic_rate)
                            pyttsx3_ok += 1
                        except Exception as py_ex:
                            pyttsx3_failed += 1
                            raise RuntimeError(
                                "tts_failed_all_engines: "
                                f"edge={str(edge_ex)[:120]} | gtts={str(gtts_ex)[:120]} | pyttsx3={str(py_ex)[:120]}"
                            ) from py_ex
                cache[cache_key] = seg_wav

            # Auto-fit by duration: if segment exceeds slot, speed up with atempo chain.
            fitted_wav = tmp_dir / f"seg_{idx:06d}.fit.wav"
            fit_used, before_sec, after_sec = _fit_wav_to_slot(seg_wav, fitted_wav, slot_sec)
            if fit_used:
                fit_applied += 1
                fit_total_ms_saved += max(0.0, (before_sec - after_sec) * 1000.0)
                if slot_sec > 0:
                    fit_max_speed = max(fit_max_speed, before_sec / slot_sec)
                _push_event(
                    artifacts,
                    "auto_fit",
                    f"Cue {idx}: auto-fit {before_sec:.2f}s -> {after_sec:.2f}s (slot {slot_sec:.2f}s).",
                    min(80, 10 + int((idx / total) * 70)),
                )
                rendered_wavs.append((cue, fitted_wav))
            else:
                rendered_wavs.append((cue, fitted_wav if fitted_wav.exists() else seg_wav))

            if idx == total or idx % max(1, total // 10) == 0:
                progress = 10 + int((idx / total) * 70)
                _set_stat(
                    artifacts,
                    "synthesize_tts",
                    {
                        "total_cues": total,
                        "processed_cues": idx,
                        "cache_hit": cache_hit,
                        "cache_miss": cache_miss,
                        "edge_ok": edge_ok,
                        "edge_failed": edge_failed,
                        "gtts_ok": gtts_ok,
                        "gtts_failed": gtts_failed,
                        "gtts_lang": gtts_lang,
                        "pyttsx3_ok": pyttsx3_ok,
                        "pyttsx3_failed": pyttsx3_failed,
                        "auto_fit_applied": fit_applied,
                        "auto_fit_ratio_percent": round((fit_applied / max(1, idx)) * 100, 1),
                        "auto_fit_saved_ms": round(fit_total_ms_saved, 1),
                        "auto_fit_max_speed_ratio": round(fit_max_speed, 3),
                        "percent_in_phase": round((idx / total) * 100, 1),
                    },
                )
                _push_event(
                    artifacts,
                    "synthesize_tts",
                    f"Synth {idx}/{total} cue ({round((idx / total) * 100, 1)}%).",
                    min(progress, 80),
                )
                _update_job(db, job, JobStatus.running, min(progress, 80), "synthesize_tts", artifacts=artifacts)

        _push_event(artifacts, "stitch_timeline", "Đang ghép audio vào timeline...", 85)
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
        _set_stat(
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
            _push_event(artifacts, "encode_output", "Đang encode WAV -> MP3...", 95)
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
        _push_event(artifacts, "done", f"Long tieng xong: {output_basename}", 100)
        _update_job(db, job, JobStatus.done, 100, "done", artifacts=artifacts)
        project.status = ProjectStatus.ready
        db.add(project)
        db.commit()
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return {"ok": True, "job_id": job_id, "artifacts": artifacts}
    except Exception as ex:
        job = db.get(PipelineJob, job_id)
        if job:
            artifacts = _job_artifacts(job)
            _push_event(
                artifacts,
                "error",
                f"Dub loi: {str(ex)[:320]}",
                int(job.progress if job.progress else 0),
                level="error",
            )
            _update_job(db, job, JobStatus.failed, job.progress if job.progress else 0, "error", str(ex), artifacts=artifacts)
        if job:
            project = db.get(Project, job.project_id)
            if project:
                project.status = ProjectStatus.failed
                db.add(project)
                db.commit()
        return {"ok": False, "job_id": job_id, "error": str(ex)}
    finally:
        db.close()

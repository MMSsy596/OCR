import asyncio
import re
import shutil
import subprocess
import wave
from dataclasses import dataclass
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
    job.status = status
    job.progress = progress
    job.step = step
    job.error_message = error_message
    if artifacts is not None:
        job.artifacts = artifacts
    db.add(job)
    db.commit()
    db.refresh(job)


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

        project_dir = Path(project.video_path).parent
        srt_path = _resolve_srt_path(project_dir, srt_key)
        if not srt_path:
            _update_job(db, job, JobStatus.failed, 0, "error", "srt_not_found")
            return {"ok": False, "error": "srt_not_found"}

        _update_job(db, job, JobStatus.running, 5, "parse_srt")
        cues = _parse_srt(srt_path)
        if not cues:
            _update_job(db, job, JobStatus.failed, 5, "error", "srt_empty")
            return {"ok": False, "error": "srt_empty"}

        fmt = (output_format or "wav").lower().strip()
        if fmt not in {"wav", "mp3"}:
            _update_job(db, job, JobStatus.failed, 5, "error", "invalid_output_format")
            return {"ok": False, "error": "invalid_output_format"}

        tmp_dir = project_dir / "_dub_tmp" / job_id
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)
        tmp_dir.mkdir(parents=True, exist_ok=True)

        _update_job(db, job, JobStatus.running, 10, "synthesize_tts")
        cache: dict[tuple[str, str, str, str, str], Path] = {}
        rendered_wavs: list[tuple[SrtCue, Path]] = []
        total = len(cues)
        for idx, cue in enumerate(cues, start=1):
            slot_sec = max(0.05, cue.end_sec - cue.start_sec)
            dynamic_rate = _adaptive_rate(cue.text, slot_sec, rate)
            cache_key = (cue.text, voice, dynamic_rate, volume, pitch)

            if cache_key in cache:
                seg_wav = cache[cache_key]
            else:
                raw_mp3 = tmp_dir / f"seg_{idx:06d}.mp3"
                seg_wav = tmp_dir / f"seg_{idx:06d}.wav"
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
                cache[cache_key] = seg_wav
            rendered_wavs.append((cue, seg_wav))

            if idx == total or idx % max(1, total // 10) == 0:
                progress = 10 + int((idx / total) * 70)
                _update_job(db, job, JobStatus.running, min(progress, 80), "synthesize_tts")

        _update_job(db, job, JobStatus.running, 85, "stitch_timeline")
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

        if fmt == "mp3":
            _update_job(db, job, JobStatus.running, 95, "encode_output")
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
            "dubbed_audio": str(output_path),
            "dub_srt": str(srt_path),
            "dub_voice": voice,
            "dub_rate": rate,
            "dub_volume": volume,
            "dub_pitch": pitch,
            "dub_output_key": output_basename,
        }
        _update_job(db, job, JobStatus.done, 100, "done", artifacts=artifacts)
        project.status = ProjectStatus.ready
        db.add(project)
        db.commit()
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return {"ok": True, "job_id": job_id, "artifacts": artifacts}
    except Exception as ex:
        job = db.get(PipelineJob, job_id)
        if job:
            _update_job(db, job, JobStatus.failed, job.progress if job.progress else 0, "error", str(ex))
        if job:
            project = db.get(Project, job.project_id)
            if project:
                project.status = ProjectStatus.failed
                db.add(project)
                db.commit()
        return {"ok": False, "job_id": job_id, "error": str(ex)}
    finally:
        db.close()

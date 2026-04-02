import csv
import json
from pathlib import Path
from typing import Iterable


def _fmt_srt_time(sec: float) -> str:
    hours = int(sec // 3600)
    minutes = int((sec % 3600) // 60)
    seconds = int(sec % 60)
    millis = int((sec - int(sec)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def _fmt_vtt_time(sec: float) -> str:
    hours = int(sec // 3600)
    minutes = int((sec % 3600) // 60)
    seconds = int(sec % 60)
    millis = int((sec - int(sec)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def _compose_text(seg: dict, content_mode: str) -> str:
    raw = (seg.get("raw_text") or "").strip()
    translated = (seg.get("translated_text") or "").strip()
    if content_mode == "raw":
        return raw
    if content_mode == "translated":
        return translated or raw
    if raw and translated:
        return f"{raw}\n{translated}"
    return translated or raw


def export_subtitle_file(
    segments: Iterable[dict],
    output_path: Path,
    export_format: str,
    content_mode: str,
) -> Path:
    export_format = export_format.lower().strip()
    content_mode = content_mode.lower().strip()
    rows = list(segments)

    if export_format == "srt":
        with output_path.open("w", encoding="utf-8") as f:
            for idx, seg in enumerate(rows, start=1):
                f.write(f"{idx}\n")
                f.write(f"{_fmt_srt_time(float(seg['start_sec']))} --> {_fmt_srt_time(float(seg['end_sec']))}\n")
                f.write(f"{_compose_text(seg, content_mode)}\n\n")
        return output_path

    if export_format == "vtt":
        with output_path.open("w", encoding="utf-8") as f:
            f.write("WEBVTT\n\n")
            for idx, seg in enumerate(rows, start=1):
                f.write(f"{idx}\n")
                f.write(f"{_fmt_vtt_time(float(seg['start_sec']))} --> {_fmt_vtt_time(float(seg['end_sec']))}\n")
                f.write(f"{_compose_text(seg, content_mode)}\n\n")
        return output_path

    if export_format == "csv":
        with output_path.open("w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["index", "start_sec", "end_sec", "raw_text", "translated_text", "content"])
            for idx, seg in enumerate(rows, start=1):
                writer.writerow(
                    [
                        idx,
                        f"{float(seg['start_sec']):.3f}",
                        f"{float(seg['end_sec']):.3f}",
                        seg.get("raw_text", ""),
                        seg.get("translated_text", ""),
                        _compose_text(seg, content_mode),
                    ]
                )
        return output_path

    if export_format == "txt":
        with output_path.open("w", encoding="utf-8") as f:
            for idx, seg in enumerate(rows, start=1):
                f.write(
                    f"[{idx}] {_fmt_srt_time(float(seg['start_sec']))} --> {_fmt_srt_time(float(seg['end_sec']))}\n"
                    f"{_compose_text(seg, content_mode)}\n\n"
                )
        return output_path

    if export_format == "json":
        payload = []
        for idx, seg in enumerate(rows, start=1):
            payload.append(
                {
                    "index": idx,
                    "start_sec": float(seg["start_sec"]),
                    "end_sec": float(seg["end_sec"]),
                    "raw_text": seg.get("raw_text", ""),
                    "translated_text": seg.get("translated_text", ""),
                    "content": _compose_text(seg, content_mode),
                }
            )
        with output_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return output_path

    raise ValueError(f"unsupported_export_format: {export_format}")


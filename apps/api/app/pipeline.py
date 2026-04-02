import json
from pathlib import Path
from typing import Any
from urllib import error, request

from sqlalchemy.orm import Session

from .crud import list_segments, replace_segments
from .db import SessionLocal
from .exporter import export_subtitle_file
from .models import JobStatus, PipelineJob, Project, ProjectStatus
from .settings import get_settings


def _update_job(db: Session, job: PipelineJob, status: JobStatus, progress: int, step: str, error_message: str = "", artifacts: dict | None = None) -> None:
    job.status = status
    job.progress = progress
    job.step = step
    job.error_message = error_message
    if artifacts is not None:
        job.artifacts = artifacts
    db.add(job)
    db.commit()
    db.refresh(job)


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


def _ocr_segments_from_video(project: Project) -> list[dict[str, Any]]:
    if not project.video_path:
        return []
    video_path = Path(project.video_path)
    if not video_path.exists():
        return []
    try:
        import cv2  # type: ignore
        from rapidocr_onnxruntime import RapidOCR  # type: ignore
    except Exception:
        return []

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    sample_step = int(max(1, fps))  # sample moi giay

    engine = RapidOCR()
    segments = []
    idx = 0
    last_text = ""
    while idx < total_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok or frame is None:
            idx += sample_step
            continue

        h, w = frame.shape[:2]
        x = int(project.roi_x * w)
        y = int(project.roi_y * h)
        rw = int(project.roi_w * w)
        rh = int(project.roi_h * h)
        crop = frame[y : y + rh, x : x + rw]
        if crop.size == 0:
            idx += sample_step
            continue

        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        result = engine(gray)
        # rapidocr tra ve tuple (ocr_result, elapsed)
        ocr_result = result[0] if isinstance(result, tuple) else result
        if not ocr_result:
            idx += sample_step
            continue

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
            idx += sample_step
            continue

        text = " ".join(texts).strip()
        text = " ".join(text.split())
        if len(text) < 2:
            idx += sample_step
            continue
        if text == last_text:
            idx += sample_step
            continue

        start_sec = idx / fps
        end_sec = start_sec + 2.8
        last_text = text
        segments.append(
            {
                "start_sec": start_sec,
                "end_sec": end_sec,
                "raw_text": text,
                "translated_text": "",
                "speaker": "narrator",
                "voice": "narrator-neutral",
                "confidence": sum(scores) / len(scores) if scores else 0.8,
            }
        )
        idx += sample_step

    cap.release()
    return segments


def _apply_glossary(text: str, glossary: str) -> str:
    for raw in glossary.splitlines():
        row = raw.strip()
        if not row or "=" not in row:
            continue
        src, dst = row.split("=", 1)
        text = text.replace(src.strip(), dst.strip())
    return text


def _call_gemini_translate(text: str, prompt: str, api_key: str, source_lang: str, target_lang: str) -> tuple[str, str]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    system_prompt = (
        "You are subtitle translator. Keep tone natural, concise, and cinematic. "
        f"Translate from {source_lang} to {target_lang}. "
        "Return only translated text."
    )
    if prompt:
        system_prompt = f"{system_prompt}\nExtra style prompt: {prompt}"
    body = {
        "contents": [
            {
                "parts": [
                    {"text": system_prompt},
                    {"text": text},
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


def _translate_with_fallback(text: str, prompt: str, api_key: str | None, source_lang: str, target_lang: str) -> tuple[str, str, str]:
    if api_key:
        translated, err = _call_gemini_translate(text, prompt, api_key, source_lang, target_lang)
        if translated:
            return translated, "gemini", ""
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


def _resolve_gemini_key(runtime_key: str | None) -> str | None:
    if runtime_key:
        return runtime_key.strip()
    keys = get_settings().gemini_api_keys
    if not keys:
        return None
    first = keys.split(",")[0].strip()
    return first or None


def run_pipeline(job_id: str, gemini_api_key: str | None = None, voice_map: dict[str, str] | None = None) -> dict[str, Any]:
    db = SessionLocal()
    voice_map = voice_map or {}
    try:
        resolved_api_key = _resolve_gemini_key(gemini_api_key)
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

        _update_job(db, job, JobStatus.running, 5, "ocr")
        segments = _ocr_segments_from_video(project)
        if not segments:
            segments = _fake_ocr_segments(project)
        replace_segments(db, project.id, segments)

        _update_job(db, job, JobStatus.running, 35, "translate")
        db_segments = list_segments(db, project.id)
        normalized = []
        translation_stats = {"gemini": 0, "deep_translator": 0, "fallback_tag": 0}
        first_translation_error = ""
        for seg in db_segments:
            txt, provider, err = _translate_with_fallback(
                seg.raw_text,
                project.prompt,
                resolved_api_key,
                project.source_lang,
                project.target_lang,
            )
            if provider in translation_stats:
                translation_stats[provider] += 1
            if err and not first_translation_error:
                first_translation_error = err
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
        replace_segments(db, project.id, normalized)

        _update_job(db, job, JobStatus.running, 65, "dedupe_merge")
        # MVP: bo qua merge nang cao, chi loai dong trung lien tiep.
        deduped = []
        prev = None
        for seg in normalized:
            if prev and prev["translated_text"] == seg["translated_text"]:
                prev["end_sec"] = seg["end_sec"]
                continue
            prev = seg.copy()
            deduped.append(prev)
        replace_segments(db, project.id, deduped)

        _update_job(db, job, JobStatus.running, 80, "tts")
        project_dir = Path(project.video_path).parent if project.video_path else Path.cwd()
        tts_script = project_dir / "tts_lines.txt"
        with tts_script.open("w", encoding="utf-8") as f:
            for seg in deduped:
                f.write(f"{seg['start_sec']:.2f}-{seg['end_sec']:.2f} [{seg['voice']}] {seg['translated_text']}\n")

        _update_job(db, job, JobStatus.running, 90, "export")
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
            "srt": str(srt_path),
            "json": str(json_path),
            "tts_script": str(tts_script),
            "translation_stats": translation_stats,
            "translation_error_hint": first_translation_error,
        }
        _update_job(db, job, JobStatus.done, 100, "done", artifacts=artifacts)
        project.status = ProjectStatus.ready
        db.add(project)
        db.commit()
        return {"ok": True, "job_id": job_id, "artifacts": artifacts}
    except Exception as ex:
        job = db.get(PipelineJob, job_id)
        if job:
            _update_job(db, job, JobStatus.failed, job.progress if job.progress else 0, "error", str(ex))
        project = db.get(Project, job.project_id) if job else None
        if project:
            project.status = ProjectStatus.failed
            db.add(project)
            db.commit()
        return {"ok": False, "job_id": job_id, "error": str(ex)}
    finally:
        db.close()

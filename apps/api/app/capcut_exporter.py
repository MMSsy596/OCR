"""
CapCut Exporter â€” Táº¡o dá»± Ã¡n CapCut draft tá»« segments OCR Ä‘Ã£ dá»‹ch.

Luá»“ng hoáº¡t Ä‘á»™ng:
  1. Nháº­n project_id + danh sÃ¡ch segment (start_sec, end_sec, translated_text)
  2. Detect Ä‘Æ°á»ng dáº«n CapCut root + font
  3. Táº¡o thÆ° má»¥c draft má»›i trong com.lveditor.draft/
  4. Ghi draft_content.json (video track + subtitle text track + optional audio track)
  5. Ghi draft_meta_info.json
  6. Cáº­p nháº­t root_meta_info.json
"""
import base64
import json
import logging
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

logger = logging.getLogger("solar.ocr.capcut_export")

_BUNDLED_CAPCUT_TEMPLATE_DIR = Path(__file__).resolve().parent / "capcut_template" / "0416"


_PLACEHOLDER_JPEG_BASE64 = (
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUVFRUWFhUV"
    "FRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGyslICYtLS0tLS0tLS0t"
    "LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/"
    "xAAbAAADAQEBAQEAAAAAAAAAAAAABQYDBAcCAf/EADQQAAEDAgQDBgQEBwAAAAAAAAECAwQFEQAS"
    "ITFBBhMiUWEHFDJxgZEjQlKhsdHwFSNSYnL/xAAZAQADAQEBAAAAAAAAAAAAAAABAgMABAX/xAAm"
    "EQACAgICAgIBBQEAAAAAAAAAAQIRAxIhMQQTQVEiMmFxBRQj/9oADAMBAAIRAxEAPwD9mREQEREBE"
    "RAREQEREBERAREQEREBERB//2Q=="
)


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Helpers
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _new_uuid() -> str:
    """Táº¡o UUID dáº¡ng uppercase vá»›i dáº¥u gáº¡ch ngang, giá»‘ng CapCut dÃ¹ng."""
    return str(uuid.uuid4()).upper()


def _sec_to_us(sec: float) -> int:
    """Chuyá»ƒn giÃ¢y sang microseconds (Ä‘Æ¡n vá»‹ thá»i gian cá»§a CapCut)."""
    return int(sec * 1_000_000)


def _get_capcut_root() -> Path | None:
    """Tráº£ vá» thÆ° má»¥c gá»‘c CapCut draft."""
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        candidate = Path(local_app_data) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
        if candidate.exists():
            return candidate
    home = Path.home()
    fallback = home / "AppData" / "Local" / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
    if fallback.exists():
        return fallback
    return None


def _get_bundled_reference_draft() -> Path | None:
    if _BUNDLED_CAPCUT_TEMPLATE_DIR.exists():
        return _BUNDLED_CAPCUT_TEMPLATE_DIR
    return None


def _detect_capcut_font() -> str:
    """TÃ¬m Ä‘Æ°á»ng dáº«n font SystemFont cá»§a CapCut (thay Ä‘á»•i theo version)."""
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if not local_app_data:
        return ""
    apps_dir = Path(local_app_data) / "CapCut" / "Apps"
    if not apps_dir.exists():
        return ""
    # TÃ¬m version má»›i nháº¥t
    versions = sorted(
        [d for d in apps_dir.iterdir() if d.is_dir()],
        key=lambda p: p.name,
        reverse=True,
    )
    for ver in versions:
        font = ver / "Resources" / "Font" / "SystemFont" / "en.ttf"
        if font.exists():
            return str(font).replace("\\", "/")
    return ""


def _get_ffprobe_path() -> str:
    """Lay duong dan ffprobe neu co, fallback sang imageio-ffmpeg bundle."""
    sys_ffprobe = shutil.which("ffprobe")
    if sys_ffprobe:
        return sys_ffprobe
    try:
        import imageio_ffmpeg  # type: ignore
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        for suffix in ("ffprobe.exe", "ffprobe"):
            candidate = Path(ffmpeg_exe).parent / suffix
            if candidate.exists():
                return str(candidate)
    except Exception:
        pass
    return "ffprobe"


def _probe_video_metadata(video_path: str | None) -> dict:
    """Doc metadata video that su bang ffprobe neu co."""
    default = {"width": 1920, "height": 1080, "fps": 30.0, "duration_us": 0}
    if not video_path:
        return default

    path = Path(video_path)
    if not path.exists():
        return default

    cmd = [
        _get_ffprobe_path(),
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,avg_frame_rate,duration",
        "-of",
        "json",
        str(path),
    ]
    try:
        out = subprocess.run(cmd, check=True, capture_output=True, text=True)
        payload = json.loads(out.stdout or "{}")
        streams = payload.get("streams") or []
        stream = streams[0] if streams else {}
        width = int(stream.get("width") or default["width"])
        height = int(stream.get("height") or default["height"])
        fps_raw = str(stream.get("avg_frame_rate") or "").strip()
        fps = default["fps"]
        if fps_raw and fps_raw not in {"0/0", "0"}:
            if "/" in fps_raw:
                num, den = fps_raw.split("/", 1)
                fps = float(num) / max(float(den), 1.0)
            else:
                fps = float(fps_raw)
        duration_us = _sec_to_us(float(stream.get("duration") or 0.0))
        return {
            "width": max(1, width),
            "height": max(1, height),
            "fps": fps if fps > 0 else default["fps"],
            "duration_us": max(0, duration_us),
        }
    except Exception:
        logger.warning("Khong probe duoc metadata video %s", video_path, exc_info=True)
    try:
        import cv2  # type: ignore

        cap = cv2.VideoCapture(str(path))
        if cap.isOpened():
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or default["width"])
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or default["height"])
            fps = float(cap.get(cv2.CAP_PROP_FPS) or default["fps"])
            frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
            cap.release()
            duration_us = _sec_to_us(frames / fps) if fps > 0 and frames > 0 else 0
            return {
                "width": max(1, width),
                "height": max(1, height),
                "fps": fps if fps > 0 else default["fps"],
                "duration_us": max(0, duration_us),
            }
    except Exception:
        logger.warning("Khong fallback probe bang cv2 duoc cho %s", video_path, exc_info=True)
    return default


def _deep_clone(value):
    return json.loads(json.dumps(value, ensure_ascii=False))


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _write_json(path: Path, payload: dict) -> None:
    path.write_bytes(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )


def _create_unique_draft_folder(capcut_root: Path, preferred_name: str) -> Path:
    """Tao thu muc draft duy nhat theo cach an toan khi co request chay dong thoi."""
    base_name = preferred_name.strip() or "Solar OCR Export"
    counter = 0
    while True:
        folder_name = base_name if counter == 0 else f"{base_name} ({counter})"
        draft_folder = capcut_root / folder_name
        try:
            draft_folder.mkdir(parents=True, exist_ok=False)
            return draft_folder
        except FileExistsError:
            counter += 1


def _is_safe_reference_draft(content: dict) -> bool:
    materials = content.get("materials") or {}
    tracks = content.get("tracks") or []
    videos = materials.get("videos") or []
    texts = materials.get("texts") or []
    track_types = [track.get("type") for track in tracks]
    text_tracks = [track for track in tracks if track.get("type") == "text"]
    if not videos:
        return False
    if track_types.count("video") != 1:
        return False
    if len(text_tracks) < 2:
        return False
    if any(track_type not in {"video", "text"} for track_type in track_types):
        return False
    text_segment_count = sum(len(track.get("segments") or []) for track in text_tracks)
    if text_segment_count < 1:
        return False
    if len(texts) != text_segment_count:
        return False
    return True


def _pick_reference_draft(capcut_root: Path, exclude_names: set[str] | None = None) -> Path | None:
    exclude_names = exclude_names or set()
    best_path: Path | None = None
    best_score: tuple[int, int, int] | None = None
    for entry in capcut_root.iterdir():
        if not entry.is_dir() or entry.name in exclude_names:
            continue
        if "broken" in entry.name.lower():
            continue
        draft_content_path = entry / "draft_content.json"
        draft_meta_path = entry / "draft_meta_info.json"
        timeline_layout_path = entry / "timeline_layout.json"
        timeline_project_path = entry / "Timelines" / "project.json"
        if not all(p.exists() for p in (draft_content_path, draft_meta_path, timeline_layout_path, timeline_project_path)):
            continue
        try:
            content = _load_json(draft_content_path)
            if not _is_safe_reference_draft(content):
                continue
            texts = (content.get("materials") or {}).get("texts") or []
            score = (
                int(entry.stat().st_mtime_ns),
                len(texts),
                int(draft_content_path.stat().st_size),
            )
            if best_score is None or score > best_score:
                best_score = score
                best_path = entry
        except Exception:
            logger.warning("Khong doc duoc draft tham chieu %s", entry, exc_info=True)
    return best_path


def _rebuild_text_tracks_from_reference(track_templates: list[dict], generated_segments: list[dict]) -> list[dict]:
    if not track_templates or not generated_segments:
        return []

    capacities = [max(1, len(track.get("segments") or [])) for track in track_templates]
    rebuilt_tracks: list[dict] = []
    offset = 0
    total_segments = len(generated_segments)

    for idx, template in enumerate(track_templates):
        remaining = total_segments - offset
        if remaining <= 0:
            break
        if idx == len(track_templates) - 1:
            take = remaining
        else:
            remaining_tracks = len(track_templates) - idx - 1
            reserve_for_rest = min(remaining_tracks, max(0, remaining - 1))
            max_take = max(1, remaining - reserve_for_rest)
            take = min(capacities[idx], max_take)
        rebuilt_track = _deep_clone(template)
        rebuilt_track["segments"] = generated_segments[offset:offset + take]
        rebuilt_tracks.append(rebuilt_track)
        offset += take

    if offset < total_segments and rebuilt_tracks:
        rebuilt_tracks[-1]["segments"].extend(generated_segments[offset:])

    return rebuilt_tracks


def _build_key_value_payload(segment_id: str, material_id: str, material_name: str) -> dict:
    return {
        segment_id: {
            "filter_category": "",
            "filter_detail": "",
            "is_brand": 0,
            "is_from_artist_shop": 0,
            "is_vip": "0",
            "keywordSource": "",
            "materialCategory": "media",
            "materialId": material_id,
            "materialName": material_name,
            "materialSubcategory": "local",
            "materialSubcategoryId": "",
            "materialThirdcategory": "Import",
            "materialThirdcategoryId": "",
            "material_copyright": "",
            "material_is_purchased": "",
            "rank": "0",
            "rec_id": "",
            "requestId": "",
            "role": "",
            "searchId": "",
            "searchKeyword": "",
            "segmentId": segment_id,
            "team_id": "",
            "textTemplateVersion": "",
        },
        material_id: {
            "Tiktok_music_is_avaliable": False,
            "add_to_timeline_before_download": False,
            "commerce_template_cate": "",
            "commerce_template_pay_status": "",
            "commerce_template_pay_type": "",
            "enter_from": "",
            "filter_category": "",
            "filter_detail": "",
            "is_brand": 0,
            "is_favorite": False,
            "is_from_artist_shop": 0,
            "is_limited": False,
            "is_similar_music": False,
            "is_vip": "0",
            "keywordSource": "",
            "materialCategory": "media",
            "materialId": material_id,
            "materialName": material_name,
            "materialSubcategory": "local",
            "materialSubcategoryId": "",
            "materialThirdcategory": "Import",
            "materialThirdcategoryId": "",
            "material_copyright": "",
            "material_is_purchased": "",
            "music_source": "",
            "original_song_id": "",
            "original_song_name": "",
            "pgc_id": "",
            "pgc_name": "",
            "previewed": 0,
            "previewed_before_added": 0,
            "rank": "0",
            "rec_id": "",
            "requestId": "",
            "right_block_type": "",
            "right_count_type": "",
            "right_is_trial": "",
            "right_oneoff_mix_type": "",
            "right_trial_limit_left": "",
            "right_trial_mode": "",
            "right_trial_type": "",
            "role": "",
            "searchId": "",
            "searchKeyword": "",
            "special_effect_loading_type": "",
            "team_id": "",
            "template_author_id": "",
            "template_drafts_price": 0,
            "template_duration": 0,
            "template_fragment_cnt": 0,
            "template_need_purcahse": True,
            "template_pay_type": "",
            "template_type": "",
            "template_use_cnt": 0,
            "textTemplateVersion": "",
        },
    }


def _build_draft_virtual_store_payload(placeholder_id: str, video_id: str) -> dict:
    return {
        "draft_materials": [],
        "draft_virtual_store": [
            {
                "type": 0,
                "value": [{
                    "creation_time": 0,
                    "display_name": "",
                    "filter_type": 0,
                    "id": "",
                    "import_time": 0,
                    "import_time_us": 0,
                    "sort_sub_type": 0,
                    "sort_type": 0,
                    "subdraft_filter_type": 0,
                }],
            },
            {
                "type": 1,
                "value": [
                    {"child_id": placeholder_id, "parent_id": ""},
                    {"child_id": video_id, "parent_id": ""},
                ],
            },
            {"type": 2, "value": []},
        ],
    }


def _build_placeholder_meta_entry(*, placeholder_meta_id: str, now_s: int, now_us: int) -> dict:
    return {
        "ai_group_type": "",
        "create_time": now_s,
        "duration": 33333,
        "enter_from": 0,
        "extra_info": "",
        "file_Path": "",
        "height": 0,
        "id": placeholder_meta_id,
        "import_time": now_s,
        "import_time_ms": now_us,
        "item_source": 1,
        "md5": "",
        "metetype": "none",
        "roughcut_time_range": {"duration": 33333, "start": 0},
        "sub_time_range": {"duration": -1, "start": -1},
        "type": 0,
        "width": 0,
    }


def _build_video_meta_entry(
    *,
    video_meta_id: str,
    video_name: str,
    video_path_fwd: str,
    video_width: int,
    video_height: int,
    video_duration_us: int,
    now_s: int,
    now_us: int,
) -> dict:
    return {
        "ai_group_type": "",
        "create_time": now_s,
        "duration": video_duration_us,
        "enter_from": 0,
        "extra_info": video_name,
        "file_Path": video_path_fwd,
        "height": video_height,
        "id": video_meta_id,
        "import_time": now_s,
        "import_time_ms": now_us,
        "item_source": 1,
        "md5": "",
        "metetype": "video",
        "roughcut_time_range": {"duration": video_duration_us, "start": 0},
        "sub_time_range": {"duration": -1, "start": -1},
        "type": 0,
        "width": video_width,
    }


def _build_audio_meta_entry(
    *,
    audio_name: str,
    audio_path_fwd: str,
    audio_duration_us: int,
    audio_meta_id: str,
    now_s: int,
    now_us: int,
) -> dict:
    return {
        "ai_group_type": "",
        "create_time": now_s,
        "duration": audio_duration_us,
        "enter_from": 0,
        "extra_info": audio_name,
        "file_Path": audio_path_fwd,
        "height": 0,
        "id": audio_meta_id,
        "import_time": now_s,
        "import_time_ms": now_us,
        "item_source": 1,
        "md5": "",
        "metetype": "music",
        "roughcut_time_range": {"duration": audio_duration_us, "start": 0},
        "sub_time_range": {"duration": -1, "start": -1},
        "type": 0,
        "width": 0,
    }


def _clone_text_material_from_template(template: dict, text: str, font_path: str, group_id: str) -> dict:
    material = _deep_clone(template)
    material["id"] = _new_uuid()
    material["group_id"] = group_id
    material["font_path"] = font_path or material.get("font_path", "")
    content = {}
    try:
        content = json.loads(material.get("content") or "{}")
    except Exception:
        content = {}
    styles = content.get("styles") or [{}]
    text_len = len(text)
    for style in styles:
        style["range"] = [0, text_len]
        font_info = style.get("font") or {}
        font_info["id"] = ""
        if font_path:
            font_info["path"] = font_path
        style["font"] = font_info
    content["styles"] = styles
    content["text"] = text
    material["content"] = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
    return material


def _clone_text_animation_from_template(template: dict) -> dict:
    animation = _deep_clone(template)
    animation["id"] = _new_uuid()
    return animation


def _clone_text_segment_from_template(
    template: dict,
    material_id: str,
    animation_id: str,
    start_us: int,
    duration_us: int,
    render_index: int,
) -> dict:
    segment = _deep_clone(template)
    segment["id"] = _new_uuid()
    segment["material_id"] = material_id
    segment["render_index"] = render_index
    segment["extra_material_refs"] = [animation_id]
    segment["source_timerange"] = None
    segment["target_timerange"] = {"duration": duration_us, "start": start_us}
    return segment


def _upsert_root_meta(
    capcut_root: Path,
    draft_folder: Path,
    draft_id: str,
    draft_name: str,
    content_size: int,
    video_duration_us: int,
    now_us: int,
) -> None:
    root_meta_path = capcut_root / "root_meta_info.json"
    try:
        if root_meta_path.exists():
            root_meta = _load_json(root_meta_path)
        else:
            root_meta = {"all_draft_store": [], "draft_ids": 0, "root_path": str(capcut_root).replace("\\", "/")}
        folder_path_fwd = str(draft_folder).replace("\\", "/")
        store = [
            item for item in (root_meta.get("all_draft_store") or [])
            if item.get("draft_fold_path") != folder_path_fwd
        ]
        store.insert(0, {
            "cloud_draft_cover": False,
            "cloud_draft_sync": False,
            "draft_cloud_last_action_download": False,
            "draft_cloud_purchase_info": "",
            "draft_cloud_template_id": "",
            "draft_cloud_tutorial_info": "",
            "draft_cloud_videocut_purchase_info": "",
            "draft_cover": str(draft_folder / "draft_cover.jpg").replace("\\", "/"),
            "draft_fold_path": folder_path_fwd,
            "draft_id": draft_id,
            "draft_is_ai_shorts": False,
            "draft_is_cloud_temp_draft": False,
            "draft_is_invisible": False,
            "draft_is_web_article_video": False,
            "draft_json_file": str(draft_folder / "draft_content.json").replace("\\", "/"),
            "draft_name": draft_name,
            "draft_new_version": "",
            "draft_root_path": str(capcut_root).replace("/", "\\"),
            "draft_timeline_materials_size": content_size,
            "draft_type": "",
            "draft_web_article_video_enter_from": "",
            "streaming_edit_draft_ready": True,
            "tm_draft_cloud_completed": "",
            "tm_draft_cloud_entry_id": -1,
            "tm_draft_cloud_modified": 0,
            "tm_draft_cloud_parent_entry_id": -1,
            "tm_draft_cloud_space_id": -1,
            "tm_draft_cloud_user_id": -1,
            "tm_draft_create": now_us,
            "tm_draft_modified": now_us,
            "tm_draft_removed": 0,
            "tm_duration": video_duration_us,
        })
        root_meta["all_draft_store"] = store
        root_meta["draft_ids"] = len(store)
        _write_json(root_meta_path, root_meta)
    except Exception:
        logger.warning("Khong cap nhat duoc root_meta_info.json", exc_info=True)


def _export_to_capcut_from_reference(
    *,
    capcut_root: Path,
    reference_draft: Path,
    draft_folder: Path,
    draft_name: str,
    video_path: str | None,
    segments: list[dict],
    font_path: str,
    dub_audio_path: str | None,
) -> dict:
    now_us = int(time.time() * 1_000_000)
    now_s = int(time.time())
    draft_id = _new_uuid()
    timeline_uuid = _new_uuid()
    timelines_project_id = _new_uuid()
    group_id = f"import_{int(time.time() * 1000)}"

    shutil.copytree(reference_draft, draft_folder, dirs_exist_ok=True)

    timeline_project_path = draft_folder / "Timelines" / "project.json"
    timelines_project = _load_json(timeline_project_path)
    old_timeline_uuid = timelines_project.get("main_timeline_id") or ((timelines_project.get("timelines") or [{}])[0].get("id"))
    if not old_timeline_uuid:
        raise RuntimeError("reference_timeline_missing")

    old_timeline_dir = draft_folder / "Timelines" / old_timeline_uuid
    new_timeline_dir = draft_folder / "Timelines" / timeline_uuid
    if old_timeline_dir.exists() and old_timeline_dir != new_timeline_dir:
        old_timeline_dir.rename(new_timeline_dir)
    new_timeline_dir.mkdir(exist_ok=True)
    (new_timeline_dir / "common_attachment").mkdir(exist_ok=True)

    draft_content = _load_json(draft_folder / "draft_content.json")
    draft_meta = _load_json(draft_folder / "draft_meta_info.json")
    timeline_layout = _load_json(draft_folder / "timeline_layout.json")

    video_info = _probe_video_metadata(video_path)
    video_width = int(video_info["width"])
    video_height = int(video_info["height"])
    video_fps = float(video_info["fps"])
    total_end_sec = max((seg.get("end_sec", 0) for seg in segments), default=0) if segments else 0
    video_duration_us = int(video_info["duration_us"]) or _sec_to_us(total_end_sec) or 30_000_000
    video_path_fwd = str(video_path).replace("\\", "/") if video_path else ""
    video_name = Path(video_path).name if video_path else "source.mp4"
    include_dub = bool(dub_audio_path and Path(dub_audio_path).exists())
    dub_path_fwd = str(dub_audio_path).replace("\\", "/") if include_dub and dub_audio_path else ""
    dub_name = Path(dub_audio_path).name if include_dub and dub_audio_path else ""

    type0 = next((item for item in (draft_meta.get("draft_materials") or []) if item.get("type") == 0), None)
    if not type0:
        raise RuntimeError("reference_meta_video_missing")
    type0_values = type0.get("value") or []
    if not type0_values:
        raise RuntimeError("reference_meta_video_missing")
    placeholder_meta = next((item for item in type0_values if item.get("metetype") == "none"), None)
    video_meta = next((item for item in type0_values if item.get("metetype") == "video"), None) or type0_values[-1]
    placeholder_meta_id = (placeholder_meta or {}).get("id") or str(uuid.uuid4()).lower()
    video_meta_id = video_meta.get("id") or str(uuid.uuid4()).lower()

    video_materials = draft_content.get("materials", {}).get("videos") or []
    if not video_materials:
        raise RuntimeError("reference_video_material_missing")
    video_material = video_materials[0]
    video_material["width"] = video_width
    video_material["height"] = video_height
    video_material["duration"] = video_duration_us
    video_material["path"] = video_path_fwd
    video_material["material_name"] = video_name
    video_material["local_material_id"] = video_meta_id

    all_tracks = draft_content.get("tracks") or []
    video_track = next((track for track in all_tracks if track.get("type") == "video"), None)
    text_tracks = [track for track in all_tracks if track.get("type") == "text"]
    audio_track = next((track for track in all_tracks if track.get("type") == "audio"), None)
    text_track = text_tracks[0] if text_tracks else None
    if not video_track or not text_track or not video_track.get("segments"):
        raise RuntimeError("reference_tracks_missing")
    video_track_segment = video_track["segments"][0]
    video_track_segment["material_id"] = video_material["id"]
    if video_track_segment.get("source_timerange") is not None:
        video_track_segment["source_timerange"] = {"duration": video_duration_us, "start": 0}
    video_track_segment["target_timerange"] = {"duration": video_duration_us, "start": 0}

    text_template = ((draft_content.get("materials") or {}).get("texts") or [None])[0]
    animation_template = ((draft_content.get("materials") or {}).get("material_animations") or [None])[0]
    text_segment_template = (text_track.get("segments") or [None])[0]
    if not text_template or not animation_template or not text_segment_template:
        raise RuntimeError("reference_text_templates_missing")

    valid_text_segments = [
        seg for seg in segments
        if (seg.get("translated_text") or seg.get("raw_text") or "").strip()
    ]
    valid_text_segments.sort(key=lambda item: float(item.get("start_sec", 0)))

    text_materials = []
    material_animations = []
    text_track_segments = []
    for idx, seg in enumerate(valid_text_segments):
        text = (seg.get("translated_text") or seg.get("raw_text") or "").strip()
        start_us = _sec_to_us(seg.get("start_sec", 0))
        end_us = _sec_to_us(seg.get("end_sec", 0))
        if idx + 1 < len(valid_text_segments):
            next_start_us = _sec_to_us(valid_text_segments[idx + 1].get("start_sec", 0))
            if next_start_us > start_us:
                end_us = min(end_us, next_start_us)
        duration_us = max(1, end_us - start_us)
        text_material = _clone_text_material_from_template(text_template, text, font_path, group_id)
        text_animation = _clone_text_animation_from_template(animation_template)
        text_segment = _clone_text_segment_from_template(
            text_segment_template,
            text_material["id"],
            text_animation["id"],
            start_us,
            duration_us,
            14000 + idx,
        )
        text_materials.append(text_material)
        material_animations.append(text_animation)
        text_track_segments.append(text_segment)

    draft_content["id"] = timeline_uuid
    draft_content["canvas_config"]["width"] = video_width
    draft_content["canvas_config"]["height"] = video_height
    draft_content["duration"] = video_duration_us
    draft_content["fps"] = video_fps
    if draft_content.get("function_assistant_info", {}).get("fps") is not None:
        draft_content["function_assistant_info"]["fps"] = {"den": 1, "num": int(round(video_fps))}
    if draft_content.get("materials", {}).get("sound_channel_mappings"):
        draft_content["materials"]["sound_channel_mappings"][0]["type"] = ""
    draft_content["materials"]["texts"] = text_materials
    draft_content["materials"]["material_animations"] = material_animations
    rebuilt_text_tracks = _rebuild_text_tracks_from_reference(text_tracks, text_track_segments)
    rebuilt_tracks = [video_track, *rebuilt_text_tracks]

    if include_dub:
        audio_materials = draft_content.get("materials", {}).get("audios") or []
        if not audio_materials or not audio_track or not audio_track.get("segments"):
            raise RuntimeError("reference_audio_template_missing")
        audio_material = audio_materials[0]
        audio_material["duration"] = video_duration_us
        audio_material["name"] = dub_name
        audio_material["path"] = dub_path_fwd
        audio_material["local_material_id"] = str(uuid.uuid4()).lower()
        audio_material["music_id"] = str(uuid.uuid4()).lower()
        audio_track_segment = audio_track["segments"][0]
        audio_track_segment["material_id"] = audio_material["id"]
        if audio_track_segment.get("source_timerange") is not None:
            audio_track_segment["source_timerange"] = {"duration": video_duration_us, "start": 0}
        audio_track_segment["target_timerange"] = {"duration": video_duration_us, "start": 0}
        rebuilt_tracks.append(audio_track)
    else:
        draft_content["materials"]["audios"] = []

    draft_content["tracks"] = rebuilt_tracks

    built_type0_values = {
        "none": _build_placeholder_meta_entry(
            placeholder_meta_id=placeholder_meta_id,
            now_s=now_s,
            now_us=now_us,
        ),
        "video": _build_video_meta_entry(
            video_meta_id=video_meta_id,
            video_name=video_name,
            video_path_fwd=video_path_fwd,
            video_width=video_width,
            video_height=video_height,
            video_duration_us=video_duration_us,
            now_s=now_s,
            now_us=now_us,
        ),
    }
    if include_dub:
        audio_meta = next((item for item in type0_values if item.get("metetype") == "music"), None)
        audio_meta_id = (audio_meta or {}).get("id") or str(uuid.uuid4()).lower()
        built_type0_values["music"] = _build_audio_meta_entry(
            audio_name=dub_name,
            audio_path_fwd=dub_path_fwd,
            audio_duration_us=video_duration_us,
            audio_meta_id=audio_meta_id,
            now_s=now_s,
            now_us=now_us,
        )

    ordered_type0_values = []
    used_type0_keys: set[str] = set()
    for item in type0_values:
        metetype = item.get("metetype") or ""
        if metetype in built_type0_values and metetype not in used_type0_keys:
            ordered_type0_values.append(built_type0_values[metetype])
            used_type0_keys.add(metetype)
    for metetype in ("video", "none", "music"):
        if metetype in built_type0_values and metetype not in used_type0_keys:
            ordered_type0_values.append(built_type0_values[metetype])
            used_type0_keys.add(metetype)
    type0["value"] = ordered_type0_values
    type2 = next((item for item in (draft_meta.get("draft_materials") or []) if item.get("type") == 2), None)
    if type2 is not None:
        srt_candidate = ""
        if video_path:
            siblings = sorted(Path(video_path).parent.glob("output*.srt"))
            if siblings:
                srt_candidate = str(siblings[0]).replace("\\", "/")
        if srt_candidate:
            type2["value"] = [{
                "ai_group_type": "",
                "create_time": 0,
                "duration": 0,
                "enter_from": 0,
                "extra_info": Path(srt_candidate).name,
                "file_Path": srt_candidate,
                "height": 0,
                "id": _new_uuid(),
                "import_time": now_s,
                "import_time_ms": -1,
                "item_source": 1,
                "md5": "",
                "metetype": "none",
                "roughcut_time_range": {"duration": -1, "start": -1},
                "sub_time_range": {"duration": -1, "start": -1},
                "type": 2,
                "width": 0,
            }]
        else:
            type2["value"] = []

    draft_meta["draft_name"] = draft_name
    draft_meta["draft_id"] = draft_id
    draft_meta["draft_fold_path"] = str(draft_folder).replace("\\", "/")
    draft_meta["draft_root_path"] = str(capcut_root).replace("/", "\\")
    draft_meta["tm_draft_create"] = now_us
    draft_meta["tm_draft_modified"] = now_us
    draft_meta["tm_duration"] = video_duration_us

    timelines_project["id"] = timelines_project_id
    timelines_project["main_timeline_id"] = timeline_uuid
    timelines_project["create_time"] = now_us
    timelines_project["update_time"] = now_us
    for timeline in timelines_project.get("timelines") or []:
        timeline["id"] = timeline_uuid
        timeline["create_time"] = now_us
        timeline["update_time"] = now_us

    for dock_item in timeline_layout.get("dockItems") or []:
        dock_item["timelineIds"] = [timeline_uuid]

    _write_json(timeline_project_path, timelines_project)
    shutil.copy2(timeline_project_path, draft_folder / "Timelines" / "project.json.bak")
    _write_json(draft_folder / "timeline_layout.json", timeline_layout)
    _write_json(draft_folder / "draft_meta_info.json", draft_meta)
    _write_json(draft_folder / "draft_virtual_store.json", _build_draft_virtual_store_payload(placeholder_meta_id, video_meta_id))
    _write_json(
        draft_folder / "key_value.json",
        _build_key_value_payload(video_track_segment["id"], uuid.uuid4().hex, video_name),
    )

    content_paths = [
        draft_folder / "draft_content.json",
        draft_folder / "draft_content.json.bak",
        draft_folder / "template-2.tmp",
        new_timeline_dir / "draft_content.json",
        new_timeline_dir / "draft_content.json.bak",
        new_timeline_dir / "template-2.tmp",
    ]
    content_bytes = json.dumps(draft_content, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    for path in content_paths:
        path.write_bytes(content_bytes)
    content_size = len(content_bytes)
    draft_meta["draft_timeline_materials_size_"] = content_size
    _write_json(draft_folder / "draft_meta_info.json", draft_meta)

    draft_settings_path = draft_folder / "draft_settings"
    if draft_settings_path.exists():
        draft_settings_path.write_text(
            f"[General]\ndraft_create_time={now_s}\ndraft_last_edit_time={now_s}\nreal_edit_seconds=0\nreal_edit_keys=0\n",
            encoding="utf-8",
        )

    _upsert_root_meta(
        capcut_root=capcut_root,
        draft_folder=draft_folder,
        draft_id=draft_id,
        draft_name=draft_name,
        content_size=content_size,
        video_duration_us=video_duration_us,
        now_us=now_us,
    )

    return {
        "success": True,
        "draft_folder": str(draft_folder),
        "draft_name": draft_name,
        "subtitle_count": len(text_materials),
        "message": f"Da tao du an CapCut '{draft_name}' thanh cong!",
    }


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Content builders
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _build_text_material(text: str, font_path: str) -> dict:
    """Táº¡o 1 text material cho subtitle CapCut."""
    mat_id = _new_uuid()
    text_len = len(text)
    content_inner = {
        "styles": [{
            "fill": {
                "alpha": 1.0,
                "content": {
                    "render_type": "solid",
                    "solid": {"alpha": 1.0, "color": [1.0, 1.0, 1.0]},
                },
            },
            "font": {"id": "", "path": font_path or ""},
            "range": [0, text_len],
            "size": 5.0,
        }],
        "text": text,
    }
    return {
        "add_type": 2,
        "alignment": 1,
        "background_alpha": 1.0,
        "background_color": "",
        "background_fill": "",
        "background_height": 0.14,
        "background_horizontal_offset": 0.0,
        "background_round_radius": 0.0,
        "background_style": 0,
        "background_vertical_offset": 0.0,
        "background_width": 0.14,
        "base_content": "",
        "bold_width": 0.0,
        "border_alpha": 1.0,
        "border_color": "",
        "border_mode": 0,
        "border_width": 0.08,
        "caption_template_info": {
            "category_id": "", "category_name": "", "effect_id": "",
            "is_new": False, "path": "", "request_id": "", "resource_id": "",
            "resource_name": "", "source_platform": 0, "third_resource_id": "",
        },
        "check_flag": 7,
        "combo_info": {"text_templates": []},
        "content": json.dumps(content_inner, ensure_ascii=False),
        "current_words": {"end_time": [], "start_time": [], "text": []},
        "cutoff_postfix": "",
        "enable_path_typesetting": False,
        "fixed_height": -1.0,
        "fixed_width": -1.0,
        "font_category_id": "",
        "font_category_name": "",
        "font_id": "",
        "font_name": "",
        "font_path": font_path or "",
        "font_resource_id": "",
        "font_size": 5.0,
        "font_source_platform": 0,
        "font_team_id": "",
        "font_third_resource_id": "",
        "font_title": "none",
        "font_url": "",
        "fonts": [],
        "force_apply_line_max_width": False,
        "global_alpha": 1.0,
        "group_id": f"import_{int(time.time() * 1000)}",
        "has_shadow": False,
        "id": mat_id,
        "initial_scale": 1.0,
        "inner_padding": -1.0,
        "is_batch_replace": False,
        "is_lyric_effect": False,
        "is_rich_text": False,
        "is_words_linear": False,
        "italic_degree": 0,
        "ktv_color": "",
        "language": "",
        "layer_weight": 1,
        "letter_spacing": 0.0,
        "line_feed": 1,
        "line_max_width": 0.82,
        "line_spacing": 0.02,
        "lyric_group_id": "",
        "lyrics_template": {
            "category_id": "", "category_name": "", "effect_id": "",
            "panel": "", "path": "", "request_id": "", "resource_id": "", "resource_name": "",
        },
        "multi_language_current": "none",
        "name": "",
        "offset_on_path": 0.0,
        "oneline_cutoff": False,
        "operation_type": 0,
        "original_size": [],
        "preset_category": "",
        "preset_category_id": "",
        "preset_has_set_alignment": False,
        "preset_id": "",
        "preset_index": 0,
        "preset_name": "",
        "punc_model": "",
        "recognize_model": "",
        "recognize_task_id": "",
        "recognize_text": "",
        "recognize_type": 0,
        "relevance_segment": [],
        "shadow_alpha": 0.9,
        "shadow_angle": -45.0,
        "shadow_color": "",
        "shadow_distance": 5.0,
        "shadow_point": {"x": 0.6363961030678928, "y": -0.6363961030678928},
        "shadow_smoothing": 0.45,
        "shadow_thickness_projection_angle": 0.0,
        "shadow_thickness_projection_distance": 0.0,
        "shadow_thickness_projection_enable": False,
        "shape_clip_x": False,
        "shape_clip_y": False,
        "single_char_bg_alpha": 1.0,
        "single_char_bg_color": "",
        "single_char_bg_enable": False,
        "single_char_bg_height": 0.0,
        "single_char_bg_horizontal_offset": 0.0,
        "single_char_bg_round_radius": 0.3,
        "single_char_bg_vertical_offset": 0.0,
        "single_char_bg_width": 0.0,
        "source_from": "",
        "ssml_content": "",
        "style_name": "",
        "sub_template_id": -1,
        "sub_type": 0,
        "subtitle_keywords": None,
        "subtitle_keywords_config": None,
        "subtitle_template_original_fontsize": 0.0,
        "text_alpha": 1.0,
        "text_color": "#FFFFFF",
        "text_curve": None,
        "text_exceeds_path_process_type": 0,
        "text_loop_on_path": False,
        "text_preset_resource_id": "",
        "text_size": 30,
        "text_to_audio_ids": [],
        "text_typesetting_path_index": 0,
        "text_typesetting_paths": None,
        "text_typesetting_paths_file": "",
        "translate_original_text": "",
        "tts_auto_update": False,
        "type": "subtitle",
        "typesetting": 0,
        "underline": False,
        "underline_offset": 0.22,
        "underline_width": 0.05,
        "use_effect_default_color": True,
        "words": {"end_time": [], "start_time": [], "text": []},
    }


def _build_text_track_segment(material_id: str, start_us: int, duration_us: int, render_index: int) -> dict:
    """Táº¡o 1 segment trÃªn text track cho subtitle."""
    return {
        "caption_info": None,
        "cartoon": False,
        "clip": {
            "alpha": 1.0,
            "flip": {"horizontal": False, "vertical": False},
            "rotation": 0.0,
            "scale": {"x": 1.0, "y": 1.0},
            "transform": {"x": 0.0, "y": -0.8},  # vá»‹ trÃ­ subtitle phÃ­a dÆ°á»›i
        },
        "color_correct_alg_result": "",
        "common_keyframes": [],
        "desc": "",
        "digital_human_template_group_id": "",
        "enable_adjust": False,
        "enable_adjust_mask": False,
        "enable_color_adjust_pro": False,
        "enable_color_correct_adjust": False,
        "enable_color_curves": True,
        "enable_color_match_adjust": False,
        "enable_color_wheels": True,
        "enable_hsl": False,
        "enable_hsl_curves": True,
        "enable_lut": False,
        "enable_mask_shadow": False,
        "enable_mask_stroke": False,
        "enable_smart_color_adjust": False,
        "enable_video_mask": True,
        "extra_material_refs": [],
        "group_id": "",
        "hdr_settings": None,
        "id": _new_uuid(),
        "intensifies_audio": False,
        "is_loop": False,
        "is_placeholder": False,
        "is_tone_modify": False,
        "keyframe_refs": [],
        "last_nonzero_volume": 1.0,
        "lyric_keyframes": None,
        "material_id": material_id,
        "raw_segment_id": "",
        "render_index": render_index,
        "render_timerange": {"duration": 0, "start": 0},
        "responsive_layout": {
            "enable": False, "horizontal_pos_layout": 0,
            "size_layout": 0, "target_follow": "", "vertical_pos_layout": 0,
        },
        "reverse": False,
        "source": "segmentsourcenormal",
        "source_timerange": None,
        "speed": 1.0,
        "state": 0,
        "target_timerange": {"duration": duration_us, "start": start_us},
        "template_id": "",
        "template_scene": "default",
        "track_attribute": 0,
        "track_render_index": 1,
        "uniform_scale": {"on": True, "value": 1.0},
        "visible": True,
        "volume": 1.0,
    }


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Main export function
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def export_to_capcut(
    project_name: str,
    video_path: str | None,
    segments: list[dict],
    dub_audio_path: str | None = None,
) -> dict:
    """
    Táº¡o CapCut draft má»›i tá»« káº¿t quáº£ OCR.

    Args:
        project_name: TÃªn dá»± Ã¡n
        video_path: ÄÆ°á»ng dáº«n tuyá»‡t Ä‘á»‘i file video gá»‘c
        segments: [{start_sec, end_sec, translated_text}]
        dub_audio_path: (optional) Ä‘Æ°á»ng dáº«n file audio dub

    Returns:
        dict vá»›i draft_folder, draft_name, success, message
    """
    capcut_root = _get_capcut_root()
    if not capcut_root:
        return {"success": False, "message": "KhÃ´ng tÃ¬m tháº¥y thÆ° má»¥c CapCut trÃªn mÃ¡y nÃ y."}

    font_path = _detect_capcut_font()

    now_us = int(time.time() * 1_000_000)
    now_s  = int(time.time())
    draft_id = _new_uuid()
    timeline_uuid = _new_uuid()
    timelines_project_id = _new_uuid()
    safe_name = project_name.strip() or "Solar OCR Export"

    # Tao thu muc draft truoc theo cach atomic de tranh dung ten khi co request dong thoi.
    draft_folder = _create_unique_draft_folder(capcut_root, safe_name)
    final_name = draft_folder.name

    reference_draft = _get_bundled_reference_draft()
    if reference_draft is None:
        reference_draft = _pick_reference_draft(capcut_root, exclude_names={final_name})
    if reference_draft:
        try:
            return _export_to_capcut_from_reference(
                capcut_root=capcut_root,
                reference_draft=reference_draft,
                draft_folder=draft_folder,
                draft_name=final_name,
                video_path=video_path,
                segments=segments,
                font_path=font_path,
                dub_audio_path=dub_audio_path,
            )
        except Exception:
            logger.warning("Clone draft tham chieu that bai, fallback ve exporter cu", exc_info=True)

    # â”€â”€ Materials â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # Video material
    video_mat_id   = _new_uuid()
    speed_mat_id   = _new_uuid()
    canvas_mat_id  = _new_uuid()
    placeholder_id = _new_uuid()
    sound_ch_id    = _new_uuid()
    vocal_sep_id   = _new_uuid()
    color_mat_id   = _new_uuid()
    video_segment_library_id = _new_uuid()
    meta_placeholder_id = str(uuid.uuid4()).lower()
    meta_video_id = str(uuid.uuid4()).lower()
    video_library_material_id = uuid.uuid4().hex

    video_path_fwd = str(video_path).replace("\\", "/") if video_path else ""
    video_name     = Path(video_path).name if video_path else "source.mp4"
    video_info = _probe_video_metadata(video_path)
    video_width = int(video_info["width"])
    video_height = int(video_info["height"])
    video_fps = float(video_info["fps"])

    # TÃ­nh duration video (microseconds)
    total_end_sec = max((s.get("end_sec", 0) for s in segments), default=0) if segments else 0
    video_duration_us = (
        int(video_info["duration_us"])
        or _sec_to_us(total_end_sec)
        or 30_000_000
    )

    video_material = {
        "aigc_history_id": "", "aigc_item_id": "", "aigc_type": "none",
        "audio_fade": None,
        "category_id": "", "category_name": "local",
        "check_flag": 62978047,
        "content_feature_info": None, "corner_pin": None,
        "crop": {
            "lower_left_x": 0.0, "lower_left_y": 1.0,
            "lower_right_x": 1.0, "lower_right_y": 1.0,
            "upper_left_x": 0.0, "upper_left_y": 0.0,
            "upper_right_x": 1.0, "upper_right_y": 0.0,
        },
        "crop_ratio": "free", "crop_scale": 1.0,
        "duration": video_duration_us,
        "extra_type_option": 0, "formula_id": "", "freeze": None,
        "has_audio": True, "has_sound_separated": False,
        "height": video_height,
        "id": video_mat_id,
        "intensifies_audio_path": "", "intensifies_path": "",
        "is_ai_generate_content": False, "is_copyright": False,
        "is_text_edit_overdub": False, "is_unified_beauty_mode": False,
        "live_photo_cover_path": "", "live_photo_timestamp": -1,
        "local_id": "", "local_material_from": "",
        "local_material_id": meta_video_id,
        "material_id": "", "material_name": video_name, "material_url": "",
        "matting": {
            "custom_matting_id": "", "enable_matting_stroke": False,
            "expansion": 0, "feather": 0, "flag": 0,
            "has_use_quick_brush": False, "has_use_quick_eraser": False,
            "interactiveTime": [], "path": "", "reverse": False, "strokes": [],
        },
        "media_path": "", "multi_camera_info": None, "object_locked": None,
        "origin_material_id": "",
        "path": video_path_fwd,
        "picture_from": "none", "picture_set_category_id": "", "picture_set_category_name": "",
        "request_id": "", "reverse_intensifies_path": "", "reverse_path": "",
        "smart_match_info": None, "smart_motion": None, "source": 0, "source_platform": 0,
        "stable": {"matrix_path": "", "stable_level": 0, "time_range": {"duration": 0, "start": 0}},
        "surface_trackings": [], "team_id": "",
        "type": "video", "unique_id": "",
        "video_algorithm": {
            "ai_background_configs": [], "ai_expression_driven": None,
            "ai_in_painting_config": [], "ai_motion_driven": None,
            "aigc_generate": None, "aigc_generate_list": [], "algorithms": [],
            "complement_frame_config": None, "deflicker": None, "gameplay_configs": [],
            "image_interpretation": None, "motion_blur_config": None, "mouth_shape_driver": None,
            "noise_reduction": None, "path": "", "quality_enhance": None,
            "skip_algorithm_index": [], "smart_complement_frame": None,
            "story_video_modify_video_config": {
                "is_overwrite_last_video": False, "task_id": "", "tracker_task_id": "",
            },
            "super_resolution": None, "time_range": None,
        },
        "video_mask_shadow": {
            "alpha": 0.0, "angle": 0.0, "blur": 0.0,
            "color": "", "distance": 0.0, "path": "", "resource_id": "",
        },
        "video_mask_stroke": {
            "alpha": 0.0, "color": "", "distance": 0.0,
            "horizontal_shift": 0.0, "path": "", "resource_id": "",
            "size": 0.0, "texture": 0.0, "type": "", "vertical_shift": 0.0,
        },
        "width": video_width,
    }

    # Audio dub material (náº¿u cÃ³)
    audio_mat_id = None
    audio_material = None
    if dub_audio_path and Path(dub_audio_path).exists():
        audio_mat_id = _new_uuid()
        dub_path_fwd = str(dub_audio_path).replace("\\", "/")
        dub_name = Path(dub_audio_path).name
        audio_material = {
            "app_id": 0, "category_id": "", "category_name": "",
            "check_flag": 1, "duration": video_duration_us,
            "effect_id": "", "formula_id": "", "id": audio_mat_id,
            "intensifies_path": "", "local_material_id": _new_uuid(),
            "material_id": "", "material_name": dub_name, "material_url": "",
            "music_id": "", "name": dub_name,
            "path": dub_path_fwd,
            "query": "", "request_id": "", "resource_id": "",
            "search_id": "", "source_platform": 0, "team_id": "",
            "text_id": "", "tone_folder_name": "", "type": "extract_music",
            "wave_points": [],
        }

    # â”€â”€ Subtitle materials (texts[]) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    text_materials: list[dict] = []
    valid_text_segments: list[dict] = []
    for seg in segments:
        text = (seg.get("translated_text") or seg.get("raw_text") or "").strip()
        if not text:
            continue
        mat = _build_text_material(text, font_path)
        text_materials.append(mat)
        valid_text_segments.append(seg)

    # animation stubs (1 per text material)
    anim_ids_from_segs: list[str] = []
    material_animations = []
    for mat in text_materials:
        # TÃ¡ch _anim_id (field táº¡m) khá»i material
        anim_id = mat.pop("_anim_id", _new_uuid())
        anim_ids_from_segs.append(anim_id)
        material_animations.append({
            "animations": [],
            "id": anim_id,
            "multi_language_current": "none",
            "type": "sticker_animation",
        })

    # â”€â”€ Video track segment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    video_seg_refs = [speed_mat_id, placeholder_id, canvas_mat_id, sound_ch_id, color_mat_id, vocal_sep_id]
    video_track_segment = {
        "caption_info": None, "cartoon": False,
        "clip": {
            "alpha": 1.0,
            "flip": {"horizontal": False, "vertical": False},
            "rotation": 0.0,
            "scale": {"x": 1.0, "y": 1.0},
            "transform": {"x": 0.0, "y": 0.0},
        },
        "color_correct_alg_result": "",
        "common_keyframes": [],
        "desc": "", "digital_human_template_group_id": "",
        "enable_adjust": True, "enable_adjust_mask": False,
        "enable_color_adjust_pro": False, "enable_color_correct_adjust": False,
        "enable_color_curves": True, "enable_color_match_adjust": False,
        "enable_color_wheels": True, "enable_hsl": False, "enable_hsl_curves": True,
        "enable_lut": True, "enable_mask_shadow": False, "enable_mask_stroke": False,
        "enable_smart_color_adjust": False, "enable_video_mask": True,
        "extra_material_refs": video_seg_refs,
        "group_id": "", "hdr_settings": {"intensity": 1.0, "mode": 1, "nits": 1000},
        "id": video_segment_library_id,
        "intensifies_audio": False, "is_loop": False,
        "is_placeholder": False, "is_tone_modify": False,
        "keyframe_refs": [], "last_nonzero_volume": 1.0,
        "lyric_keyframes": None,
        "material_id": video_mat_id,
        "raw_segment_id": "", "render_index": 0,
        "render_timerange": {"duration": 0, "start": 0},
        "responsive_layout": {
            "enable": False, "horizontal_pos_layout": 0,
            "size_layout": 0, "target_follow": "", "vertical_pos_layout": 0,
        },
        "reverse": False,
        "source": "segmentsourcenormal",
        "source_timerange": {"duration": video_duration_us, "start": 0},
        "speed": 1.0, "state": 0,
        "target_timerange": {"duration": video_duration_us, "start": 0},
        "template_id": "", "template_scene": "default",
        "track_attribute": 0, "track_render_index": 0,
        "uniform_scale": {"on": True, "value": 1.0},
        "visible": True, "volume": 1.0,
    }

    # â”€â”€ Text track segments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    text_track_segments = []
    seg_idx = 0
    for i, (mat, seg) in enumerate(zip(text_materials, valid_text_segments)):
        start_us    = _sec_to_us(seg.get("start_sec", 0))
        end_us      = _sec_to_us(seg.get("end_sec", 0))
        if i + 1 < len(valid_text_segments):
            next_start_us = _sec_to_us(valid_text_segments[i + 1].get("start_sec", 0))
            if next_start_us > start_us:
                end_us = min(end_us, next_start_us)
        duration_us = max(1, end_us - start_us)
        ts = _build_text_track_segment(mat["id"], start_us, duration_us, 14000 + i)
        # GÃ¡n _anim_id Ä‘Ãºng
        ts["extra_material_refs"] = [anim_ids_from_segs[i]]
        text_track_segments.append(ts)

    # â”€â”€ Audio track segment (náº¿u cÃ³ dub) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    audio_track = None
    if audio_mat_id and audio_material:
        audio_seg_id = _new_uuid()
        audio_track = {
            "attribute": 0, "flag": 0,
            "id": _new_uuid(),
            "is_default_name": True, "name": "",
            "segments": [{
                "caption_info": None, "cartoon": False,
                "clip": {
                    "alpha": 1.0,
                    "flip": {"horizontal": False, "vertical": False},
                    "rotation": 0.0,
                    "scale": {"x": 1.0, "y": 1.0},
                    "transform": {"x": 0.0, "y": 0.0},
                },
                "common_keyframes": [],
                "desc": "", "digital_human_template_group_id": "",
                "enable_adjust": False, "enable_adjust_mask": False,
                "enable_color_adjust_pro": False, "enable_color_correct_adjust": False,
                "enable_color_curves": True, "enable_color_match_adjust": False,
                "enable_color_wheels": True, "enable_hsl": False, "enable_hsl_curves": True,
                "enable_lut": False, "enable_mask_shadow": False, "enable_mask_stroke": False,
                "enable_smart_color_adjust": False, "enable_video_mask": False,
                "extra_material_refs": [],
                "group_id": "", "hdr_settings": None,
                "id": audio_seg_id,
                "intensifies_audio": False, "is_loop": False,
                "is_placeholder": False, "is_tone_modify": False,
                "keyframe_refs": [], "last_nonzero_volume": 1.0,
                "lyric_keyframes": None,
                "material_id": audio_mat_id,
                "raw_segment_id": "", "render_index": 20000,
                "render_timerange": {"duration": 0, "start": 0},
                "responsive_layout": {
                    "enable": False, "horizontal_pos_layout": 0,
                    "size_layout": 0, "target_follow": "", "vertical_pos_layout": 0,
                },
                "reverse": False,
                "source": "segmentsourcenormal",
                "source_timerange": {"duration": video_duration_us, "start": 0},
                "speed": 1.0, "state": 0,
                "target_timerange": {"duration": video_duration_us, "start": 0},
                "template_id": "", "template_scene": "default",
                "track_attribute": 0, "track_render_index": 0,
                "uniform_scale": {"on": True, "value": 1.0},
                "visible": True, "volume": 1.0,
            }],
            "type": "audio",
        }

    # â”€â”€ Assemble draft_content.json â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    tracks = [
        # Track 0: video chÃ­nh
        {
            "attribute": 0, "flag": 0,
            "id": _new_uuid(),
            "is_default_name": True, "name": "",
            "segments": [video_track_segment],
            "type": "video",
        },
        # Track 1: subtitle
        {
            "attribute": 0, "flag": 1,
            "id": _new_uuid(),
            "is_default_name": True, "name": "",
            "segments": text_track_segments,
            "type": "text",
        },
    ]
    if audio_track:
        tracks.append(audio_track)

    draft_content = {
        "canvas_config": {
            "background": None,
            "height": video_height,
            "ratio": "original",
            "width": video_width,
        },
        "color_space": 0,
        "config": {
            "adjust_max_index": 1, "attachment_info": [],
            "combination_max_index": 1, "export_range": None,
            "extract_audio_last_index": 1, "lyrics_recognition_id": "",
            "lyrics_sync": True, "lyrics_taskinfo": [],
            "maintrack_adsorb": True, "material_save_mode": 0,
            "multi_language_current": "none", "multi_language_list": [],
            "multi_language_main": "none", "multi_language_mode": "none",
            "original_sound_last_index": 1, "record_audio_last_index": 1,
            "sticker_max_index": 1, "subtitle_keywords_config": None,
            "subtitle_recognition_id": "", "subtitle_sync": True,
            "subtitle_taskinfo": [], "system_font_list": [],
            "use_float_render": False, "video_mute": False,
            "voice_change_sync": False, "zoom_info_params": None,
        },
        "cover": None,
        "create_time": 0,
        "draft_type": "video",
        "duration": video_duration_us,
        "extra_info": None,
        "fps": video_fps,
        "free_render_index_mode_on": False,
        "id": timeline_uuid,
        "is_drop_frame_timecode": False,
        "keyframe_graph_list": [],
        "keyframes": {
            "adjusts": [], "audios": [], "effects": [],
            "filters": [], "handwrites": [], "stickers": [],
            "texts": [], "videos": [],
        },
        "function_assistant_info": {
            "audio_noise_segid_list": [],
            "auto_adjust": False,
            "auto_adjust_fixed": False,
            "auto_adjust_fixed_value": 50.0,
            "auto_adjust_segid_list": [],
            "auto_caption": False,
            "auto_caption_segid_list": [],
            "auto_caption_template_id": "",
            "caption_opt": False,
            "caption_opt_segid_list": [],
            "color_correction": False,
            "color_correction_fixed": False,
            "color_correction_fixed_value": 50.0,
            "color_correction_segid_list": [],
            "deflicker_segid_list": [],
            "enhance_quality": False,
            "enhance_quality_fixed": False,
            "enhance_quality_segid_list": [],
            "enhance_voice_segid_list": [],
            "enhande_voice": False,
            "enhande_voice_fixed": False,
            "eye_correction": False,
            "eye_correction_segid_list": [],
            "fixed_rec_applied": False,
            "fps": {"den": 1, "num": int(round(video_fps))},
            "normalize_loudness": False,
            "normalize_loudness_audio_denoise_segid_list": [],
            "normalize_loudness_fixed": False,
            "normalize_loudness_segid_list": [],
            "retouch": False,
            "retouch_fixed": False,
            "retouch_segid_list": [],
            "smart_rec_applied": False,
            "smart_segid_list": [],
            "smooth_slow_motion": False,
            "smooth_slow_motion_fixed": False,
            "video_noise_segid_list": [],
        },
        "group_container": None,
        "lyrics_effects": [],
        "smart_ads_info": {"draft_url": "", "page_from": "", "routine": ""},
        "last_modified_platform": {
            "app_id": 359289,
            "app_source": "cc",
            "app_version": "8.4.0",
            "device_id": "",
            "hard_disk_id": "",
            "mac_address": "",
            "os": "windows",
            "os_version": "10.0.19045",
        },
        "materials": {
            "ai_translates": [], "audio_balances": [], "audio_effects": [],
            "audio_fades": [], "audio_pannings": [], "audio_pitch_shifts": [],
            "audio_track_indexes": [],
            "audios": [audio_material] if audio_material else [],
            "beats": [],
            "canvases": [{
                "album_image": "", "blur": 0.0, "color": "", "id": canvas_mat_id,
                "image": "", "image_id": "", "image_name": "", "source_platform": 0,
                "team_id": "", "type": "canvas_color",
            }],
            "chromas": [], "color_curves": [], "common_mask": [],
            "digital_human_model_dressing": [], "digital_humans": [],
            "drafts": [], "effects": [], "flowers": [], "green_screens": [],
            "handwrites": [], "hsl": [], "hsl_curves": [], "images": [],
            "log_color_wheels": [], "loudnesses": [],
            "manual_beautys": [], "manual_deformations": [],
            "material_animations": material_animations,
            "material_colors": [{
                "gradient_angle": 90.0, "gradient_colors": [], "gradient_percents": [],
                "height": 0.0, "id": color_mat_id, "is_color_clip": False,
                "is_gradient": False, "solid_color": "", "width": 0.0,
            }],
            "multi_language_refs": [],
            "placeholder_infos": [{
                "error_path": "", "error_text": "", "id": placeholder_id,
                "meta_type": "none", "res_path": "", "res_text": "",
                "type": "placeholder_info",
            }],
            "placeholders": [], "plugin_effects": [], "primary_color_wheels": [],
            "realtime_denoises": [], "shapes": [], "smart_crops": [],
            "smart_relights": [],
            "sound_channel_mappings": [{
                "audio_channel_mapping": 0, "id": sound_ch_id,
                "is_config_open": False, "type": "",
            }],
            "speeds": [{
                "curve_speed": None, "id": speed_mat_id,
                "mode": 0, "speed": 1.0, "type": "speed",
            }],
            "stickers": [], "tail_leaders": [], "text_templates": [],
            "texts": text_materials,
            "time_marks": [], "transitions": [],
            "video_effects": [], "video_radius": [], "video_shadows": [],
            "video_strokes": [], "video_trackings": [],
            "videos": [video_material],
            "vocal_beautifys": [],
            "vocal_separations": [{
                "choice": 0, "enter_from": "", "final_algorithm": "",
                "id": vocal_sep_id, "production_path": "",
                "removed_sounds": [], "time_range": None,
                "type": "vocal_separation",
            }],
        },
        "mutable_config": None,
        "name": "",
        "new_version": "165.0.0",
        "path": "",
        "platform": {
            "app_id": 359289, "app_source": "cc", "app_version": "8.4.0",
            "device_id": "", "hard_disk_id": "", "mac_address": "",
            "os": "windows", "os_version": "10.0.19045",
        },
        "relationships": [],
        "render_index_track_mode_on": True,
        "retouch_cover": None,
        "source": "default",
        "static_cover_image_path": "",
        "time_marks": None,
        "tracks": tracks,
        "uneven_animation_template_info": {"composition": "", "content": "", "order": "", "sub_template_info_list": []},
        "update_time": 0,
        "version": 360000,
    }

    # Ghi draft_content.json
    content_path = draft_folder / "draft_content.json"
    content_bytes = json.dumps(draft_content, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    content_path.write_bytes(content_bytes)
    content_size = len(content_bytes)  # dÃ¹ng Ä‘á»ƒ gÃ¡n draft_timeline_materials_size
    # Backup
    shutil.copy2(content_path, draft_folder / "draft_content.json.bak")
    shutil.copy2(content_path, draft_folder / "template-2.tmp")

    # â”€â”€ draft_meta_info.json â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    materials_list = []
    # Type 0: video
    video_mat_entry: list = []
    if video_path:
        video_mat_entry = [{
            "ai_group_type": "", "create_time": now_s,
            "duration": 33333,
            "enter_from": 0, "extra_info": "",
            "file_Path": "",
            "height": 0,
            "id": meta_placeholder_id,
            "import_time": now_s, "import_time_ms": now_us,
            "item_source": 1, "md5": "",
            "metetype": "none",
            "roughcut_time_range": {"duration": 33333, "start": 0},
            "sub_time_range": {"duration": -1, "start": -1},
            "type": 0, "width": 0,
        }, {
            "ai_group_type": "", "create_time": now_s,
            "duration": video_duration_us,
            "enter_from": 0, "extra_info": video_name,
            "file_Path": video_path_fwd,
            "height": video_height,
            "id": meta_video_id,
            "import_time": now_s, "import_time_ms": now_us,
            "item_source": 1, "md5": "",
            "metetype": "video",
            "roughcut_time_range": {"duration": video_duration_us, "start": 0},
            "sub_time_range": {"duration": -1, "start": -1},
            "type": 0, "width": video_width,
        }]
    materials_list.append({"type": 0, "value": video_mat_entry})
    materials_list.append({"type": 1, "value": []})
    materials_list.append({"type": 2, "value": []})  # subtitle files
    materials_list.append({"type": 3, "value": []})
    materials_list.append({"type": 6, "value": []})
    materials_list.append({"type": 7, "value": []})
    materials_list.append({"type": 8, "value": []})

    draft_meta = {
        "cloud_draft_cover": False,
        "cloud_draft_sync": False,
        "cloud_package_completed_time": "",
        "draft_cloud_capcut_purchase_info": "",
        "draft_cloud_last_action_download": False,
        "draft_cloud_package_type": "",
        "draft_cloud_purchase_info": "",
        "draft_cloud_template_id": "",
        "draft_cloud_tutorial_info": "",
        "draft_cloud_videocut_purchase_info": "",
        "draft_cover": "draft_cover.jpg",
        "draft_deeplink_url": "",
        "draft_enterprise_info": {
            "draft_enterprise_extra": "",
            "draft_enterprise_id": "",
            "draft_enterprise_name": "",
            "enterprise_material": [],
        },
        "draft_fold_path": str(draft_folder).replace("\\", "/"),
        "draft_id": draft_id,
        "draft_is_ae_produce": False,
        "draft_is_ai_packaging_used": False,
        "draft_is_ai_shorts": False,
        "draft_is_ai_translate": False,
        "draft_is_article_video_draft": False,
        "draft_is_cloud_temp_draft": False,
        "draft_is_from_deeplink": "false",
        "draft_is_invisible": False,
        "draft_is_web_article_video": False,
        "draft_materials": materials_list,
        "draft_materials_copied_info": [],
        "draft_name": final_name,
        "draft_need_rename_folder": False,
        "draft_new_version": "",
        "draft_removable_storage_device": "",
        "draft_root_path": str(capcut_root).replace("/", "\\"),
        "draft_segment_extra_info": [],
        "draft_timeline_materials_size_": content_size,
        "draft_type": "",
        "draft_web_article_video_enter_from": "",
        "tm_draft_cloud_completed": "",
        "tm_draft_cloud_entry_id": -1,
        "tm_draft_cloud_modified": 0,
        "tm_draft_cloud_parent_entry_id": -1,
        "tm_draft_cloud_space_id": -1,
        "tm_draft_cloud_user_id": -1,
        "tm_draft_create": now_us,
        "tm_draft_modified": now_us,
        "tm_draft_removed": 0,
        "tm_duration": video_duration_us,
    }
    meta_path = draft_folder / "draft_meta_info.json"
    meta_path.write_bytes(json.dumps(draft_meta, ensure_ascii=False).encode("utf-8"))


    # Táº¡o cÃ¡c file phá»¥ cáº§n thiáº¿t Ä‘á»ƒ CapCut nháº­n --- khá»›p chÃ­nh xÃ¡c format 0416
    draft_folder_fwd  = str(draft_folder).replace("\\", "/")
    capcut_root_back  = str(capcut_root).replace("/", "\\")

    # draft_settings â€” format INI (khÃ´ng pháº£i JSON)
    (draft_folder / "draft_settings").write_text(
        f"[General]\ndraft_create_time={now_s}\ndraft_last_edit_time={now_s}\nreal_edit_seconds=0\nreal_edit_keys=0\n",
        encoding="utf-8",
    )

    # draft_agency_config.json â€” khá»›p fields cá»§a 0416
    (draft_folder / "draft_agency_config.json").write_bytes(
        json.dumps({
            "is_auto_agency_enabled": False,
            "is_auto_agency_popup": False,
            "is_single_agency_mode": False,
            "marterials": None,
            "use_converter": False,
            "video_resolution": 720,
        }, ensure_ascii=False).encode("utf-8")
    )

    # attachment_pc_common.json â€” Báº®T BUá»˜C, bá»‹ thiáº¿u trÆ°á»›c Ä‘Ã¢y
    (draft_folder / "attachment_pc_common.json").write_bytes(
        json.dumps({
            "ai_packaging_infos": [],
            "ai_packaging_report_info": {
                "caption_id_list": [], "commercial_material": "", "material_source": "",
                "method": "", "page_from": "", "style": "", "task_id": "",
                "text_style": "", "tos_id": "", "video_category": "",
            },
            "broll": {
                "ai_packaging_infos": [],
                "ai_packaging_report_info": {
                    "caption_id_list": [], "commercial_material": "", "material_source": "",
                    "method": "", "page_from": "", "style": "", "task_id": "",
                    "text_style": "", "tos_id": "", "video_category": "",
                },
            },
            "commercial_music_category_ids": [],
            "pc_feature_flag": 0,
            "recognize_tasks": [],
            "reference_lines_config": {
                "horizontal_lines": [], "is_lock": False,
                "is_visible": False, "vertical_lines": [],
            },
            "safe_area_type": 0,
            "template_item_infos": [],
            "unlock_template_ids": [],
        }, ensure_ascii=False).encode("utf-8")
    )

    # timeline_layout.json â€” Ä‘Ãºng format cá»§a 0416
    (draft_folder / "timeline_layout.json").write_bytes(
        json.dumps({
            "dockItems": [{
                "dockIndex": 0,
                "ratio": 1,
                "timelineIds": [timeline_uuid],
                "timelineNames": ["Timeline 01"],
            }],
            "layoutOrientation": 1,
        }, ensure_ascii=False).encode("utf-8")
    )

    # draft_virtual_store.json
    (draft_folder / "draft_virtual_store.json").write_bytes(
        json.dumps({
            "draft_materials": [],
            "draft_virtual_store": [
                {"type": 0, "value": [{
                    "creation_time": 0,
                    "display_name": "",
                    "filter_type": 0,
                    "id": "",
                    "import_time": 0,
                    "import_time_us": 0,
                    "sort_sub_type": 0,
                    "sort_type": 0,
                    "subdraft_filter_type": 0,
                }]},
                {"type": 1, "value": [
                    {"child_id": meta_placeholder_id, "parent_id": ""},
                    {"child_id": meta_video_id, "parent_id": ""},
                ]},
                {"type": 2, "value": []},
            ],
        }, ensure_ascii=False).encode("utf-8")
    )

    # key_value.json
    (draft_folder / "key_value.json").write_bytes(
        json.dumps({
            video_segment_library_id: {
                "filter_category": "",
                "filter_detail": "",
                "is_brand": 0,
                "is_from_artist_shop": 0,
                "is_vip": "0",
                "keywordSource": "",
                "materialCategory": "media",
                "materialId": video_library_material_id,
                "materialName": video_name,
                "materialSubcategory": "local",
                "materialSubcategoryId": "",
                "materialThirdcategory": "Import",
                "materialThirdcategoryId": "",
                "material_copyright": "",
                "material_is_purchased": "",
                "rank": "0",
                "rec_id": "",
                "requestId": "",
                "role": "",
                "searchId": "",
                "searchKeyword": "",
                "segmentId": video_segment_library_id,
                "team_id": "",
                "textTemplateVersion": "",
            },
            video_library_material_id: {
                "Tiktok_music_is_avaliable": False,
                "add_to_timeline_before_download": False,
                "commerce_template_cate": "",
                "commerce_template_pay_status": "",
                "commerce_template_pay_type": "",
                "enter_from": "",
                "filter_category": "",
                "filter_detail": "",
                "is_brand": 0,
                "is_favorite": False,
                "is_from_artist_shop": 0,
                "is_limited": False,
                "is_similar_music": False,
                "is_vip": "0",
                "keywordSource": "",
                "materialCategory": "media",
                "materialId": video_library_material_id,
                "materialName": video_name,
                "materialSubcategory": "local",
                "materialSubcategoryId": "",
                "materialThirdcategory": "Import",
                "materialThirdcategoryId": "",
                "material_copyright": "",
                "material_is_purchased": "",
                "music_source": "",
                "original_song_id": "",
                "original_song_name": "",
                "pgc_id": "",
                "pgc_name": "",
                "previewed": 0,
                "previewed_before_added": 0,
                "rank": "0",
                "rec_id": "",
                "requestId": "",
                "right_block_type": "",
                "right_count_type": "",
                "right_is_trial": "",
                "right_oneoff_mix_type": "",
                "right_trial_limit_left": "",
                "right_trial_mode": "",
                "right_trial_type": "",
                "role": "",
                "searchId": "",
                "searchKeyword": "",
                "special_effect_loading_type": "",
                "team_id": "",
                "template_author_id": "",
                "template_drafts_price": 0,
                "template_duration": 0,
                "template_fragment_cnt": 0,
                "template_need_purcahse": True,
                "template_pay_type": "",
                "template_type": "",
                "template_use_cnt": 0,
                "textTemplateVersion": "",
            },
        }, ensure_ascii=False).encode("utf-8")
    )

    # performance_opt_info.json
    (draft_folder / "performance_opt_info.json").write_bytes(
        json.dumps({"manual_cancle_precombine_segs": None, "need_auto_precombine_segs": None}, ensure_ascii=False).encode("utf-8")
    )

    # draft_biz_config.json â€” luÃ´n rá»—ng
    (draft_folder / "draft_biz_config.json").write_bytes(b"")

    # CÃ¡c thÆ° má»¥c cáº§n thiáº¿t (nhÆ° 0416)
    for sub in ("Timelines", "adjust_mask", "common_attachment",
                "matting", "qr_upload", "Resources", "smart_crop", "subdraft"):
        (draft_folder / sub).mkdir(exist_ok=True)

    # â”€â”€ Timelines structure (format CapCut má»›i) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # CapCut má»›i cáº§n: Timelines/project.json, Timelines/<timeline_id>/draft_content.json
    now_us_int = int(time.time() * 1_000_000)

    # Timelines/project.json
    timelines_project = {
        "config": {
            "color_space": -1,
            "render_index_track_mode_on": False,
            "use_float_render": False,
        },
        "create_time": now_us_int,
        "id": timelines_project_id,
        "main_timeline_id": timeline_uuid,
        "timelines": [{
            "create_time": now_us_int,
            "id": timeline_uuid,
            "is_marked_delete": False,
            "name": "Timeline 01",
            "update_time": now_us_int,
        }],
        "update_time": now_us_int,
        "version": 0,
    }
    timelines_dir = draft_folder / "Timelines"
    timelines_dir_json = timelines_dir / "project.json"
    timelines_dir_json.write_bytes(json.dumps(timelines_project, ensure_ascii=False).encode("utf-8"))
    shutil.copy2(timelines_dir_json, timelines_dir / "project.json.bak")

    # Timelines/<timeline_uuid>/ â€” thÆ° má»¥c timeline con
    tl_sub_dir = timelines_dir / timeline_uuid
    tl_sub_dir.mkdir(exist_ok=True)
    (tl_sub_dir / "common_attachment").mkdir(exist_ok=True)

    # Timelines/<uuid>/draft_content.json â€” copy tá»« root draft_content
    shutil.copy2(content_path, tl_sub_dir / "draft_content.json")
    shutil.copy2(content_path, tl_sub_dir / "draft_content.json.bak")
    shutil.copy2(content_path, tl_sub_dir / "template-2.tmp")

    # attachment_pc_timeline.json (cÃ¹ng ná»™i dung vá»›i attachment_pc_common.json)
    attach_content = (draft_folder / "attachment_pc_common.json").read_bytes()
    (tl_sub_dir / "common_attachment" / "attachment_pc_timeline.json").write_bytes(attach_content)
    (draft_folder / "common_attachment" / "attachment_pc_timeline.json").write_bytes(attach_content)
    (tl_sub_dir / "attachment_pc_common.json").write_bytes(attach_content)

    (tl_sub_dir / "attachment_editing.json").write_bytes(
        json.dumps({
            "editing_draft": {
                "ai_remove_filter_words": {"enter_source": "", "right_id": ""},
                "ai_shorts_info": {"report_params": "", "type": 0},
                "crop_info_extra": {
                    "crop_mirror_type": 0,
                    "crop_rotate": 0.0,
                    "crop_rotate_total": 0.0,
                },
                "digital_human_template_to_video_info": {
                    "has_upload_material": False,
                    "template_type": 0,
                },
                "draft_used_recommend_function": "",
                "edit_type": 0,
                "eye_correct_enabled_multi_face_time": 0,
                "has_adjusted_render_layer": False,
                "image_ai_chat_info": {
                    "before_chat_edit": False,
                    "draft_modify_time": 0,
                    "message_id": "",
                    "model_name": "",
                    "need_restore": False,
                    "picture_id": "",
                    "prompt_from": "",
                    "sugs_info": [],
                },
                "is_open_expand_player": False,
                "is_template_text_ai_generate": False,
                "is_use_adjust": False,
                "is_use_ai_expand": False,
                "is_use_ai_remove": False,
                "is_use_ai_video": False,
                "is_use_audio_separation": False,
                "is_use_chroma_key": False,
                "is_use_curve_speed": False,
                "is_use_digital_human": False,
                "is_use_edit_multi_camera": False,
                "is_use_lip_sync": False,
                "is_use_lock_object": False,
                "is_use_loudness_unify": False,
                "is_use_noise_reduction": False,
                "is_use_one_click_beauty": False,
                "is_use_one_click_ultra_hd": False,
                "is_use_retouch_face": False,
                "is_use_smart_adjust_color": False,
                "is_use_smart_body_beautify": False,
                "is_use_smart_motion": False,
                "is_use_subtitle_recognition": False,
                "is_use_text_to_audio": False,
                "material_edit_session": {
                    "material_edit_info": [],
                    "session_id": "",
                    "session_time": 0,
                },
                "paste_segment_list": [],
                "profile_entrance_type": "",
                "publish_enter_from": "",
                "publish_type": "",
                "single_function_type": 0,
                "text_convert_case_types": [],
                "version": "1.0.0",
                "video_recording_create_draft": "",
            }
        }, ensure_ascii=False).encode("utf-8")
    )

    # template.tmp (empty timeline template)
    empty_tl = {
        "canvas_config": {"background": None, "height": 0, "ratio": "original", "width": 0},
        "color_space": -1,
        "config": {
            "adjust_max_index": 1, "attachment_info": [],
            "combination_max_index": 1, "export_range": None,
            "extract_audio_last_index": 1, "lyrics_recognition_id": "",
            "lyrics_sync": True, "lyrics_taskinfo": [],
            "maintrack_adsorb": True, "material_save_mode": 0,
            "multi_language_current": "none", "multi_language_list": [],
            "multi_language_main": "none", "multi_language_mode": "none",
            "original_sound_last_index": 1, "record_audio_last_index": 1,
            "sticker_max_index": 1, "subtitle_keywords_config": None,
            "subtitle_recognition_id": "", "subtitle_sync": True,
            "subtitle_taskinfo": [], "system_font_list": [],
            "use_float_render": False, "video_mute": False,
            "voice_change_sync": False, "zoom_info_params": None,
        },
        "cover": None, "create_time": 0, "draft_type": "video",
        "duration": 0, "extra_info": None, "fps": 30.0,
        "free_render_index_mode_on": False,
        "id": _new_uuid(),
        "is_drop_frame_timecode": False,
        "keyframe_graph_list": [],
        "keyframes": {"adjusts": [], "audios": [], "effects": [], "filters": [],
                      "handwrites": [], "stickers": [], "texts": [], "videos": []},
        "lyrics_effects": [], "materials": {
            "ai_translates": [], "audio_balances": [], "audio_effects": [],
            "audio_fades": [], "audio_pannings": [], "audio_pitch_shifts": [],
            "audio_track_indexes": [], "audios": [], "beats": [], "canvases": [],
            "chromas": [], "color_curves": [], "common_mask": [],
            "digital_human_model_dressing": [], "digital_humans": [], "drafts": [],
            "effects": [], "flowers": [], "green_screens": [], "handwrites": [],
            "hsl": [], "hsl_curves": [], "images": [], "log_color_wheels": [],
            "loudnesses": [], "manual_beautys": [], "manual_deformations": [],
            "material_animations": [], "material_colors": [], "multi_language_refs": [],
            "placeholder_infos": [], "placeholders": [], "plugin_effects": [],
            "primary_color_wheels": [], "realtime_denoises": [], "shapes": [],
            "smart_crops": [], "smart_relights": [], "sound_channel_mappings": [],
            "speeds": [], "stickers": [], "tail_leaders": [], "text_templates": [],
            "texts": [], "time_marks": [], "transitions": [], "video_effects": [],
            "video_radius": [], "video_shadows": [], "video_strokes": [],
            "video_trackings": [], "videos": [], "vocal_beautifys": [],
            "vocal_separations": [],
        },
        "mutable_config": None, "name": "", "new_version": "75.0.0",
        "path": "", "relationships": [], "render_index_track_mode_on": False,
        "retouch_cover": None, "source": "default",
        "static_cover_image_path": "", "time_marks": None, "tracks": [],
        "update_time": 0, "version": 360000,
    }
    (tl_sub_dir / "template.tmp").write_bytes(
        json.dumps(empty_tl, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )

    # Cáº­p nháº­t timeline_layout.json Ä‘á»ƒ dÃ¹ng timeline_uuid thá»±c
    (draft_folder / "timeline_layout.json").write_bytes(
        json.dumps({
            "dockItems": [{
                "dockIndex": 0,
                "ratio": 1,
                "timelineIds": [timeline_uuid],
                "timelineNames": ["Timeline 01"],
            }],
            "layoutOrientation": 1,
        }, ensure_ascii=False).encode("utf-8")
    )

    # â”€â”€ Cáº­p nháº­t root_meta_info.json â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    (tl_sub_dir / "draft.extra").write_bytes(b"{}")

    cover_bytes = base64.b64decode(_PLACEHOLDER_JPEG_BASE64)
    (draft_folder / "draft_cover.jpg").write_bytes(cover_bytes)
    (tl_sub_dir / "draft_cover.jpg").write_bytes(cover_bytes)

    root_meta_path = capcut_root / "root_meta_info.json"
    try:
        if root_meta_path.exists():
            root_meta = json.loads(root_meta_path.read_text(encoding="utf-8"))
        else:
            root_meta = {"all_draft_store": [], "draft_ids": 0, "root_path": str(capcut_root).replace("\\", "/")}

        new_entry = {
            "cloud_draft_cover": False,
            "cloud_draft_sync": False,
            "draft_cloud_last_action_download": False,
            "draft_cloud_purchase_info": "",
            "draft_cloud_template_id": "",
            "draft_cloud_tutorial_info": "",
            "draft_cloud_videocut_purchase_info": "",
            "draft_cover": str(draft_folder / "draft_cover.jpg").replace("\\", "/"),
            "draft_fold_path": str(draft_folder).replace("\\", "/"),
            "draft_id": draft_id,
            "draft_is_ai_shorts": False,
            "draft_is_cloud_temp_draft": False,
            "draft_is_invisible": False,
            "draft_is_web_article_video": False,
            "draft_json_file": str(draft_folder / "draft_content.json").replace("\\", "/"),
            "draft_name": final_name,
            "draft_new_version": "",
            "draft_root_path": str(capcut_root).replace("/", "\\"),
            "draft_timeline_materials_size": content_size,
            "draft_type": "",
            "draft_web_article_video_enter_from": "",
            "streaming_edit_draft_ready": True,
            "tm_draft_cloud_completed": "",
            "tm_draft_cloud_entry_id": -1,
            "tm_draft_cloud_modified": 0,
            "tm_draft_cloud_parent_entry_id": -1,
            "tm_draft_cloud_space_id": -1,
            "tm_draft_cloud_user_id": -1,
            "tm_draft_create": now_us,
            "tm_draft_modified": now_us,
            "tm_draft_removed": 0,
            "tm_duration": video_duration_us,
        }

        store = root_meta.get("all_draft_store", [])
        store.insert(0, new_entry)  # ThÃªm lÃªn Ä‘áº§u â†’ hiá»‡n thá»‹ Ä‘áº§u tiÃªn trong CapCut
        root_meta["all_draft_store"] = store
        root_meta["draft_ids"] = len(store)
        root_meta_path.write_bytes(
            json.dumps(root_meta, ensure_ascii=False).encode("utf-8")
        )
    except Exception as e:
        logger.warning("KhÃ´ng cáº­p nháº­t Ä‘Æ°á»£c root_meta_info.json: %s", e)

    return {
        "success": True,
        "draft_folder": str(draft_folder),
        "draft_name": final_name,
        "subtitle_count": len(text_materials),
        "message": f"ÄÃ£ táº¡o dá»± Ã¡n CapCut '{final_name}' thÃ nh cÃ´ng!",
    }

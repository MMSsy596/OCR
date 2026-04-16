"""
CapCut Exporter — Tạo dự án CapCut draft từ segments OCR đã dịch.

Luồng hoạt động:
  1. Nhận project_id + danh sách segment (start_sec, end_sec, translated_text)
  2. Detect đường dẫn CapCut root + font
  3. Tạo thư mục draft mới trong com.lveditor.draft/
  4. Ghi draft_content.json (video track + subtitle text track + optional audio track)
  5. Ghi draft_meta_info.json
  6. Cập nhật root_meta_info.json
"""
import json
import logging
import os
import shutil
import time
import uuid
from pathlib import Path

logger = logging.getLogger("solar.ocr.capcut_export")


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def _new_uuid() -> str:
    """Tạo UUID dạng uppercase với dấu gạch ngang, giống CapCut dùng."""
    return str(uuid.uuid4()).upper()


def _sec_to_us(sec: float) -> int:
    """Chuyển giây sang microseconds (đơn vị thời gian của CapCut)."""
    return int(sec * 1_000_000)


def _get_capcut_root() -> Path | None:
    """Trả về thư mục gốc CapCut draft."""
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


def _detect_capcut_font() -> str:
    """Tìm đường dẫn font SystemFont của CapCut (thay đổi theo version)."""
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if not local_app_data:
        return ""
    apps_dir = Path(local_app_data) / "CapCut" / "Apps"
    if not apps_dir.exists():
        return ""
    # Tìm version mới nhất
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


# ─────────────────────────────────────────────────────────────────────
# Content builders
# ─────────────────────────────────────────────────────────────────────

def _build_text_material(text: str, font_path: str) -> dict:
    """Tạo 1 text material cho subtitle CapCut."""
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
    """Tạo 1 segment trên text track cho subtitle."""
    anim_id = _new_uuid()
    return {
        "caption_info": None,
        "cartoon": False,
        "clip": {
            "alpha": 1.0,
            "flip": {"horizontal": False, "vertical": False},
            "rotation": 0.0,
            "scale": {"x": 1.0, "y": 1.0},
            "transform": {"x": 0.0, "y": -0.8},  # vị trí subtitle phía dưới
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
        "extra_material_refs": [anim_id],
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
        "_anim_id": anim_id,  # dùng để ghi material_animations, xóa sau
    }


# ─────────────────────────────────────────────────────────────────────
# Main export function
# ─────────────────────────────────────────────────────────────────────

def export_to_capcut(
    project_name: str,
    video_path: str | None,
    segments: list[dict],
    dub_audio_path: str | None = None,
) -> dict:
    """
    Tạo CapCut draft mới từ kết quả OCR.

    Args:
        project_name: Tên dự án
        video_path: Đường dẫn tuyệt đối file video gốc
        segments: [{start_sec, end_sec, translated_text}]
        dub_audio_path: (optional) đường dẫn file audio dub

    Returns:
        dict với draft_folder, draft_name, success, message
    """
    capcut_root = _get_capcut_root()
    if not capcut_root:
        return {"success": False, "message": "Không tìm thấy thư mục CapCut trên máy này."}

    font_path = _detect_capcut_font()

    now_us = int(time.time() * 1_000_000)
    now_s  = int(time.time())
    draft_id = _new_uuid()
    safe_name = project_name.strip() or "Solar OCR Export"

    # Tạo thư mục draft
    draft_folder = capcut_root / safe_name
    # Nếu đã tồn tại thì thêm số
    counter = 1
    while draft_folder.exists():
        draft_folder = capcut_root / f"{safe_name} ({counter})"
        counter += 1
    draft_folder.mkdir(parents=True)
    final_name = draft_folder.name

    # ── Materials ──────────────────────────────────────────────────────
    # Video material
    video_mat_id   = _new_uuid()
    speed_mat_id   = _new_uuid()
    canvas_mat_id  = _new_uuid()
    placeholder_id = _new_uuid()
    sound_ch_id    = _new_uuid()
    vocal_sep_id   = _new_uuid()
    color_mat_id   = _new_uuid()

    video_path_fwd = str(video_path).replace("\\", "/") if video_path else ""
    video_name     = Path(video_path).name if video_path else "source.mp4"

    # Tính duration video (microseconds)
    total_end_sec = max((s.get("end_sec", 0) for s in segments), default=0) if segments else 0
    video_duration_us = _sec_to_us(total_end_sec) or 30_000_000  # fallback 30s

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
        "height": 1080,
        "id": video_mat_id,
        "intensifies_audio_path": "", "intensifies_path": "",
        "is_ai_generate_content": False, "is_copyright": False,
        "is_text_edit_overdub": False, "is_unified_beauty_mode": False,
        "live_photo_cover_path": "", "live_photo_timestamp": -1,
        "local_id": "", "local_material_from": "",
        "local_material_id": _new_uuid(),
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
        "width": 1920,
    }

    # Audio dub material (nếu có)
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

    # ── Subtitle materials (texts[]) ────────────────────────────────
    text_materials: list[dict] = []
    for seg in segments:
        text = (seg.get("translated_text") or seg.get("raw_text") or "").strip()
        if not text:
            continue
        mat = _build_text_material(text, font_path)
        text_materials.append(mat)

    # animation stubs (1 per text material)
    anim_ids_from_segs: list[str] = []
    material_animations = []
    for mat in text_materials:
        # Tách _anim_id (field tạm) khỏi material
        anim_id = mat.pop("_anim_id", _new_uuid())
        anim_ids_from_segs.append(anim_id)
        material_animations.append({
            "animations": [],
            "id": anim_id,
            "multi_language_current": "none",
            "type": "sticker_animation",
        })

    # ── Video track segment ─────────────────────────────────────────
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
        "id": _new_uuid(),
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

    # ── Text track segments ─────────────────────────────────────────
    text_track_segments = []
    seg_idx = 0
    for i, (mat, seg) in enumerate(zip(text_materials, [s for s in segments if (s.get("translated_text") or s.get("raw_text", "")).strip()])):
        start_us    = _sec_to_us(seg.get("start_sec", 0))
        end_us      = _sec_to_us(seg.get("end_sec", 0))
        duration_us = max(1, end_us - start_us)
        ts = _build_text_track_segment(mat["id"], start_us, duration_us, 14000 + i)
        # Gán _anim_id đúng
        ts["extra_material_refs"] = [anim_ids_from_segs[i]]
        text_track_segments.append(ts)

    # ── Audio track segment (nếu có dub) ───────────────────────────
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

    # ── Assemble draft_content.json ─────────────────────────────────
    tracks = [
        # Track 0: video chính
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
            "height": 1080,
            "ratio": "original",
            "width": 1920,
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
        "fps": 30.0,
        "free_render_index_mode_on": False,
        "id": draft_id,
        "is_drop_frame_timecode": False,
        "keyframe_graph_list": [],
        "keyframes": {
            "adjusts": [], "audios": [], "effects": [],
            "filters": [], "handwrites": [], "stickers": [],
            "texts": [], "videos": [],
        },
        "lyrics_effects": [],
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
        "update_time": 0,
        "version": 360000,
    }

    # Ghi draft_content.json
    content_path = draft_folder / "draft_content.json"
    content_path.write_text(json.dumps(draft_content, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Backup
    shutil.copy2(content_path, draft_folder / "draft_content.json.bak")

    # ── draft_meta_info.json ───────────────────────────────────────
    materials_list = []
    # Type 0: video
    video_mat_entry: list = []
    if video_path:
        video_mat_entry = [{
            "ai_group_type": "", "create_time": now_s,
            "duration": video_duration_us,
            "enter_from": 0, "extra_info": video_name,
            "file_Path": video_path_fwd,
            "height": 1080,
            "id": _new_uuid(),
            "import_time": now_s, "import_time_ms": now_us,
            "item_source": 1, "md5": "",
            "metetype": "video",
            "roughcut_time_range": {"duration": video_duration_us, "start": 0},
            "sub_time_range": {"duration": -1, "start": -1},
            "type": 0, "width": 1920,
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
        "draft_timeline_materials_size_": 0,
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
    meta_path.write_text(json.dumps(draft_meta, ensure_ascii=False), encoding="utf-8")

    # Tạo các file phụ cần thiết để CapCut nhận
    (draft_folder / "draft_agency_config.json").write_text(
        '{"version":1,"staff_id":"","agency_id":"","agency_name":""}', encoding="utf-8"
    )
    (draft_folder / "draft_virtual_store.json").write_text(
        '{"version":1,"virtual_store":[]}', encoding="utf-8"
    )
    (draft_folder / "timeline_layout.json").write_text(
        '{"version":1,"tracks":[]}', encoding="utf-8"
    )
    (draft_folder / "key_value.json").write_text(
        '{"version":1,"items":[]}', encoding="utf-8"
    )
    (draft_folder / "performance_opt_info.json").write_text(
        '{"version":1}', encoding="utf-8"
    )
    (draft_folder / "draft_biz_config.json").write_text("", encoding="utf-8")
    (draft_folder / "draft_settings").write_text(
        '{"sub_track_pitch":true,"use_audio_only":false,"use_video_mute":false}', encoding="utf-8"
    )

    # ── Cập nhật root_meta_info.json ──────────────────────────────
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
            "draft_timeline_materials_size": 0,
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
        store.insert(0, new_entry)  # Thêm lên đầu → hiện thị đầu tiên trong CapCut
        root_meta["all_draft_store"] = store
        root_meta["draft_ids"] = len(store)
        root_meta_path.write_text(json.dumps(root_meta, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        logger.warning("Không cập nhật được root_meta_info.json: %s", e)

    return {
        "success": True,
        "draft_folder": str(draft_folder),
        "draft_name": final_name,
        "subtitle_count": len(text_materials),
        "message": f"Đã tạo dự án CapCut '{final_name}' thành công!",
    }

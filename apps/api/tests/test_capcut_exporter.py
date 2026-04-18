import json
from pathlib import Path

from app.capcut_exporter import (
    _create_unique_draft_folder,
    _get_bundled_reference_draft,
    _pick_reference_draft,
    _rebuild_text_tracks_from_reference,
)


def test_create_unique_draft_folder_skips_existing_names(tmp_path: Path):
    (tmp_path / "Demo").mkdir()
    (tmp_path / "Demo (1)").mkdir()

    created = _create_unique_draft_folder(tmp_path, "Demo")

    assert created == tmp_path / "Demo (2)"
    assert created.is_dir()


def test_create_unique_draft_folder_uses_fallback_name_when_blank(tmp_path: Path):
    created = _create_unique_draft_folder(tmp_path, "   ")

    assert created == tmp_path / "Solar OCR Export"
    assert created.is_dir()


def _write_reference_draft(base: Path, name: str, *, track_types: list[str], text_segments_per_track: list[int], text_material_count: int):
    folder = base / name
    (folder / "Timelines" / "TL-1").mkdir(parents=True)
    tracks = []
    text_track_index = 0
    for track_idx, track_type in enumerate(track_types):
        if track_type == "video":
            segments = [{"id": f"video-seg-{track_idx}", "material_id": "video-1"}]
        else:
            seg_count = text_segments_per_track[text_track_index]
            text_track_index += 1
            segments = [
                {
                    "id": f"text-seg-{track_idx}-{seg_idx}",
                    "material_id": f"text-{len([s for t in tracks if t['type'] == 'text' for s in t['segments']]) + seg_idx + 1}",
                }
                for seg_idx in range(seg_count)
            ]
        tracks.append({"id": f"track-{track_idx}", "type": track_type, "segments": segments})

    content = {
        "materials": {
            "videos": [{"id": "video-1"}],
            "texts": [{"id": f"text-{idx}"} for idx in range(1, text_material_count + 1)],
        },
        "tracks": tracks,
    }
    (folder / "draft_content.json").write_text(json.dumps(content), encoding="utf-8")
    (folder / "draft_meta_info.json").write_text("{}", encoding="utf-8")
    (folder / "timeline_layout.json").write_text("{}", encoding="utf-8")
    (folder / "Timelines" / "project.json").write_text(json.dumps({"main_timeline_id": "TL-1", "timelines": [{"id": "TL-1"}]}), encoding="utf-8")
    return folder


def test_pick_reference_draft_skips_larger_unsafe_two_track_templates(tmp_path: Path):
    unsafe = _write_reference_draft(
        tmp_path,
        "unsafe-large",
        track_types=["video", "text"],
        text_segments_per_track=[20],
        text_material_count=20,
    )
    safe = _write_reference_draft(
        tmp_path,
        "safe-template",
        track_types=["video", "text", "text"],
        text_segments_per_track=[4, 1],
        text_material_count=5,
    )
    unsafe_content = json.loads((unsafe / "draft_content.json").read_text(encoding="utf-8"))
    safe_content = json.loads((safe / "draft_content.json").read_text(encoding="utf-8"))
    (unsafe / "draft_content.json").write_text(json.dumps(unsafe_content, separators=(",", ":")), encoding="utf-8")
    (safe / "draft_content.json").write_text(json.dumps(safe_content, separators=(",", ":")), encoding="utf-8")

    picked = _pick_reference_draft(tmp_path)

    assert picked == safe


def test_rebuild_text_tracks_from_reference_preserves_track_pattern():
    templates = [
        {"id": "track-1", "type": "text", "segments": [{"id": "old-1"}, {"id": "old-2"}, {"id": "old-3"}, {"id": "old-4"}]},
        {"id": "track-2", "type": "text", "segments": [{"id": "old-5"}]},
    ]
    generated = [{"id": f"new-{idx}"} for idx in range(1, 6)]

    rebuilt = _rebuild_text_tracks_from_reference(templates, generated)

    assert [len(track["segments"]) for track in rebuilt] == [4, 1]
    assert rebuilt[0]["segments"][0]["id"] == "new-1"
    assert rebuilt[1]["segments"][0]["id"] == "new-5"


def test_get_bundled_reference_draft_returns_template_when_present(tmp_path: Path, monkeypatch):
    template_dir = tmp_path / "capcut_template" / "0417"
    template_dir.mkdir(parents=True)
    monkeypatch.setattr("app.capcut_exporter._BUNDLED_CAPCUT_TEMPLATE_DIR", template_dir)

    picked = _get_bundled_reference_draft()

    assert picked == template_dir

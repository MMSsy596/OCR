class _FakeJob:
    def __init__(self):
        self.id = "job-1"
        self.project_id = "project-1"
        self.artifacts = {}


def test_effective_scan_interval_caps_samples(app_module):
    from app.pipeline import _compute_effective_scan_interval

    effective_interval, estimated_samples = _compute_effective_scan_interval(
        fps=30.0,
        total_frames=30 * 60 * 120,
        requested_interval_sec=1.0,
    )

    assert effective_interval > 1.0
    assert estimated_samples <= 1600


def test_job_stats_are_compacted_and_indexed(app_module):
    from app.job_state import prepare_job_artifacts, set_stat

    job = _FakeJob()
    artifacts = prepare_job_artifacts(job)
    set_stat(
        artifacts,
        "translate",
        {
            "provider_counts": {"gemini": 10, "deep_translator": 2},
            "fallback_samples": [{"idx": i, "text": "x" * 100} for i in range(20)],
        },
    )

    assert "translate" in artifacts["stats_index"]
    assert "translate" in artifacts["stats_preview"]
    preview = artifacts["stats_preview"]["translate"]
    assert len(preview["fallback_samples"]) <= 6


def test_plan_audio_chunks_for_long_duration(app_module):
    from app.pipeline import _plan_audio_chunks

    chunks = _plan_audio_chunks(3700, 600, 4)

    assert len(chunks) >= 6
    assert chunks[0]["start_sec"] == 0.0
    assert chunks[1]["start_sec"] < chunks[0]["end_sec"]
    assert chunks[-1]["end_sec"] == 3700


def test_parse_srt_segments_offsets_and_normalizes(app_module):
    from app.pipeline import _parse_srt_segments

    srt_text = """1
00:00:01,000 --> 00:00:03,200
Xin chao

2
00:00:04.000 --> 00:00:05.000
The gioi
"""

    segments = _parse_srt_segments(srt_text, start_offset_sec=10, default_voice="nanbao-neutral")

    assert len(segments) == 2
    assert segments[0]["start_sec"] == 11.0
    assert segments[0]["end_sec"] == 13.2
    assert segments[0]["raw_text"] == "Xin chao"
    assert segments[1]["voice"] == "nanbao-neutral"

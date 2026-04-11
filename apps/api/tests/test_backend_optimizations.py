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

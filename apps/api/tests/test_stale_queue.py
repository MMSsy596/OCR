from datetime import datetime, timedelta, timezone


def test_stale_queued_jobs_are_marked_failed(client, auth_headers, app_module):
    create_resp = client.post(
        "/projects",
        headers=auth_headers,
        json={
            "name": "stale-queue-check",
            "source_lang": "zh",
            "target_lang": "vi",
            "prompt": "",
            "glossary": "",
            "roi": {"x": 0.1, "y": 0.75, "w": 0.8, "h": 0.2},
        },
    )
    assert create_resp.status_code == 200
    project_id = create_resp.json()["id"]

    from app import crud
    from app.db import SessionLocal
    from app.models import JobStatus

    db = SessionLocal()
    try:
        job = crud.create_job(db, project_id)
        job.status = JobStatus.queued
        old_time = datetime.now(timezone.utc) - timedelta(seconds=900)
        job.created_at = old_time
        job.updated_at = old_time
        job.artifacts = {"job_kind": "pipeline", "request_payload": {}}
        db.add(job)
        db.commit()
        job_id = job.id
    finally:
        db.close()

    list_resp = client.get(f"/projects/{project_id}/jobs", headers=auth_headers)
    assert list_resp.status_code == 200
    rows = list_resp.json()
    stale = next((item for item in rows if item["id"] == job_id), None)
    assert stale is not None
    assert stale["status"] == "failed"
    assert stale["step"] == "stale_queue_timeout"
    assert stale["error_message"] == "stale_queue_timeout"
    assert stale["artifacts"]["stale_queue"]["timeout_sec"] >= 30

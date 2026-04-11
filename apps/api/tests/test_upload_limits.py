from io import BytesIO


def test_upload_rejects_oversized_file(client, auth_headers):
    create_res = client.post(
        "/projects",
        headers=auth_headers,
        json={
            "name": "NanBao upload limit",
            "source_lang": "zh",
            "target_lang": "vi",
            "roi": {"x": 0.1, "y": 0.7, "w": 0.8, "h": 0.2},
            "prompt": "",
            "glossary": "",
        },
    )
    project_id = create_res.json()["id"]

    large_bytes = BytesIO(b"a" * (1024 * 1024 + 64))
    upload_res = client.post(
        f"/projects/{project_id}/upload",
        headers=auth_headers,
        files={"file": ("large.mp4", large_bytes, "video/mp4")},
    )

    assert upload_res.status_code == 413
    assert upload_res.json()["detail"] == "file_too_large"


def test_upload_rejects_unsupported_extension(client, auth_headers):
    create_res = client.post(
        "/projects",
        headers=auth_headers,
        json={
            "name": "NanBao ext limit",
            "source_lang": "zh",
            "target_lang": "vi",
            "roi": {"x": 0.1, "y": 0.7, "w": 0.8, "h": 0.2},
            "prompt": "",
            "glossary": "",
        },
    )
    project_id = create_res.json()["id"]

    upload_res = client.post(
        f"/projects/{project_id}/upload",
        headers=auth_headers,
        files={"file": ("malware.exe", BytesIO(b"fake"), "application/octet-stream")},
    )

    assert upload_res.status_code == 400
    assert upload_res.json()["detail"] == "unsupported_video_format"

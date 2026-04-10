from io import BytesIO


def test_project_export_flow(client, auth_headers):
    create_res = client.post(
        "/projects",
        headers=auth_headers,
        json={
            "name": "NanBao test",
            "source_lang": "zh",
            "target_lang": "vi",
            "roi": {"x": 0.1, "y": 0.7, "w": 0.8, "h": 0.2},
            "prompt": "Dịch gọn, tự nhiên.",
            "glossary": "",
        },
    )
    assert create_res.status_code == 200
    project_id = create_res.json()["id"]

    upload_res = client.post(
        f"/projects/{project_id}/upload",
        headers=auth_headers,
        files={"file": ("demo.mp4", BytesIO(b"fake-video"), "video/mp4")},
    )
    assert upload_res.status_code == 200

    save_segments_res = client.put(
        f"/projects/{project_id}/segments",
        headers=auth_headers,
        json=[
            {
                "id": 1,
                "start_sec": 0.0,
                "end_sec": 2.0,
                "raw_text": "Xin chao",
                "translated_text": "Xin chào",
                "speaker": "narrator",
                "voice": "female-soft",
            }
        ],
    )
    assert save_segments_res.status_code == 200
    assert len(save_segments_res.json()) == 1

    export_res = client.post(
        f"/projects/{project_id}/export",
        headers=auth_headers,
        json={"export_format": "json", "content_mode": "translated"},
    )
    assert export_res.status_code == 200
    payload = export_res.json()
    assert payload["output_key"].endswith(".json")

    download_res = client.get(payload["download_url"], headers=auth_headers)
    assert download_res.status_code == 200
    assert project_id in download_res.text

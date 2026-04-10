def test_project_stream_snapshot(client, auth_headers):
    create_res = client.post(
        "/projects",
        headers=auth_headers,
        json={
            "name": "NanBao stream",
            "source_lang": "zh",
            "target_lang": "vi",
            "roi": {"x": 0.1, "y": 0.7, "w": 0.8, "h": 0.2},
            "prompt": "",
            "glossary": "",
        },
    )
    project_id = create_res.json()["id"]

    with client.stream(
        "GET",
        f"/projects/{project_id}/stream?access_token=nanbao-test-token",
    ) as response:
        assert response.status_code == 200
        chunks = []
        for chunk in response.iter_text():
            chunks.append(chunk)
            if "snapshot" in chunk:
                break

    body = "".join(chunks)
    assert "\"type\": \"snapshot\"" in body
    assert project_id in body

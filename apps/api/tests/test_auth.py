def test_projects_requires_token(client):
    response = client.get("/projects")
    assert response.status_code == 401
    assert response.json()["detail"] == "unauthorized"


def test_health_is_public(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True

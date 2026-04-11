def test_projects_requires_token(client):
    response = client.get("/projects")
    assert response.status_code == 401
    assert response.json()["detail"] == "unauthorized"


def test_health_is_public(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_projects_accept_x_api_key(client, api_key_headers):
    response = client.get("/projects", headers=api_key_headers)
    assert response.status_code == 200
    assert response.json() == []


def test_security_headers_are_set(client):
    response = client.get("/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Cache-Control"] == "no-store"

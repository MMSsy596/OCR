from __future__ import annotations

import secrets

from fastapi import HTTPException, Request

from .settings import get_settings


PROTECTED_PREFIXES = ("/projects", "/jobs")
QUERY_TOKEN_SUFFIXES = ("/stream",)


def _extract_token(request: Request) -> str:
    auth_header = (request.headers.get("Authorization") or "").strip()
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()

    api_key = (request.headers.get("X-API-Key") or "").strip()
    if api_key:
        return api_key

    settings = get_settings()
    query_token = (request.query_params.get("access_token") or "").strip()
    if query_token and settings.allow_query_token_auth and request.url.path.endswith(QUERY_TOKEN_SUFFIXES):
        return query_token

    return ""


def _is_protected_path(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in PROTECTED_PREFIXES)


async def require_api_auth(request: Request) -> None:
    settings = get_settings()
    expected_tokens = settings.api_tokens_list
    if not expected_tokens:
        return
    if not _is_protected_path(request.url.path):
        return

    provided_token = _extract_token(request)
    if provided_token:
        for expected_token in expected_tokens:
            if secrets.compare_digest(provided_token, expected_token):
                return

    raise HTTPException(status_code=401, detail="unauthorized")

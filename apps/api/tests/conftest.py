from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))


@pytest.fixture(scope="session")
def app_module(tmp_path_factory):
    db_path = tmp_path_factory.mktemp("db") / "test.db"
    storage_path = tmp_path_factory.mktemp("storage")

    os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{db_path.as_posix()}"
    os.environ["STORAGE_ROOT"] = str(storage_path)
    os.environ["API_TOKEN"] = "nanbao-test-token"
    os.environ["API_TOKENS"] = "nanbao-test-token,nanbao-backup-token"
    os.environ["WEB_ORIGIN"] = "http://localhost:5173"
    os.environ["ALLOWED_HOSTS"] = "localhost,127.0.0.1,testserver"
    os.environ["MAX_UPLOAD_SIZE_MB"] = "1"

    for module_name in list(sys.modules):
        if module_name == "app" or module_name.startswith("app."):
            sys.modules.pop(module_name, None)

    settings_module = importlib.import_module("app.settings")
    importlib.reload(settings_module)
    db_module = importlib.import_module("app.db")
    importlib.reload(db_module)
    main_module = importlib.import_module("app.main")
    importlib.reload(main_module)
    return main_module


@pytest.fixture()
def client(app_module):
    with TestClient(app_module.app) as test_client:
        yield test_client


@pytest.fixture()
def auth_headers():
    return {"Authorization": "Bearer nanbao-test-token"}


@pytest.fixture()
def api_key_headers():
    return {"X-API-Key": "nanbao-backup-token"}

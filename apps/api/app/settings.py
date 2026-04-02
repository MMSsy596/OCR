from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT_ENV), env_file_encoding="utf-8", extra="ignore")

    app_name: str = "NanBao OCR Studio"
    web_origin: str = "http://localhost:5173"
    database_url: str = "sqlite+pysqlite:///./ocr.db"
    redis_url: str = "redis://localhost:6379/0"
    storage_root: str = "../../storage/projects"
    gemini_api_keys: str = ""
    default_source_lang: str = "zh"
    default_target_lang: str = "vi"

    @property
    def storage_path(self) -> Path:
        base = Path(__file__).resolve().parent
        return (base / self.storage_root).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()

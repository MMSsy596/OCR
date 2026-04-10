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
    api_token: str = ""
    job_inline_event_limit: int = 80
    job_inline_stats_limit: int = 8
    ocr_profile: str = "balanced"
    ocr_long_video_threshold_samples: int = 1200
    tts_max_parallel_workers: int = 3

    @property
    def resolved_database_url(self) -> str:
        url = (self.database_url or "").strip()
        sqlite_prefixes = ("sqlite+pysqlite:///", "sqlite:///")
        for prefix in sqlite_prefixes:
            if not url.startswith(prefix):
                continue
            raw_path = url[len(prefix) :]
            if not raw_path:
                break
            if raw_path.startswith("/") and len(raw_path) >= 3 and raw_path[2] == ":":
                # form /C:/path
                return url
            path_obj = Path(raw_path)
            if path_obj.is_absolute():
                return url
            api_root = Path(__file__).resolve().parents[1]
            abs_path = (api_root / raw_path).resolve()
            return f"{prefix}{abs_path.as_posix()}"
        return url

    @property
    def storage_path(self) -> Path:
        base = Path(__file__).resolve().parent
        return (base / self.storage_root).resolve()

    @property
    def resolved_redis_url(self) -> str:
        url = (self.redis_url or "").strip()
        if not url:
            return "redis://localhost:6379/0"
        if url.startswith("${{") and url.endswith("}}"):
            raise ValueError(
                "REDIS_URL dang de o dang placeholder '${{...}}'. "
                "Hay gan truc tiep gia tri redis://... tu Railway."
            )
        if "://" not in url:
            url = f"redis://{url}"
        if not (url.startswith("redis://") or url.startswith("rediss://") or url.startswith("unix://")):
            raise ValueError("REDIS_URL phai bat dau bang redis://, rediss:// hoac unix://")
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()

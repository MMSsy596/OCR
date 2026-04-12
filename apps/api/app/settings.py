from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT_ENV), env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Solar OCR Studio"
    environment: str = "development"
    web_origin: str = "http://localhost:5173"
    allowed_hosts: str = "localhost,127.0.0.1,testserver"
    database_url: str = "sqlite+pysqlite:///./ocr.db"
    redis_url: str = "redis://localhost:6379/0"
    storage_root: str = "../../storage/projects"
    gemini_api_keys: str = ""
    default_source_lang: str = "zh"
    default_target_lang: str = "vi"
    api_token: str = ""
    api_tokens: str = ""
    allow_query_token_auth: bool = True
    enable_docs: bool = True
    max_upload_size_mb: int = 512
    job_inline_event_limit: int = 80
    job_inline_stats_limit: int = 8
    job_event_message_limit: int = 220
    ocr_profile: str = "balanced"
    ocr_long_video_threshold_samples: int = 1200
    ocr_max_samples_per_video: int = 1600
    tts_max_parallel_workers: int = 3
    queue_stale_timeout_sec: int = 180

    @property
    def is_production(self) -> bool:
        return (self.environment or "").strip().lower() in {"prod", "production", "staging"}

    @property
    def allowed_hosts_list(self) -> list[str]:
        raw = (self.allowed_hosts or "").strip()
        if not raw:
            return ["localhost", "127.0.0.1"]
        return [item.strip() for item in raw.split(",") if item.strip()]

    @property
    def api_tokens_list(self) -> list[str]:
        combined: list[str] = []
        for raw in ((self.api_token or "").strip(), (self.api_tokens or "").strip()):
            if not raw:
                continue
            combined.extend(item.strip() for item in raw.split(",") if item.strip())
        deduped: list[str] = []
        seen: set[str] = set()
        for token in combined:
            if token in seen:
                continue
            seen.add(token)
            deduped.append(token)
        return deduped

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

    def validate_production_guard(self) -> None:
        if not self.is_production:
            return
        if not self.api_tokens_list:
            raise ValueError("Production yeu cau API_TOKEN hoac API_TOKENS.")
        if self.enable_docs:
            raise ValueError("Production nen tat docs bang ENABLE_DOCS=false.")
        if self.max_upload_size_mb <= 0:
            raise ValueError("MAX_UPLOAD_SIZE_MB phai lon hon 0.")


@lru_cache
def get_settings() -> Settings:
    return Settings()

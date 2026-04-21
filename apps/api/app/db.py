from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .settings import get_settings

settings = get_settings()

_db_url = settings.resolved_database_url
_is_sqlite = _db_url.startswith("sqlite")

engine = create_engine(
    _db_url,
    pool_pre_ping=True,
    # SQLite dùng StaticPool (single-file, không hỗ trợ pool thật)
    # Postgres/MySQL: pool_size + overflow mới có hiệu quả
    **({} if _is_sqlite else {"pool_size": 10, "max_overflow": 20, "pool_recycle": 1800}),
    connect_args={"check_same_thread": False} if _is_sqlite else {},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_runtime_indexes() -> None:
    statements = [
        "CREATE INDEX IF NOT EXISTS ix_subtitle_segments_project_start ON subtitle_segments (project_id, start_sec)",
        "CREATE INDEX IF NOT EXISTS ix_pipeline_jobs_project_created ON pipeline_jobs (project_id, created_at)",
        "CREATE INDEX IF NOT EXISTS ix_projects_created_at ON projects (created_at)",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
        # Migration: thêm cột folder_name nếu chưa có (tương thích ngược với DB cũ)
        # Lưu ý: SQLite KHÔNG cho phép ADD COLUMN ... UNIQUE trong một lệnh,
        # nên phải tách thành 2 bước: ADD COLUMN rồi CREATE UNIQUE INDEX riêng.
        try:
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN folder_name VARCHAR(220)"
            ))
        except Exception:
            pass  # Cột đã tồn tại → bỏ qua
        # Tạo unique index cho folder_name
        try:
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_folder_name ON projects (folder_name)"
            ))
        except Exception:
            pass


from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .settings import get_settings

settings = get_settings()

engine = create_engine(settings.resolved_database_url, pool_pre_ping=True)
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

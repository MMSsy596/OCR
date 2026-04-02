import os
import sys
from pathlib import Path

from redis import Redis
from rq import Connection, Worker


def main() -> None:
    base = Path(__file__).resolve().parents[1]
    api_dir = base / "api"
    if str(api_dir) not in sys.path:
        sys.path.insert(0, str(api_dir))

    from app.settings import get_settings  # noqa: WPS433

    settings = get_settings()
    redis_conn = Redis.from_url(settings.redis_url)

    # RQ worker can resolve "app.pipeline.run_pipeline"
    os.environ.setdefault("PYTHONPATH", str(api_dir))
    with Connection(redis_conn):
        worker = Worker(["pipeline"])
        worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()


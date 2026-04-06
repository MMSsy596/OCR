import os
import sys
from pathlib import Path

from redis import Redis
from rq import Connection, SimpleWorker, Worker
from rq.timeouts import TimerDeathPenalty


class WindowsSimpleWorker(SimpleWorker):
    death_penalty_class = TimerDeathPenalty


def main() -> None:
    base = Path(__file__).resolve().parents[1]
    api_dir = base / "api"
    if str(api_dir) not in sys.path:
        sys.path.insert(0, str(api_dir))

    from app.settings import get_settings  # noqa: WPS433

    settings = get_settings()
    try:
        redis_conn = Redis.from_url(settings.resolved_redis_url)
    except ValueError as ex:
        print(f"[worker] Cau hinh REDIS_URL khong hop le: {ex}", flush=True)
        print("[worker] Worker tam dung. API van chay; job se fallback local neu queue loi.", flush=True)
        return

    # RQ worker can resolve "app.pipeline.run_pipeline"
    os.environ.setdefault("PYTHONPATH", str(api_dir))
    with Connection(redis_conn):
        # Windows does not support os.fork used by default Worker.
        worker_cls = WindowsSimpleWorker if os.name == "nt" else Worker
        worker = worker_cls(["pipeline"])
        worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()

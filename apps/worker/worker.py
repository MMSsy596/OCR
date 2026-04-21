import os
import sys
from pathlib import Path

from redis import Redis
from redis.exceptions import RedisError
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
        print(f"[worker] Cấu hình REDIS_URL không hợp lệ: {ex}", flush=True)
        print("[worker] Worker tạm dừng. API vẫn chạy; job sẽ fallback local nếu queue lỗi.", flush=True)
        return

    # RQ worker can resolve "app.pipeline.run_pipeline"
    os.environ.setdefault("PYTHONPATH", str(api_dir))
    try:
        with Connection(redis_conn):
            # Windows does not support os.fork used by default Worker.
            worker_cls = WindowsSimpleWorker if os.name == "nt" else Worker
            worker = worker_cls(["pipeline"])
            worker.work(with_scheduler=False)
    except RedisError as ex:
        print(f"[worker] Chưa kết nối được Redis: {ex}", flush=True)
        print("[worker] Worker sẽ thoát để script khởi động thử lại.", flush=True)


if __name__ == "__main__":
    main()

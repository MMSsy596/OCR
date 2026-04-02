from redis import Redis
from rq import Queue

from .settings import get_settings


def get_queue() -> Queue:
    settings = get_settings()
    redis_conn = Redis.from_url(settings.redis_url)
    return Queue("pipeline", connection=redis_conn, default_timeout=3600)


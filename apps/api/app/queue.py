from redis import ConnectionPool, Redis
from rq import Queue

from .settings import get_settings

_redis_pool: ConnectionPool | None = None


def get_redis_pool() -> ConnectionPool:
    """Singleton ConnectionPool — tạo một lần, tái dùng mãi."""
    global _redis_pool
    if _redis_pool is None:
        settings = get_settings()
        _redis_pool = ConnectionPool.from_url(
            settings.resolved_redis_url,
            max_connections=20,
            decode_responses=False,
        )
    return _redis_pool


def get_queue() -> Queue:
    conn = Redis(connection_pool=get_redis_pool())
    return Queue("pipeline", connection=conn, default_timeout=3600)

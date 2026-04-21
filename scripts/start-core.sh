#!/usr/bin/env sh
set -eu

worker_loop() {
  while true; do
    python /app/apps/worker/worker.py || true
    echo "[worker] Worker đã dừng. Sẽ thử khởi động lại sau 5 giây." >&2
    sleep 5
  done
}

worker_loop &
worker_pid=$!

uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" &
api_pid=$!

cleanup() {
  kill -TERM "$api_pid" 2>/dev/null || true
  kill -TERM "$worker_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
}

trap cleanup INT TERM

wait "$api_pid"
api_status=$?

kill -TERM "$worker_pid" 2>/dev/null || true
wait "$worker_pid" 2>/dev/null || true

exit "$api_status"

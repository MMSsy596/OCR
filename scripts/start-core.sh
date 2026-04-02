#!/usr/bin/env sh
set -eu

python /app/apps/worker/worker.py &
worker_pid=$!

cleanup() {
  kill -TERM "$worker_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
}

trap cleanup INT TERM

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"

# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=20-alpine
ARG PYTHON_VERSION=3.11-slim-bookworm

FROM node:${NODE_VERSION} AS web-builder
WORKDIR /build/web

COPY apps/web/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY apps/web ./
ARG VITE_API_BASE=""
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

FROM python:${PYTHON_VERSION} AS python-builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:${PATH}

WORKDIR /tmp/build

COPY apps/api/requirements.txt /tmp/requirements-api.txt
COPY apps/worker/requirements.txt /tmp/requirements-worker.txt

RUN python -m venv "${VIRTUAL_ENV}" \
    && awk 'NF && $1 !~ /^#/ && !seen[$0]++ { print }' \
        /tmp/requirements-api.txt \
        /tmp/requirements-worker.txt \
        > /tmp/requirements-runtime.txt

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip setuptools wheel \
    && pip install -r /tmp/requirements-runtime.txt

FROM python:${PYTHON_VERSION} AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:${PATH} \
    PORT=8000 \
    WEB_ORIGIN=http://localhost:8000 \
    DATABASE_URL=sqlite+pysqlite:////data/ocr.db \
    REDIS_URL=redis://redis:6379/0 \
    STORAGE_ROOT=/data/projects

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        espeak-ng \
        ffmpeg \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        libsm6 \
        libxext6 \
        tini \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system app \
    && useradd --system --gid app --create-home --home-dir /home/app app \
    && mkdir -p /app/apps /app/scripts /data/projects \
    && chown -R app:app /app /data /home/app

COPY --from=python-builder /opt/venv /opt/venv
COPY --chown=app:app apps/api /app/apps/api
COPY --chown=app:app apps/worker /app/apps/worker
COPY --from=web-builder --chown=app:app /build/web/dist /app/apps/api/web_dist
COPY --chown=app:app scripts/start-core.sh /app/scripts/start-core.sh

RUN chmod 755 /app/scripts/start-core.sh

USER app
WORKDIR /app/apps/api

EXPOSE 8000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "/app/scripts/start-core.sh"]

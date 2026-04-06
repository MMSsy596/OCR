# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS web-builder
WORKDIR /app/apps/web

COPY apps/web/package*.json ./
RUN npm ci

COPY apps/web ./
ARG VITE_API_BASE=""
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY apps/api/requirements.txt /tmp/requirements-api.txt
COPY apps/worker/requirements.txt /tmp/requirements-worker.txt
RUN pip install --upgrade pip \
    && pip install -r /tmp/requirements-api.txt \
    && pip install -r /tmp/requirements-worker.txt

COPY apps/api /app/apps/api
COPY apps/worker /app/apps/worker
COPY --from=web-builder /app/apps/web/dist /app/apps/api/web_dist
COPY scripts/start-core.sh /app/scripts/start-core.sh
COPY storage /app/storage

WORKDIR /app/apps/api

ENV STORAGE_ROOT=/data/projects

EXPOSE 8000

CMD ["sh", "/app/scripts/start-core.sh"]

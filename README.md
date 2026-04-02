# NanBao OCR Video Studio

Web app xu ly video phu de: OCR -> dich -> TTS -> export subtitle/audio.

## 1) Thanh phan

- `apps/api`: FastAPI + SQLAlchemy + Redis queue producer
- `apps/worker`: RQ worker xu ly pipeline nen
- `apps/web`: React (Vite) giao dien quan ly project
- `docker-compose.yml`: Postgres + Redis + MinIO

## 2) Chay nhanh local

1. Copy env
```bash
cp .env.example .env
```
2. Khoi dong service nen
```bash
docker compose up -d postgres redis minio
```
3. Chay API
```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
4. Chay worker
```bash
cd apps/worker
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python worker.py
```
5. Chay web
```bash
cd apps/web
npm install
npm run dev
```

## 3) Luong su dung

1. Tao project
2. Upload video
3. Nhap ROI + prompt + glossary + API key (neu co)
4. Bam Start Pipeline
5. Theo doi tien do va tai file export (`srt`, `json`, `tts script`)

## 4) Trang thai MVP

- Co day du flow end-to-end qua queue
- OCR/TTS dang o muc practical MVP (co fallback an toan)
- Cho phep nang cap nhanh sang OCR/TTS engine that
- Cho phep edit subtitle truoc khi export
- Export da dinh dang: `srt`, `vtt`, `csv`, `txt`, `json`
- Export theo che do noi dung: `raw`, `translated`, `bilingual`

## 5) OCR that (python-only)

OCR da chuyen sang `rapidocr-onnxruntime` + `opencv-python`.
Chi can:

```bash
cd apps/api
pip install -r requirements.txt
```

Khong can cai Tesseract ngoai he dieu hanh. Neu OCR lib chua san sang, app tu fallback sang mode OCR mau.
Neu Gemini khong phan hoi, he thong co fallback dich bang `deep-translator`.

## 6) Deploy Railway (khuyen nghi)

Do `api` va `worker` can doc/ghi cung thu muc file (`storage/projects`), can deploy theo 2 service:

1. `ocr-core` (1 container chay ca API + worker)
2. `ocr-web` (frontend React static)

### 6.1 Service `ocr-core`

- Root directory: repo root
- Dockerfile path: `Dockerfile`
- Gan 1 Railway Volume vao duong dan `/data`
- Env can set:

```bash
PORT=8000
WEB_ORIGIN=https://<domain-ocr-web>
REDIS_URL=<Redis private url tren Railway>
DATABASE_URL=sqlite+pysqlite:////data/ocr.db
STORAGE_ROOT=/data/projects
```

`Dockerfile` se tu chay `worker` nen + `uvicorn` trong cung container, tranh loi lech file giua 2 service.

### 6.2 Service `ocr-web`

- Root directory: repo root
- Dockerfile path: `Dockerfile.web`
- Env build/runtime:

```bash
PORT=8080
VITE_API_BASE=https://<domain-ocr-core>
```

Sau khi deploy xong, cap nhat lai `WEB_ORIGIN` cua `ocr-core` = domain thuc te cua `ocr-web`.

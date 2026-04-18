# NanBao OCR Studio

Ứng dụng OCR video để trích xuất phụ đề, dịch subtitle và tạo audio dub.

Stack mặc định hiện tại:
- `SQLite` để lưu dữ liệu ứng dụng
- `Redis` để chạy hàng đợi job nền
- 1 image Docker chứa sẵn `frontend + API + worker`

`PostgreSQL` và `MinIO` không còn là yêu cầu mặc định.

## 1. Yêu cầu hệ thống

### Chạy bằng Docker image

Chỉ cần:
- `Docker Desktop` hoặc Docker Engine

Khuyên dùng thêm:
- RAM từ `8 GB`
- Ổ đĩa trống tối thiểu `10 GB`

### Chạy từ mã nguồn

Cần:
- `Python 3.11` hoặc `3.12`
- `Node.js 20+`
- `Redis 7+`
- `FFmpeg` và `ffprobe`

## 2. File và thư mục cần có

### Nếu chạy từ image đã build sẵn

Không cần mã nguồn. Chỉ cần:
- image Docker, ví dụ `nanbao/ocr:tagname`
- 1 volume hoặc thư mục mount vào `/data`

Trong `/data`, ứng dụng sẽ tự dùng:
- `/data/ocr.db` cho `SQLite`
- `/data/projects` để lưu video, file export, audio dub

### Nếu chạy từ mã nguồn

Tối thiểu cần các file và thư mục này:

```text
OCR/
├── apps/
│   ├── api/
│   ├── web/
│   └── worker/
├── scripts/
├── storage/
│   └── projects/
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── README.md
├── start-all.ps1
└── stop-all.ps1
```

## 3. Biến môi trường

Tạo file `.env` từ `.env.example`:

```powershell
Copy-Item .env.example .env
```

Mẫu cấu hình hiện tại:

```env
APP_NAME=NanBao OCR Studio
API_HOST=0.0.0.0
API_PORT=8000
WEB_ORIGIN=http://localhost:5173
DATABASE_URL=sqlite+pysqlite:///./ocr.db
REDIS_URL=redis://localhost:6379/0
STORAGE_ROOT=../../storage/projects
GEMINI_API_KEYS=
DEFAULT_SOURCE_LANG=zh
DEFAULT_TARGET_LANG=vi
```

Ý nghĩa các biến chính:
- `DATABASE_URL`: mặc định dùng `SQLite`
- `REDIS_URL`: địa chỉ Redis cho worker
- `STORAGE_ROOT`: nơi lưu video, subtitle, file export, audio
- `GEMINI_API_KEYS`: để trống nếu không dùng Gemini
- `WEB_ORIGIN`: địa chỉ frontend được phép gọi API

### Biến môi trường khi chạy image Docker

Nếu chạy bằng image, nên dùng:

```env
PORT=8000
WEB_ORIGIN=http://localhost:8000
ALLOWED_HOSTS=localhost,127.0.0.1
ENABLE_DOCS=true
DATABASE_URL=sqlite+pysqlite:////data/ocr.db
REDIS_URL=redis://redis:6379/0
STORAGE_ROOT=/data/projects
GEMINI_API_KEYS=
DEFAULT_SOURCE_LANG=zh
DEFAULT_TARGET_LANG=vi
```

## 4. Cài đặt và chạy bằng Docker

Đây là cách khuyên dùng.

### Cách 1: Chạy nhanh bằng `docker run`

1. Chạy Redis:

```powershell
docker run -d --name nanbao-ocr-redis -p 6379:6379 redis:7
```

2. Chạy app:

```powershell
docker run -d --name nanbao-ocr-app `
  -p 8000:8000 `
  -e PORT=8000 `
  -e WEB_ORIGIN=http://localhost:8000 `
  -e ALLOWED_HOSTS=localhost,127.0.0.1 `
  -e ENABLE_DOCS=true `
  -e DATABASE_URL=sqlite+pysqlite:////data/ocr.db `
  -e REDIS_URL=redis://host.docker.internal:6379/0 `
  -e STORAGE_ROOT=/data/projects `
  -v nanbao_ocr_data:/data `
  nanbao/ocr:tagname
```

3. Mở ứng dụng:
- `http://localhost:8000`

4. Kiểm tra health:
- `http://localhost:8000/health`

### Cách 2: Chạy bằng `docker compose`

Repo đã có sẵn `docker-compose.yml` cho stack `SQLite + Redis`.

Chạy:

```powershell
docker compose up -d
```

Kiểm tra:

```powershell
docker compose ps
docker compose logs -f app
```

Truy cập:
- `http://localhost:8000`

### Dữ liệu được lưu ở đâu

Khi chạy Docker:
- volume `app_data` chứa `SQLite` và dữ liệu project
- Redis chỉ dùng cho queue, không lưu dữ liệu chính của app

## 5. Cài đặt và chạy từ mã nguồn

### Bước 1: Tạo môi trường backend

```powershell
cd apps/api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Bước 2: Tạo môi trường worker

```powershell
cd ..\worker
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Bước 3: Cài frontend

```powershell
cd ..\web
npm install
```

### Bước 4: Chạy Redis

Khuyên dùng Docker:

```powershell
cd ..\..
docker compose up -d redis
```

### Bước 5: Chạy từng service

Terminal 1, chạy API:

```powershell
cd apps/api
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Terminal 2, chạy worker:

```powershell
cd apps/worker
.\.venv\Scripts\Activate.ps1
python worker.py
```

Terminal 3, chạy frontend:

```powershell
cd apps/web
npm run dev
```

Truy cập:
- frontend dev: `http://localhost:5173`
- API: `http://localhost:8000`
- docs: `http://localhost:8000/docs`

## 6. Chạy bằng script có sẵn

### Script hỗ trợ local

Khởi động Redis:

```powershell
cd scripts
.\dev.ps1
```

Khởi động nhanh API và frontend:

```powershell
.\start-all.ps1
```

Dừng stack local:

```powershell
.\stop-all.ps1
```

## 7. Build image

Build image local:

```powershell
docker build -t nanbao-ocr-app:latest .
```

Chạy thử:

```powershell
docker run --rm -p 8000:8000 `
  -e PORT=8000 `
  -e WEB_ORIGIN=http://localhost:8000 `
  -e ALLOWED_HOSTS=localhost,127.0.0.1 `
  -e ENABLE_DOCS=true `
  -e DATABASE_URL=sqlite+pysqlite:////data/ocr.db `
  -e REDIS_URL=redis://host.docker.internal:6379/0 `
  -e STORAGE_ROOT=/data/projects `
  -v nanbao_ocr_data:/data `
  nanbao-ocr-app:latest
```

## 8. Push image lên Docker Hub

Ví dụ:

```powershell
docker tag nanbao-ocr-app:latest nanbao/ocr:tagname
docker push nanbao/ocr:tagname
```

## 9. Ghi chú vận hành

- `SQLite` là dữ liệu chính của app, nằm trong volume `/data`
- `Redis` chỉ dùng cho hàng đợi job nền
- Nếu Redis tạm mất kết nối, worker sẽ thử khởi động lại
- Nếu chỉ cần demo nhanh, app vẫn có thể lên mà không có Redis, nhưng queue nền sẽ không ổn định

## 10. Kiểm tra nhanh sau khi chạy

```powershell
Invoke-RestMethod http://localhost:8000/health
```

Kết quả mong đợi:

```json
{"ok":true,"environment":"development"}
```

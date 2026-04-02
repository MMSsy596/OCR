# NanBao OCR Video Studio

Web app xử lý video phụ đề: OCR -> dịch -> TTS -> export subtitle/audio.

## 1) Thành phần

- `apps/api`: FastAPI + SQLAlchemy + Redis queue producer
- `apps/worker`: RQ worker xử lý pipeline nền
- `apps/web`: React (Vite) giao diện quản lý project
- `docker-compose.yml`: Postgres + Redis + MinIO

## 2) Chạy nhanh local

1. Copy env
```bash
cp .env.example .env
```
2. Khởi động service nền
```bash
docker compose up -d postgres redis minio
```
3. Chạy API
```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
4. Chạy worker
```bash
cd apps/worker
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python worker.py
```
5. Chạy web
```bash
cd apps/web
npm install
npm run dev
```

## 3) Luồng sử dụng

1. Tạo project
2. Upload video
3. Nhập ROI + prompt + glossary + API key (nếu có)
4. Bấm Start Pipeline
5. Theo dõi tiến độ và tải file export (`srt`, `json`, `tts script`)
6. Tạo audio lồng tiếng từ SRT theo timestamp (1 file duy nhất, có thể khớp độ dài video gốc)

## 4) Trạng thái MVP

- Có đầy đủ flow end-to-end qua queue
- OCR/TTS đang ở mức practical MVP (có fallback an toàn)
- Cho phép nâng cấp nhanh sang OCR/TTS engine thật
- Cho phép edit subtitle trước khi export
- Export đa định dạng: `srt`, `vtt`, `csv`, `txt`, `json`
- Export theo chế độ nội dung: `raw`, `translated`, `bilingual`

## 5) OCR thật (python-only)

OCR đã chuyển sang `rapidocr-onnxruntime` + `opencv-python`.
Chỉ cần:

```bash
cd apps/api
pip install -r requirements.txt
```

Không cần cài Tesseract ngoài hệ điều hành. Nếu OCR lib chưa sẵn sàng, app tự fallback sang mode OCR mẫu.
Nếu Gemini không phản hồi, hệ thống có fallback dịch bằng `deep-translator`.

## 7) Audio lồng tiếng từ SRT

- Backend có endpoint: `POST /projects/{project_id}/dub/start`
- Dữ liệu vào:
  - `srt_key`: tên file SRT trong thư mục project (mặc định `manual.translated.srt`)
  - `voice`: voice Edge TTS (mặc định `vi-VN-HoaiMyNeural`)
  - `rate`, `volume`, `pitch`: thông số giọng đọc
  - `output_format`: `wav` hoặc `mp3`
  - `match_video_duration`: có pad đến đúng tổng độ dài video hay không
- Job chạy nền qua RQ, xem tiến độ tại danh sách jobs như pipeline OCR.
- Khi xong, tải file audio qua artifact key `dubbed_audio`.

Yêu cầu runtime:
- Đã cài `edge-tts` (có trong `requirements.txt`)
- Hệ thống có `ffmpeg` + `ffprobe` trong `PATH`

## 6) Deploy Railway (khuyến nghị)

Do `api` và `worker` cần đọc/ghi cùng thư mục file (`storage/projects`), cần deploy theo 2 service:

1. `ocr-core` (1 container chạy cả API + worker)
2. `ocr-web` (frontend React static)

### 6.1 Service `ocr-core`

- Root directory: repo root
- Dockerfile path: `Dockerfile`
- Gắn 1 Railway Volume vào đường dẫn `/data`
- Env cần set:

```bash
PORT=8000
WEB_ORIGIN=https://<domain-ocr-web>
REDIS_URL=<Redis private url tren Railway>
DATABASE_URL=sqlite+pysqlite:////data/ocr.db
STORAGE_ROOT=/data/projects
```

`Dockerfile` sẽ tự chạy `worker` nền + `uvicorn` trong cùng container, tránh lỗi lệch file giữa 2 service.

### 6.2 Service `ocr-web`

- Root directory: repo root
- Dockerfile path: `Dockerfile.web`
- Env build/runtime:

```bash
PORT=8080
VITE_API_BASE=https://<domain-ocr-core>
```

Sau khi deploy xong, cập nhật lại `WEB_ORIGIN` của `ocr-core` = domain thực tế của `ocr-web`.

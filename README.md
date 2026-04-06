# NanBao OCR Video Studio

Ứng dụng web xử lý video phụ đề theo pipeline: **OCR -> dịch -> chỉnh sửa subtitle -> xuất file -> tạo audio lồng tiếng**.

## 1. Kiến trúc dự án

- `apps/api`: FastAPI + SQLAlchemy, cung cấp API và phục vụ web build khi chạy production.
- `apps/worker`: RQ worker xử lý job nền (pipeline OCR/dịch và dub audio).
- `apps/web`: React + Vite, giao diện quản lý project.
- `storage/projects`: nơi lưu video, subtitle và artifact theo từng project.
- `start-all.ps1` / `stop-all.ps1`: script chạy/tắt toàn bộ stack local trên Windows.

## 2. Yêu cầu hệ thống

### Bắt buộc

- Windows + PowerShell (khuyến nghị PowerShell 7+).
- Python 3.11 hoặc 3.12.
- Node.js 20+ và npm.
- Redis server (`redis-server.exe`) có trong `PATH` hoặc cài tại `C:\Program Files\Redis\redis-server.exe`.

### Khuyến nghị

- `ffmpeg` + `ffprobe` trong `PATH` để tạo file audio dub ổn định.
- Docker Desktop nếu muốn chạy Postgres/Redis/MinIO bằng `docker compose`.

## 3. Cấu hình môi trường

Từ thư mục gốc dự án:

```powershell
Copy-Item .env.example .env
```

Biến quan trọng trong `.env`:

- `DATABASE_URL`: mặc định Postgres local, có thể đổi sang SQLite.
- `REDIS_URL`: ví dụ `redis://localhost:6379/0`.
- `STORAGE_ROOT`: thư mục lưu dữ liệu project.
- `GEMINI_API_KEYS`: danh sách key, cách nhau bởi dấu phẩy.
- `DEFAULT_SOURCE_LANG`, `DEFAULT_TARGET_LANG`: ngôn ngữ mặc định.

## 4. Chạy nhanh (khuyên dùng trên Windows)

```powershell
.\start-all.ps1
```

Script sẽ tự:

- tạo/cài `.venv` cho backend,
- cài dependency web nếu chưa có,
- khởi động Redis (nếu chưa chạy), API, worker và frontend,
- kiểm tra health endpoint.

Địa chỉ truy cập:

- Web: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- API: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- Health: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

Dừng toàn bộ:

```powershell
.\stop-all.ps1
```

Log tiến trình nằm ở thư mục `logs/`.

## 5. Chạy thủ công (phục vụ debug)

### Bước 1: khởi động hạ tầng nền (tuỳ chọn)

Nếu dùng Docker cho Postgres/Redis/MinIO:

```powershell
docker compose up -d postgres redis minio
```

### Bước 2: chạy API

```powershell
cd apps/api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Bước 3: chạy worker

Mở terminal mới:

```powershell
cd apps/worker
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python worker.py
```

### Bước 4: chạy frontend

Mở terminal mới:

```powershell
cd apps/web
npm install
npm run dev
```

## 6. Cách sử dụng app

1. Tạo project mới trên giao diện web.
2. Upload video (hoặc ingest URL nếu luồng này được bật).
3. Thiết lập ROI OCR, prompt và glossary nếu cần.
4. Bấm **Start Pipeline** để chạy OCR + dịch.
5. Kiểm tra danh sách segment, chỉnh sửa subtitle thủ công.
6. Export subtitle theo định dạng mong muốn (`srt`, `vtt`, `csv`, `txt`, `json`).
7. Chạy dub từ SRT để xuất audio (`wav` hoặc `mp3`).

## 7. Gợi ý cấu hình thực tế

- Máy yếu hoặc không muốn chạy queue: app có fallback chạy local khi enqueue lỗi, nhưng vẫn nên chạy Redis + worker để ổn định.
- Ưu tiên `DATABASE_URL` dùng SQLite cho môi trường đơn giản:

```env
DATABASE_URL=sqlite+pysqlite:///./ocr.db
```

- Khi deploy 1 container (Railway hoặc tương tự), nên mount volume tại `/data` và đặt:

```env
DATABASE_URL=sqlite+pysqlite:////data/ocr.db
STORAGE_ROOT=/data/projects
```

## 8. Một số lỗi thường gặp

- `Khong tim thay redis-server.exe`: cài Redis hoặc thêm `redis-server.exe` vào `PATH`.
- Lỗi dub audio: kiểm tra `ffmpeg`/`ffprobe` đã cài và gọi được từ terminal.
- CORS/không gọi được API từ web: kiểm tra `WEB_ORIGIN` trong `.env`.
- Chạy pipeline chậm: giảm tần suất scan hoặc chạy trên máy có CPU/RAM tốt hơn.

## 9. Giấy phép và tuỳ biến

Bạn có thể đổi tên app, package, biến môi trường theo nhu cầu đội dự án. Nếu không có quy định đặt tên riêng, có thể dùng định danh `NanBao 男宝` để đồng bộ branding.

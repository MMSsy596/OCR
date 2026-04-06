# NanBao OCR Video Studio

README này hướng dẫn **cài đặt và chạy app step-by-step** trên Windows, ưu tiên dễ làm theo và kiểm tra được ngay sau mỗi bước.

## 1) Chuẩn bị trước khi cài

### 1.1 Cài phần mềm bắt buộc

1. Cài **Python 3.11 hoặc 3.12**.
2. Cài **Node.js 20+** (kèm npm).
3. Cài **Git** (để clone/pull code).
4. Cài **Redis for Windows** (hoặc Redis trong Docker).

### 1.2 Cài phần mềm khuyến nghị

1. Cài **Docker Desktop** (nếu muốn chạy Postgres/Redis/MinIO bằng Docker).
2. Cài **FFmpeg** (có `ffmpeg` và `ffprobe` trong PATH) để tạo audio dub ổn định.

### 1.3 Kiểm tra nhanh môi trường

Mở PowerShell tại thư mục bất kỳ, chạy:

```powershell
python --version
node --version
npm --version
docker --version
ffmpeg -version
ffprobe -version
```

Nếu lệnh nào báo lỗi "not found", cài bổ sung rồi mở lại terminal.

## 2) Lấy mã nguồn và mở đúng thư mục

```powershell
git clone <repo-url> D:\project\OCR
cd D:\project\OCR
```

Kiểm tra có các thư mục chính:

- `apps/api`
- `apps/worker`
- `apps/web`
- `storage/projects`

## 3) Tạo file cấu hình môi trường `.env`

### 3.1 Tạo `.env` từ mẫu

```powershell
Copy-Item .env.example .env
```

### 3.2 Mở `.env` và chỉnh các biến quan trọng

```env
APP_NAME=NanBao OCR Studio
API_HOST=0.0.0.0
API_PORT=8000
WEB_ORIGIN=http://localhost:5173

# Chọn 1 trong 2 DB:
# PostgreSQL local:
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/ocr
# Hoặc SQLite đơn giản:
# DATABASE_URL=sqlite+pysqlite:///./ocr.db

REDIS_URL=redis://localhost:6379/0
STORAGE_ROOT=../../storage/projects

# Nếu dùng Gemini, điền key (nhiều key ngăn cách dấu phẩy)
GEMINI_API_KEYS=

DEFAULT_SOURCE_LANG=zh
DEFAULT_TARGET_LANG=vi
```

Lưu ý:

- Nếu bạn muốn setup đơn giản nhất để test nhanh, dùng SQLite.
- Nếu chạy Docker Postgres thì giữ chuỗi Postgres như mẫu.

## 4) Cách chạy nhanh nhất (khuyên dùng)

Cách này dùng script có sẵn để tự cài dependency và mở toàn bộ stack.

### 4.1 Chạy script khởi động

Tại `D:\project\OCR`:

```powershell
.\start-all.ps1
```

Script sẽ tự làm:

1. Tạo thư mục `logs/`, `tmp/`.
2. Tạo `.venv` cho backend nếu chưa có.
3. Cài `pip install -r apps/api/requirements.txt`.
4. Cài `npm install` cho frontend nếu chưa có `node_modules`.
5. Khởi động Redis (nếu máy chưa có Redis đang chạy).
6. Khởi động API (`:8000`), worker, web (`:5173`).
7. Kiểm tra health endpoint.

### 4.2 Mở app

- Web: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- API health: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

### 4.3 Dừng app

```powershell
.\stop-all.ps1
```

## 5) Cách chạy thủ công (debug chi tiết từng service)

Dùng cách này khi bạn muốn theo dõi rõ từng tiến trình.

### Bước 1: khởi động Redis + DB

#### Phương án A: dùng Docker (dễ nhất)

```powershell
docker compose up -d postgres redis minio
```

Kiểm tra container:

```powershell
docker compose ps
```

#### Phương án B: Redis chạy local, DB dùng SQLite

- Đảm bảo Redis local đang chạy cổng `6379`.
- Đặt `DATABASE_URL=sqlite+pysqlite:///./ocr.db` trong `.env`.

### Bước 2: chạy API

Mở terminal 1:

```powershell
cd D:\project\OCR\apps\api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Kiểm tra:

- Truy cập [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
- Kỳ vọng nhận JSON: `{"ok": true}`

### Bước 3: chạy worker

Mở terminal 2:

```powershell
cd D:\project\OCR\apps\worker
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python worker.py
```

Nếu Redis chưa đúng cấu hình, worker sẽ báo lỗi và dừng. Khi đó kiểm tra lại `REDIS_URL`.

### Bước 4: chạy frontend

Mở terminal 3:

```powershell
cd D:\project\OCR\apps\web
npm install
npm run dev
```

Mở trình duyệt:

- [http://127.0.0.1:5173](http://127.0.0.1:5173)

## 6) Quy trình sử dụng app từ đầu đến cuối

### Bước 1: tạo project

- Vào web UI, tạo project mới.
- Chọn ngôn ngữ nguồn/đích nếu giao diện có hỗ trợ.

### Bước 2: nạp video

- Upload file video (`.mp4` hoặc định dạng tương đương).
- Hoặc dùng ingest URL nếu bạn bật luồng này.

### Bước 3: cấu hình OCR/dịch

- Chỉnh ROI (vùng đọc subtitle) để OCR chính xác hơn.
- Nhập prompt/glossary nếu muốn dịch theo văn phong riêng.
- Thêm Gemini key nếu muốn ưu tiên dịch Gemini.

### Bước 4: chạy pipeline

- Bấm **Start Pipeline**.
- Theo dõi trạng thái job.
- Khi xong, vào danh sách segment để rà lại nội dung.

### Bước 5: chỉnh sửa subtitle

- Sửa từng dòng subtitle trực tiếp trên UI.
- Lưu lại trước khi export.

### Bước 6: export file phụ đề

- Chọn định dạng: `srt`, `vtt`, `csv`, `txt`, `json`.
- Chọn mode nội dung: `raw`, `translated`, `bilingual`.
- Tải file export về.

### Bước 7: tạo audio dub từ SRT

- Chạy job dub.
- Chọn `voice`, `rate`, `volume`, `pitch`, định dạng `wav/mp3`.
- Tải artifact audio khi job hoàn tất.

## 7) Kiểm tra nhanh khi có lỗi

### Lỗi 1: không mở được web `:5173`

- Kiểm tra terminal frontend còn chạy không.
- Kiểm tra cổng bị chiếm:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen
```

### Lỗi 2: API không lên `:8000`

- Xem log API tại `logs/api-dev.err.log` (nếu dùng start-all).
- Kiểm tra `.env` có sai `DATABASE_URL` không.

### Lỗi 3: job đứng yên hoặc fail

- Kiểm tra Redis đang chạy cổng `6379`.
- Kiểm tra terminal worker có lỗi không.

### Lỗi 4: dub audio thất bại

- Kiểm tra `ffmpeg`/`ffprobe` đã cài và có trong PATH.

## 8) Lệnh hữu ích khi vận hành local

Tại thư mục `D:\project\OCR`:

```powershell
# Khởi động nhanh toàn bộ
.\start-all.ps1

# Dừng toàn bộ
.\stop-all.ps1

# Xem log API
Get-Content .\logs\api-dev.out.log -Tail 100

# Xem log worker
Get-Content .\logs\worker.out.log -Tail 100

# Xem log web
Get-Content .\logs\web-dev.out.log -Tail 100
```

## 9) Ghi chú đặt tên/thương hiệu

Nếu không có quy định riêng về naming (package, biến, username, bản quyền), bạn có thể dùng định danh: **NanBao 男宝**.

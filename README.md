# NanBao OCR Studio 男宝

> Ứng dụng trích xuất subtitle từ video bằng OCR / ASR, tự động dịch và tạo audio dub.

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Kiến trúc hệ thống](#2-kiến-trúc-hệ-thống)
3. [Chức năng chính](#3-chức-năng-chính)
4. [Kết quả đầu ra](#4-kết-quả-đầu-ra)
5. [Yêu cầu hệ thống](#5-yêu-cầu-hệ-thống)
6. [Cài đặt](#6-cài-đặt)
7. [Cấu hình môi trường](#7-cấu-hình-môi-trường)
8. [Chạy ứng dụng](#8-chạy-ứng-dụng)
9. [Hướng dẫn sử dụng từng bước](#9-hướng-dẫn-sử-dụng-từng-bước)
10. [API Reference nhanh](#10-api-reference-nhanh)
11. [Xử lý lỗi thường gặp](#11-xử-lý-lỗi-thường-gặp)
12. [Lệnh vận hành hữu ích](#12-lệnh-vận-hành-hữu-ích)

---

## 1. Tổng quan

**NanBao OCR Studio** là một web application chạy local (hoặc self-hosted) giúp:

- **Trích xuất subtitle** từ video bằng 2 phương thức:
  - 🖼 **OCR** (đọc chữ hiển thị trên khung hình) — dùng RapidOCR + OpenCV
  - 🎙 **ASR** (nhận diện giọng nói) — dùng Whisper CLI + FFmpeg
- **Tự động dịch** subtitle sang ngôn ngữ đích (Gemini API ưu tiên, fallback sang Deep Translator)
- **Chỉnh sửa subtitle** thủ công ngay trên giao diện web
- **Export** phụ đề ra nhiều định dạng: SRT, VTT, CSV, TXT, JSON
- **Tạo audio dub** từ file SRT bằng Edge TTS / gTTS / pyttsx3

---

## 2. Kiến trúc hệ thống

```
D:\project\OCR
├── apps/
│   ├── api/          # Backend FastAPI (Python)
│   │   └── app/
│   │       ├── main.py       # Router, middleware, endpoint
│   │       ├── pipeline.py   # Pipeline OCR / ASR / dịch
│   │       ├── tts_dubber.py # Audio dub
│   │       ├── exporter.py   # Export SRT/VTT/CSV/TXT/JSON
│   │       ├── downloader.py # Ingest video từ URL (yt-dlp)
│   │       ├── models.py     # SQLAlchemy models
│   │       ├── schemas.py    # Pydantic schemas
│   │       ├── crud.py       # DB operations
│   │       ├── db.py         # Database session
│   │       ├── auth.py       # API token auth
│   │       ├── settings.py   # Cấu hình từ .env
│   │       ├── queue.py      # RQ queue
│   │       └── job_state.py  # Trạng thái job realtime
│   │
│   ├── web/          # Frontend React + Vite
│   │   └── src/
│   │       ├── App.jsx       # Main app, routing wizard
│   │       ├── components/   # UI components
│   │       ├── hooks/        # Custom hooks
│   │       └── styles.css    # Dark theme CSS
│   │
│   └── worker/       # RQ Worker (chạy job nền)
│       └── worker.py
│
├── storage/          # Lưu file video + output
│   └── projects/
├── logs/             # Log file API, worker, web
├── .env              # Biến môi trường (tạo từ .env.example)
├── docker-compose.yml
├── start-all.ps1     # Script khởi động toàn bộ stack
└── stop-all.ps1      # Script dừng toàn bộ
```

**Luồng dữ liệu:**

```
Upload Video / URL
      ↓
  [API :8000]  ──────→  [DB: SQLite / PostgreSQL]
      ↓
  Background Thread / RQ Worker
      ↓
  Pipeline (OCR hoặc ASR)
      ↓
  Dịch (Gemini → Deep Translator fallback)
      ↓
  Lưu Segment vào DB
      ↓
  Frontend poll / SSE stream
      ↓
  Chỉnh sửa → Export / Dub Audio
```

---

## 3. Chức năng chính

### 3.1 Quản lý Project
- Tạo, xem danh sách, cập nhật project
- Mỗi project có: tên, ngôn ngữ nguồn/đích, ROI (vùng OCR), prompt dịch, glossary
- Xóa hàng loạt session cũ

### 3.2 Nạp video
| Phương thức | Mô tả |
|---|---|
| **Upload file** | Upload trực tiếp `.mp4`, `.mov`, `.mkv`, `.avi`, `.webm`, `.m4v` |
| **Ingest URL** | Nhập URL YouTube / TikTok / bất kỳ, hệ thống tự tải về bằng `yt-dlp` |
| **Upload SRT thủ công** | Upload file `.srt` sẵn có để dùng làm nguồn dịch |

### 3.3 Pipeline xử lý

**Chế độ OCR (Video OCR)**
- Đọc từng khung hình theo `scan_interval_sec` (mặc định 1s)
- Crop theo ROI (vùng subtitle cài đặt)
- Thử nhiều preprocessing variant: grayscale, upscale, Gaussian blur, Otsu, CLAHE
- Chọn kết quả OCR tốt nhất theo score
- Gộp các segment liền kề, trùng nội dung
- Tự động giới hạn sample nếu video dài (tối đa 1600 frames)

**Chế độ ASR (Audio Recognition)**
- Dùng `ffmpeg` để cắt audio → WAV 16kHz mono
- Hỗ trợ chia chunk video dài (chunk_sec, overlap_sec)
- Chạy `whisper` CLI để nhận diện giọng nói → SRT
- Parse SRT → segment

**Dịch thuật**
- Ưu tiên **Gemini API** (`gemini-2.5-flash-lite`) với context trước/sau để dịch tự nhiên
- Fallback sang **Deep Translator** (Google Translate free) nếu không có Gemini key
- Hỗ trợ **Glossary** (từ điển riêng): `从=từ`, `他=anh ấy`...
- Hỗ trợ **Prompt** tùy chỉnh: phong cách dịch, thuật ngữ chuyên ngành

### 3.4 Theo dõi tiến trình
- **Server-Sent Events (SSE)**: `/projects/{id}/stream` — frontend nhận cập nhật realtime mỗi 2 giây
- Xem trạng thái job: `queued` → `running` → `done` / `failed`
- Xem `progress %`, `step` hiện tại, log event

### 3.5 Chỉnh sửa subtitle
- Chỉnh sửa từng dòng `raw_text` (gốc) và `translated_text` (dịch) ngay trên web
- Lưu thay đổi về DB qua API
- **Re-translate**: dịch lại toàn bộ segment mà không cần chạy lại pipeline

### 3.6 Export phụ đề

| Định dạng | Mô tả |
|---|---|
| **SRT** | Định dạng subtitle chuẩn, dùng được với VLC, MKV |
| **VTT** | WebVTT, dùng cho trình duyệt web |
| **CSV** | Bảng tính, tiện phân tích |
| **TXT** | Plain text, dễ đọc |
| **JSON** | Dữ liệu có cấu trúc, dùng cho tích hợp khác |

Mỗi định dạng có 3 mode nội dung: `raw` (gốc), `translated` (dịch), `bilingual` (song ngữ)

### 3.7 Tạo audio dub (TTS)
- Nhận file SRT làm đầu vào
- Chọn **giọng đọc** (Edge TTS voices), **tốc độ**, **âm lượng**, **pitch**
- Xuất ra file `wav` hoặc `mp3`
- Hỗ trợ tùy chọn `match_video_duration`: căn thời lượng dub theo video gốc

### 3.8 Retry / Recovery
- Phát hiện job bị "kẹt" ở trạng thái `queued` quá lâu (stale timeout: 180s)
- API `POST /projects/{id}/jobs/retry-stuck`: tạo lại job mới từ payload cũ

---

## 4. Kết quả đầu ra

Sau khi pipeline hoàn tất, bạn nhận được:

```
storage/projects/{project_id}/
├── source.mp4              # Video gốc đã upload
├── manual.raw.srt          # Export SRT ngôn ngữ gốc
├── manual.translated.srt   # Export SRT đã dịch
├── manual.bilingual.srt    # Export SRT song ngữ
├── manual.translated.vtt   # Export VTT
├── manual.translated.csv   # Export CSV
├── manual.translated.json  # Export JSON
└── output_dub.wav          # Audio dub (nếu đã chạy TTS)
```

Các file có thể tải về trực tiếp từ giao diện web hoặc qua API endpoint download.

---

## 5. Yêu cầu hệ thống

### Bắt buộc
| Phần mềm | Phiên bản | Ghi chú |
|---|---|---|
| **Python** | 3.11 hoặc 3.12 | Python 3.13 chưa được kiểm tra |
| **Node.js** | 20+ | Kèm npm |
| **Redis** | 6+ | Hàng đợi job nền |

### Khuyến nghị (để dùng đầy đủ tính năng)
| Phần mềm | Mục đích |
|---|---|
| **Docker Desktop** | Chạy PostgreSQL / Redis / MinIO bằng container |
| **FFmpeg + ffprobe** | Cắt audio cho chế độ ASR, tạo audio dub |
| **Whisper CLI** | Nhận diện giọng nói (`pip install openai-whisper`) |
| **CUDA / GPU ONNX** | Tăng tốc OCR nếu có GPU NVIDIA |

### Kiểm tra môi trường

Mở PowerShell, chạy từng lệnh:

```powershell
python --version    # Python 3.11.x hoặc 3.12.x
node --version      # v20.x.x trở lên
npm --version       # 9.x.x trở lên
docker --version    # Docker version 24+
ffmpeg -version     # ffmpeg version ...
ffprobe -version    # ffprobe version ...
whisper --help      # nếu đã cài openai-whisper
```

---

## 6. Cài đặt

### Bước 1 — Lấy mã nguồn

```powershell
git clone <repo-url> D:\project\OCR
```

Hoặc nếu đã có code:

```powershell
cd D:\project\OCR
```

Kiểm tra có đủ thư mục:

```
apps/api/
apps/web/
apps/worker/
storage/projects/   ← tự tạo nếu chưa có
```

### Bước 2 — Cài Python dependencies (backend)

```powershell
cd D:\project\OCR\apps\api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**Các thư viện chính được cài:**

| Thư viện | Mục đích |
|---|---|
| `fastapi` + `uvicorn` | Web framework + ASGI server |
| `sqlalchemy` + `psycopg` | ORM + PostgreSQL driver |
| `pydantic-settings` | Đọc cấu hình từ `.env` |
| `opencv-python` | Đọc frame video |
| `rapidocr-onnxruntime` | Engine OCR |
| `deep-translator` | Dịch tự động (Google free) |
| `edge-tts` | Text-to-speech chất lượng cao |
| `yt-dlp` | Tải video từ URL |
| `redis` + `rq` | Hàng đợi job nền |

### Bước 3 — Cài Node.js dependencies (frontend)

```powershell
cd D:\project\OCR\apps\web
npm install
```

### Bước 4 — Cài Redis

**Phương án A: Docker (khuyên dùng)**

```powershell
cd D:\project\OCR
docker compose up -d redis
```

**Phương án B: Redis native trên Windows**
- Tải [Redis for Windows](https://github.com/microsoftarchive/redis/releases) và cài đặt
- Hoặc cài qua WSL2

---

## 7. Cấu hình môi trường

### Tạo file `.env`

```powershell
Copy-Item D:\project\OCR\.env.example D:\project\OCR\.env
```

### Chỉnh sửa file `.env`

```env
# ──── Ứng dụng ────────────────────────────────────
APP_NAME=NanBao OCR Studio
API_HOST=0.0.0.0
API_PORT=8000
WEB_ORIGIN=http://localhost:5173

# ──── Database ────────────────────────────────────
# Chọn 1 trong 2:

# Option A: SQLite (đơn giản nhất, không cần cài gì thêm)
DATABASE_URL=sqlite+pysqlite:///./ocr.db

# Option B: PostgreSQL (Docker hoặc local)
# DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5434/ocr

# ──── Redis ───────────────────────────────────────
REDIS_URL=redis://localhost:6379/0

# ──── Storage ─────────────────────────────────────
STORAGE_ROOT=../../storage/projects

# ──── Dịch thuật ──────────────────────────────────
# Điền Gemini API key để dùng dịch chất lượng cao
# Có thể điền nhiều key cách nhau dấu phẩy (sẽ xoay vòng)
GEMINI_API_KEYS=AIza...

# Ngôn ngữ mặc định
DEFAULT_SOURCE_LANG=zh   # zh = Tiếng Trung
DEFAULT_TARGET_LANG=vi   # vi = Tiếng Việt

# ──── Bảo mật (để trống khi dev local) ───────────
# API_TOKEN=your-secret-token

# ──── MinIO (tùy chọn, dùng nếu cần object storage) ──
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=ocr-assets
```

> **Ghi chú:** Khi dev local, để `API_TOKEN` trống — không cần xác thực. Chỉ bật khi deploy lên server.

---

## 8. Chạy ứng dụng

### Cách 1: Script tự động (khuyên dùng cho lần đầu)

```powershell
cd D:\project\OCR
.\start-all.ps1
```

Script sẽ tự động:
1. Tạo thư mục `logs/`, `tmp/`, `storage/projects/`
2. Tạo `.venv` Python nếu chưa có
3. Cài `pip install -r requirements.txt`
4. Cài `npm install` cho frontend
5. Khởi động Redis (nếu chưa có)
6. Khởi động **API** tại `:8000`
7. Khởi động **Worker** (job nền)
8. Khởi động **Web** tại `:5173`
9. Kiểm tra health endpoint tự động

**Dừng tất cả:**

```powershell
.\stop-all.ps1
```

---

### Cách 2: Chạy thủ công từng service

#### Terminal 1 — Khởi động infrastructure

```powershell
# Dùng Docker (cần Docker Desktop đang chạy)
cd D:\project\OCR
docker compose up -d postgres redis minio

# Kiểm tra containers đang chạy
docker compose ps
```

#### Terminal 2 — Chạy API backend

```powershell
cd D:\project\OCR\apps\api
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Kiểm tra: mở http://127.0.0.1:8000/health → phải trả về `{"ok": true}`

Xem Swagger docs: http://127.0.0.1:8000/docs

#### Terminal 3 — Chạy Worker (job nền)

```powershell
cd D:\project\OCR\apps\worker
.\.venv\Scripts\Activate.ps1

# Nếu worker venv chưa có, cài trước:
pip install -r requirements.txt

python worker.py
```

> **Lưu ý:** Trên Windows, worker dùng `SimpleWorker` (không fork process) — hoàn toàn bình thường.  
> Nếu Redis không khả dụng, API sẽ tự fallback chạy job bằng **background thread** trong process.

#### Terminal 4 — Chạy Frontend

```powershell
cd D:\project\OCR\apps\web
npm run dev
```

---

### Cách 3: Docker toàn bộ (production-like)

```powershell
cd D:\project\OCR

# Build image
docker build -t nanbao-ocr-api .
docker build -f Dockerfile.web -t nanbao-ocr-web .

# Chạy toàn bộ stack
docker compose up
```

---

### Kiểm tra sau khi khởi động

| Service | URL | Kết quả mong đợi |
|---|---|---|
| **Web UI** | http://127.0.0.1:5173 | Giao diện dark mode NanBao OCR |
| **API Health** | http://127.0.0.1:8000/health | `{"ok": true, "environment": "development"}` |
| **API Docs** | http://127.0.0.1:8000/docs | Swagger UI với toàn bộ endpoint |
| **Runtime Info** | http://127.0.0.1:8000/runtime/capabilities | Kiểm tra ffmpeg, whisper có sẵn không |

---

## 9. Hướng dẫn sử dụng từng bước

### Bước 1 — Tạo Project

1. Mở http://127.0.0.1:5173
2. Bấm **"New Project"** hoặc **"Tạo project mới"**
3. Nhập tên project
4. Chọn ngôn ngữ nguồn (ví dụ: `zh` - Tiếng Trung) và ngôn ngữ đích (`vi` - Tiếng Việt)

### Bước 2 — Nạp video

**Phương thức A — Upload file:**
- Kéo thả hoặc chọn file video (`.mp4`, `.mov`, `.mkv`, `.avi`, `.webm`)
- Chờ upload hoàn tất (thanh tiến trình)

**Phương thức B — Ingest từ URL:**
- Dán URL YouTube / TikTok / ...
- Bấm **"Ingest URL"**
- Hệ thống dùng `yt-dlp` tự tải về

### Bước 3 — Cấu hình pipeline

**Cài đặt ROI (vùng OCR):**
- Điều chỉnh ô chọn vùng xem subtitle trên frame preview
- ROI mặc định: toàn bộ phần dưới màn hình — phù hợp video có subtitle ở dưới
- Kéo/thu nhỏ để chỉ bao vùng chữ cần đọc → tăng độ chính xác OCR

**Chọn chế độ xử lý:**
- `video_ocr` — OCR từ khung hình (phù hợp video có subtitle hard-sub)
- `audio_asr` — Nhận diện giọng nói (cần `ffmpeg` + `whisper`)

**Cài đặt dịch:**
- Nhập **Gemini API Key** nếu có (dịch chất lượng cao hơn)
- Nhập **Prompt** tùy chỉnh: ví dụ "Dịch theo văn phong anime, giữ nguyên tên nhân vật"
- Nhập **Glossary** (một dòng một từ): ví dụ `主人公=nhân vật chính`

**Tùy chọn OCR nâng cao:**
- `scan_interval_sec`: khoảng cách giữa 2 frame scan (mặc định 1.0s)

**Tùy chọn ASR nâng cao:**
- `audio_provider`: hiện chỉ hỗ trợ `whisper_cli`
- `audio_asr_model`: `tiny`, `base`, `small`, `medium`, `large`
- `audio_asr_language`: ngôn ngữ nguồn (ví dụ `zh`, `ja`, `en`)
- `audio_chunk_sec`: chia video dài thành chunk (mặc định 600s)

### Bước 4 — Chạy Pipeline

1. Bấm **"Start Pipeline"**
2. Theo dõi tiến trình realtime:
   - Thanh progress %
   - Tên bước hiện tại: `ocr_extract`, `translate`, `save_segments`, `done`...
3. Khi pipeline hoàn tất → các segment subtitle xuất hiện bên dưới

### Bước 5 — Chỉnh sửa subtitle

- Click vào từng dòng để sửa `raw_text` (văn bản gốc) hoặc `translated_text` (bản dịch)
- Bấm **"Save"** để lưu thay đổi
- Nếu muốn dịch lại toàn bộ mà không chạy pipeline: bấm **"Re-translate"**

### Bước 6 — Export phụ đề

1. Chọn **định dạng export**: `SRT`, `VTT`, `CSV`, `TXT`, `JSON`
2. Chọn **mode nội dung**:
   - `raw` — Chỉ văn bản gốc
   - `translated` — Chỉ bản dịch
   - `bilingual` — Song ngữ (gốc + dịch)
3. Bấm **"Export"** → tải file về

### Bước 7 — Tạo Audio Dub (TTS) *(tuỳ chọn)*

1. Chuyển sang tab **"Dub"**
2. Chọn file SRT nguồn (đã export ở bước 6)
3. Cấu hình:
   - **Voice**: ví dụ `vi-VN-HoaiMyNeural` (Edge TTS)
   - **Rate**: tốc độ đọc (`+0%`, `+10%`, `-5%`...)
   - **Volume**: âm lượng
   - **Pitch**: cao độ giọng
   - **Format**: `wav` hoặc `mp3`
4. Bấm **"Start Dub"**
5. Chờ job hoàn tất → tải file audio về

---

## 10. API Reference nhanh

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/health` | Kiểm tra server còn sống |
| `GET` | `/runtime/capabilities` | Kiểm tra ffmpeg, whisper |
| `POST` | `/projects` | Tạo project mới |
| `GET` | `/projects` | Danh sách project |
| `GET` | `/projects/{id}` | Chi tiết project |
| `PATCH` | `/projects/{id}` | Cập nhật project |
| `POST` | `/projects/{id}/upload` | Upload video |
| `POST` | `/projects/{id}/ingest-url/start` | Ingest từ URL |
| `POST` | `/projects/{id}/srt/upload` | Upload SRT thủ công |
| `GET` | `/projects/{id}/video` | Stream video |
| `POST` | `/projects/{id}/pipeline/start` | Bắt đầu pipeline OCR/ASR |
| `POST` | `/projects/{id}/dub/start` | Bắt đầu tạo audio dub |
| `GET` | `/projects/{id}/segments` | Lấy danh sách segment |
| `PUT` | `/projects/{id}/segments` | Lưu chỉnh sửa segment |
| `POST` | `/projects/{id}/segments/retranslate` | Dịch lại toàn bộ |
| `POST` | `/projects/{id}/export` | Export phụ đề |
| `GET` | `/projects/{id}/exports/{key}` | Tải file export |
| `GET` | `/projects/{id}/jobs` | Danh sách job |
| `POST` | `/projects/{id}/jobs/retry-stuck` | Retry job bị stuck |
| `GET` | `/jobs/{job_id}` | Trạng thái job |
| `GET` | `/jobs/{job_id}/artifact/{key}` | Tải artifact job |
| `GET` | `/projects/{id}/stream` | SSE stream realtime |

Xem chi tiết tại: http://127.0.0.1:8000/docs

---

## 11. Xử lý lỗi thường gặp

### ❌ Web không mở được `:5173`

```powershell
# Kiểm tra cổng có ai chiếm không
Get-NetTCPConnection -LocalPort 5173 -State Listen

# Kiểm tra terminal web có đang chạy không, nếu không thì chạy lại
cd D:\project\OCR\apps\web && npm run dev
```

### ❌ API không lên `:8000`

```powershell
# Xem log lỗi
Get-Content D:\project\OCR\logs\api-dev.err.log -Tail 50

# Kiểm tra thường gặp:
# - DATABASE_URL sai → sửa trong .env
# - Port 8000 bị chiếm bởi app khác
Get-NetTCPConnection -LocalPort 8000 -State Listen
```

### ❌ Job đứng yên không chạy

```powershell
# Kiểm tra Redis đang chạy
redis-cli ping   # Kết quả: PONG

# Hoặc qua docker
docker compose ps redis

# Xem log worker
Get-Content D:\project\OCR\logs\worker.out.log -Tail 50
```

> **Lưu ý:** Nếu Redis không khả dụng, API sẽ tự chạy job bằng background thread. Job vẫn chạy nhưng mất khi API restart.

### ❌ OCR trả về rỗng / không có subtitle

- Kiểm tra video có subtitle **hard-coded** (in lên frame) — chế độ OCR chỉ đọc được loại này
- Thử thu nhỏ ROI để chỉ bao vùng subtitle thay vì cả màn hình
- Thử tăng `scan_interval_sec` (ví dụ từ 1.0 → 0.5) để scan dày hơn

### ❌ Lỗi Audio Dub thất bại

```powershell
# Kiểm tra ffmpeg và ffprobe có trong PATH
ffmpeg -version
ffprobe -version

# Nếu chưa cài:
# Tải từ https://ffmpeg.org/download.html
# Giải nén và thêm đường dẫn vào PATH hệ thống
```

### ❌ `rapidocr` lỗi `KeyError("model_path")` trên Windows

Pipeline tự xử lý bằng fallback `RapidOCR()` mặc định — OCR vẫn chạy bình thường.

### ❌ `psycopg` không cài được

Nếu dùng SQLite, không cần `psycopg`. Xóa dòng `psycopg[binary]` trong `requirements.txt` hoặc cài riêng:

```powershell
pip install psycopg[binary]
```

---

## 12. Lệnh vận hành hữu ích

```powershell
# Tại D:\project\OCR

# Khởi động toàn bộ
.\start-all.ps1

# Dừng toàn bộ
.\stop-all.ps1

# Xem log realtime
Get-Content .\logs\api-dev.out.log -Tail 100 -Wait
Get-Content .\logs\worker.out.log -Tail 100 -Wait
Get-Content .\logs\web-dev.out.log -Tail 100 -Wait

# Kiểm tra API health
Invoke-RestMethod http://127.0.0.1:8000/health

# Kiểm tra capabilities (ffmpeg, whisper)
Invoke-RestMethod http://127.0.0.1:8000/runtime/capabilities

# Xem danh sách project
Invoke-RestMethod http://127.0.0.1:8000/projects

# Reset hoàn toàn (xóa DB SQLite + storage)
Remove-Item D:\project\OCR\apps\api\ocr.db -ErrorAction SilentlyContinue
Remove-Item D:\project\OCR\storage\projects\* -Recurse -Force -ErrorAction SilentlyContinue

# Kiểm tra cổng đang dùng
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in @(8000, 5173, 6379, 5432)
```

---

## Nhãn hiệu / Branding

**NanBao OCR Studio** — 男宝

Định danh package, log, và thương hiệu: `nanbao` / `NanBao`

---

*README được cập nhật lần cuối: Tháng 4/2026*

# Hướng Dẫn Cài Đặt Nhanh

Để cài đặt và chạy ứng dụng nhanh nhất, bạn chỉ cần cài đặt **Docker** và sử dụng file cấu hình bên dưới.

## Bước 1: Cài đặt Docker
Nếu máy bạn chưa có Docker, hãy tải và cài đặt [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Hỗ trợ Windows, Mac, Linux).

## Bước 2: Khởi chạy ứng dụng

1. Tạo một thư mục bất kỳ trên máy tính của bạn (Ví dụ: `ocr_app`).
2. Trong thư mục đó, tạo một file có tên chính xác là `docker-compose.yml`.
3. Copy và dán toàn bộ nội dung sau vào file `docker-compose.yml`:

```yaml
version: '3.8'

services:
  redis:
    image: redis:7
    container_name: nanbao-ocr-redis
    restart: unless-stopped
    ports:
      - "6379:6379"

  app:
    image: nanbao/ocr:tagname
    container_name: nanbao-ocr-app
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - PORT=8000
      - WEB_ORIGIN=http://localhost:8000
      - ALLOWED_HOSTS=localhost,127.0.0.1
      - ENABLE_DOCS=true
      - DATABASE_URL=sqlite+pysqlite:////data/ocr.db
      - REDIS_URL=redis://redis:6379/0
      - STORAGE_ROOT=/data/projects
      # - GEMINI_API_KEYS=your_api_key_here
    volumes:
      - app_data:/data
    depends_on:
      - redis

volumes:
  app_data:
```

4. Mở **Terminal** (CMD hoặc PowerShell) ngay tại thư mục chứa file `docker-compose.yml` vừa tạo, và chạy lệnh:
   ```bash
   docker compose up -d
   ```

## Bước 3: Sử dụng
Sau khi lệnh chạy xong (Docker báo `Started`), hãy chờ vài giây để hệ thống khởi động. 
Mở trình duyệt web của bạn và truy cập vào:
👉 **[http://localhost:8000](http://localhost:8000)**

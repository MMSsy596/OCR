$ErrorActionPreference = "Stop"

Write-Host "=== Khởi tạo môi trường local NanBao OCR ==="

if (-not (Test-Path "..\\.env")) {
  Copy-Item "..\\.env.example" "..\\.env"
  Write-Host "Đã tạo file .env từ .env.example"
}

Push-Location ..
docker compose up -d redis
Pop-Location

Write-Host "Đã khởi động dịch vụ:"
Write-Host "- Redis: localhost:6379"

Write-Host ""
Write-Host "Chạy API:"
Write-Host "  cd apps/api"
Write-Host "  python -m venv .venv"
Write-Host "  .venv\\Scripts\\activate"
Write-Host "  pip install -r requirements.txt"
Write-Host "  uvicorn app.main:app --reload --port 8000"

Write-Host ""
Write-Host "Chạy Worker:"
Write-Host "  cd apps/worker"
Write-Host "  python -m venv .venv"
Write-Host "  .venv\\Scripts\\activate"
Write-Host "  pip install -r requirements.txt"
Write-Host "  python worker.py"

Write-Host ""
Write-Host "Chạy Web:"
Write-Host "  cd apps/web"
Write-Host "  npm install"
Write-Host "  npm run dev"

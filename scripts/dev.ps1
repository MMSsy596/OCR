$ErrorActionPreference = "Stop"

Write-Host "=== NanBao OCR local bootstrap ==="

if (-not (Test-Path "..\\.env")) {
  Copy-Item "..\\.env.example" "..\\.env"
  Write-Host "Created .env from .env.example"
}

Push-Location ..
docker compose up -d postgres redis minio
Pop-Location

Write-Host "Services started:"
Write-Host "- Postgres: localhost:5432"
Write-Host "- Redis: localhost:6379"
Write-Host "- MinIO API: localhost:9000"
Write-Host "- MinIO Console: localhost:9001"

Write-Host ""
Write-Host "Run API:"
Write-Host "  cd apps/api"
Write-Host "  python -m venv .venv"
Write-Host "  .venv\\Scripts\\activate"
Write-Host "  pip install -r requirements.txt"
Write-Host "  uvicorn app.main:app --reload --port 8000"

Write-Host ""
Write-Host "Run Worker:"
Write-Host "  cd apps/worker"
Write-Host "  python -m venv .venv"
Write-Host "  .venv\\Scripts\\activate"
Write-Host "  pip install -r requirements.txt"
Write-Host "  python worker.py"

Write-Host ""
Write-Host "Run Web:"
Write-Host "  cd apps/web"
Write-Host "  npm install"
Write-Host "  npm run dev"


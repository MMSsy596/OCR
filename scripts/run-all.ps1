$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$apiDir = Join-Path $root "apps\api"
$workerDir = Join-Path $root "apps\worker"
$webDir = Join-Path $root "apps\web"
$logDir = Join-Path $root "logs"

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Stop-PortProcess {
  param([int]$Port)
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($null -eq $connections) { return }
  $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}

function Ensure-ApiEnv {
  Set-Location $apiDir
  if (-not (Test-Path ".venv\Scripts\python.exe")) {
    python -m venv .venv
  }
  & ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
  & ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
}

function Ensure-WorkerEnv {
  Set-Location $workerDir
  if (-not (Test-Path ".venv\Scripts\python.exe")) {
    python -m venv .venv
  }
  & ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
  & ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
}

function Ensure-WebEnv {
  Set-Location $webDir
  if (-not (Test-Path "node_modules")) {
    npm install
  }
}

Write-Host "Preparing environments..."
Ensure-ApiEnv
Ensure-WorkerEnv
Ensure-WebEnv

Write-Host "Stopping old processes on ports 8000 and 5173..."
Stop-PortProcess -Port 8000
Stop-PortProcess -Port 5173

$apiOut = Join-Path $logDir "api.out.log"
$apiErr = Join-Path $logDir "api.err.log"
$webOut = Join-Path $logDir "web.out.log"
$webErr = Join-Path $logDir "web.err.log"
$workerOut = Join-Path $logDir "worker.out.log"
$workerErr = Join-Path $logDir "worker.err.log"

Write-Host "Starting backend..."
$apiProc = Start-Process -FilePath (Join-Path $apiDir ".venv\Scripts\python.exe") `
  -ArgumentList "-m uvicorn app.main:app --host 0.0.0.0 --port 8000" `
  -WorkingDirectory $apiDir `
  -RedirectStandardOutput $apiOut `
  -RedirectStandardError $apiErr `
  -PassThru

Write-Host "Starting frontend..."
$webProc = Start-Process -FilePath "npm.cmd" `
  -ArgumentList "run dev" `
  -WorkingDirectory $webDir `
  -RedirectStandardOutput $webOut `
  -RedirectStandardError $webErr `
  -PassThru

Write-Host "Starting worker..."
$workerProc = Start-Process -FilePath (Join-Path $workerDir ".venv\Scripts\python.exe") `
  -ArgumentList "worker.py" `
  -WorkingDirectory $workerDir `
  -RedirectStandardOutput $workerOut `
  -RedirectStandardError $workerErr `
  -PassThru

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Started successfully:"
Write-Host "Backend PID: $($apiProc.Id) - http://localhost:8000"
Write-Host "Frontend PID: $($webProc.Id) - http://localhost:5173"
Write-Host "Worker PID: $($workerProc.Id)"
Write-Host ""
Write-Host "Logs:"
Write-Host "  $apiOut"
Write-Host "  $apiErr"
Write-Host "  $webOut"
Write-Host "  $webErr"
Write-Host "  $workerOut"
Write-Host "  $workerErr"
Write-Host ""
Write-Host "To stop:"
Write-Host "  Stop-Process -Id $($apiProc.Id),$($webProc.Id),$($workerProc.Id) -Force"

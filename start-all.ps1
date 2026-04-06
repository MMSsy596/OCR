$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$apiDir = Join-Path $root "apps\api"
$workerDir = Join-Path $root "apps\worker"
$webDir = Join-Path $root "apps\web"
$logDir = Join-Path $root "logs"
$tmpDir = Join-Path $root "tmp"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

function Write-Info {
  param([string]$Message)
  Write-Host "[start-all] $Message"
}

function Get-PythonExe {
  $candidates = @(
    (Join-Path $apiDir ".venv\Scripts\python.exe"),
    "C:\Python312\python.exe",
    "python.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }
  return "python.exe"
}

function Get-NodeExe {
  $candidates = @(
    "C:\Program Files\nodejs\node.exe",
    "node.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -eq "node.exe") {
      return $candidate
    }
    if (Test-Path $candidate) {
      return $candidate
    }
  }
  return "node.exe"
}

function Get-RedisExe {
  $command = Get-Command redis-server.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  $candidates = @(
    "C:\Program Files\Redis\redis-server.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }
  throw "Không tìm thấy redis-server.exe"
}

function Ensure-ApiEnv {
  $pythonExe = Get-PythonExe
  $venvPython = Join-Path $apiDir ".venv\Scripts\python.exe"
  if (-not (Test-Path $venvPython)) {
    Write-Info "Tạo môi trường Python tại apps\\api\\.venv"
    & $pythonExe -m venv (Join-Path $apiDir ".venv")
  }
  Write-Info "Cài dependency backend/worker"
  & $venvPython -m pip install -r (Join-Path $apiDir "requirements.txt") | Out-Host
}

function Ensure-WebEnv {
  if (-not (Test-Path (Join-Path $webDir "node_modules"))) {
    Write-Info "Cài dependency frontend"
    Push-Location $webDir
    npm.cmd install | Out-Host
    Pop-Location
  }
}

function Stop-ListeningPort {
  param([int]$Port)
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($null -eq $connections) {
    return
  }
  $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}

function Start-BackgroundProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string]$Arguments,
    [string]$WorkingDirectory,
    [string]$PidFile
  )

  $outLog = Join-Path $logDir "$Name.out.log"
  $errLog = Join-Path $logDir "$Name.err.log"

  $proc = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru
  Start-Sleep -Seconds 3
  if ($proc.HasExited) {
    $stdout = if (Test-Path $outLog) { Get-Content $outLog -Raw } else { "" }
    $stderr = if (Test-Path $errLog) { Get-Content $errLog -Raw } else { "" }
    throw "Không khởi động được $Name. ExitCode=$($proc.ExitCode)`n$stdout`n$stderr"
  }

  Set-Content -Path $PidFile -Value $proc.Id
  [PSCustomObject]@{
    Name = $Name
    Id = $proc.Id
    OutLog = $outLog
    ErrLog = $errLog
  }
}

Ensure-ApiEnv
Ensure-WebEnv

$pythonExe = Join-Path $apiDir ".venv\Scripts\python.exe"
$nodeExe = Get-NodeExe
$redisExe = Get-RedisExe

Write-Info "Dọn cổng cũ 5173 và 8000"
Stop-ListeningPort -Port 5173
Stop-ListeningPort -Port 8000

$redisPort = Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue
if ($null -eq $redisPort) {
  Write-Info "Khởi động Redis"
  $redisInfo = Start-BackgroundProcess `
    -Name "redis" `
    -FilePath $redisExe `
    -Arguments "--port 6379 --save \"\"" `
    -WorkingDirectory $root `
    -PidFile (Join-Path $logDir "redis.pid")
} else {
  Write-Info "Redis đã chạy sẵn trên cổng 6379"
}

Write-Info "Khởi động API"
$apiInfo = Start-BackgroundProcess `
  -Name "api-dev" `
  -FilePath $pythonExe `
  -Arguments "-m uvicorn app.main:app --host 0.0.0.0 --port 8000" `
  -WorkingDirectory $apiDir `
  -PidFile (Join-Path $logDir "api-dev.pid")

Write-Info "Khởi động worker"
$workerInfo = Start-BackgroundProcess `
  -Name "worker" `
  -FilePath $pythonExe `
  -Arguments "worker.py" `
  -WorkingDirectory $workerDir `
  -PidFile (Join-Path $logDir "worker.pid")

Write-Info "Khởi động frontend"
$webInfo = Start-BackgroundProcess `
  -Name "web-dev" `
  -FilePath $nodeExe `
  -Arguments "node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173" `
  -WorkingDirectory $webDir `
  -PidFile (Join-Path $logDir "web-dev.pid")

Start-Sleep -Seconds 2

$apiHealth = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing
$webHealth = Invoke-WebRequest -Uri "http://127.0.0.1:5173" -UseBasicParsing

Write-Host ""
Write-Host "Stack đã chạy xong."
Write-Host "API: http://127.0.0.1:8000 (PID $($apiInfo.Id))"
Write-Host "Web: http://127.0.0.1:5173 (PID $($webInfo.Id))"
Write-Host "Worker PID: $($workerInfo.Id)"
if ($redisInfo) {
  Write-Host "Redis PID: $($redisInfo.Id)"
} else {
  Write-Host "Redis: đang dùng tiến trình có sẵn trên máy"
}
Write-Host ""
Write-Host "Health API: $($apiHealth.StatusCode)"
Write-Host "Health Web: $($webHealth.StatusCode)"
Write-Host ""
Write-Host "PID files:"
Write-Host "  $(Join-Path $logDir 'api-dev.pid')"
Write-Host "  $(Join-Path $logDir 'worker.pid')"
Write-Host "  $(Join-Path $logDir 'web-dev.pid')"
if ($redisInfo) {
  Write-Host "  $(Join-Path $logDir 'redis.pid')"
}

$ErrorActionPreference = "SilentlyContinue"

$root = $PSScriptRoot
$logDir = Join-Path $root "logs"

function Write-Info {
  param([string]$Message)
  Write-Host "[stop-all] $Message"
}

function Stop-ByPidFile {
  param(
    [string]$Name,
    [string]$PidFile
  )

  if (-not (Test-Path $PidFile)) {
    return
  }

  $procId = (Get-Content $PidFile | Select-Object -First 1).Trim()
  if (-not $procId) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    return
  }

  $proc = Get-Process -Id ([int]$procId) -ErrorAction SilentlyContinue
  if ($proc) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Write-Info "Đã dừng $Name PID $procId"
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

function Stop-ListeningPort {
  param(
    [int]$Port,
    [string]$Name
  )

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($null -eq $connections) {
    return
  }

  $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Info "Đã dừng $Name theo cổng $Port, PID $procId"
  }
}

Stop-ByPidFile -Name "web" -PidFile (Join-Path $logDir "web-dev.pid")
Stop-ByPidFile -Name "worker" -PidFile (Join-Path $logDir "worker.pid")
Stop-ByPidFile -Name "api" -PidFile (Join-Path $logDir "api-dev.pid")
Stop-ByPidFile -Name "redis" -PidFile (Join-Path $logDir "redis.pid")

Stop-ListeningPort -Port 5173 -Name "web"
Stop-ListeningPort -Port 8000 -Name "api"

Write-Host "Đã tắt stack local."

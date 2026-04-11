param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$SkipInstall,
    [switch]$NoBackend,
    [switch]$NoFrontend
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ApiDir = Join-Path $ProjectRoot "apps\\api"
$WebDir = Join-Path $ProjectRoot "apps\\web"
$LogsDir = Join-Path $ProjectRoot "logs"

$ApiPython = Join-Path $ApiDir ".venv\\Scripts\\python.exe"

$ApiPidFile = Join-Path $LogsDir "api-dev.pid"
$ApiOutLog = Join-Path $LogsDir "api-dev.out.log"
$ApiErrLog = Join-Path $LogsDir "api-dev.err.log"

$WebPidFile = Join-Path $LogsDir "web-dev.pid"
$WebOutLog = Join-Path $LogsDir "web-dev.out.log"
$WebErrLog = Join-Path $LogsDir "web-dev.err.log"

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

function Write-Info([string]$Text) {
    Write-Host "[NanBao OCR] $Text"
}

function Stop-ByPidFile([string]$PidFile, [string]$Name) {
    if (-not (Test-Path $PidFile)) { return }
    $raw = (Get-Content -Path $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $raw) { return }
    $targetPid = 0
    if (-not [int]::TryParse($raw.Trim(), [ref]$targetPid)) { return }
    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    if ($proc) {
        try {
            Stop-Process -Id $targetPid -Force -ErrorAction Stop
            Write-Info "Stopped old process of $Name (PID $targetPid)."
        } catch {
            Write-Info "Cannot stop old process of $Name (PID $targetPid): $($_.Exception.Message)"
        }
    }
}

function Start-DetachedCmd(
    [string]$Name,
    [string]$WorkingDir,
    [string]$CommandLine,
    [string]$OutLog,
    [string]$ErrLog,
    [string]$PidFile
) {
    if (Test-Path $OutLog) { Remove-Item -Force $OutLog -ErrorAction SilentlyContinue }
    if (Test-Path $ErrLog) { Remove-Item -Force $ErrLog -ErrorAction SilentlyContinue }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.WorkingDirectory = $WorkingDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.Arguments = ('/c {0} 1>>"{1}" 2>>"{2}"' -f $CommandLine, $OutLog, $ErrLog)

    $proc = [System.Diagnostics.Process]::Start($psi)
    Set-Content -Path $PidFile -Value $proc.Id -Encoding ascii
    Write-Info "Started $Name (PID $($proc.Id))."
}

function Ensure-ApiEnv {
    if (Test-Path $ApiPython) {
        try {
            & $ApiPython -c "import fastapi, uvicorn, sqlalchemy" | Out-Null
            Write-Info "Backend venv is ready."
            return
        } catch {
            Write-Info "Backend venv missing dependencies, installing..."
        }
    } else {
        Write-Info "Creating backend venv..."
        if (Test-Path "C:\\Python312\\python.exe") {
            & "C:\\Python312\\python.exe" -m venv (Join-Path $ApiDir ".venv")
        } elseif (Get-Command py -ErrorAction SilentlyContinue) {
            & py -3.12 -m venv (Join-Path $ApiDir ".venv")
        } else {
            throw "Python 3.12 not found."
        }
    }

    if ($SkipInstall) {
        Write-Info "Skip backend dependency install because -SkipInstall is set."
        return
    }

    Write-Info "Installing backend dependencies..."
    try {
        & $ApiPython -m ensurepip --upgrade | Out-Null
    } catch {
    }
    & $ApiPython -m pip install --upgrade pip
    & $ApiPython -m pip install -r (Join-Path $ApiDir "requirements.txt")
}

function Wait-Http([string]$Name, [string]$Url, [int]$TimeoutSec = 20) {
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSec) {
        try {
            $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500) {
                Write-Info "$Name is reachable at $Url"
                return
            }
        } catch {
        }
        Start-Sleep -Milliseconds 600
    }
    Write-Info "$Name did not respond in $TimeoutSec seconds: $Url"
}

if (-not $NoBackend) { Stop-ByPidFile -PidFile $ApiPidFile -Name "backend" }
if (-not $NoFrontend) { Stop-ByPidFile -PidFile $WebPidFile -Name "frontend" }

if (-not $NoBackend) {
    Ensure-ApiEnv
    $apiCmd = "`"$ApiPython`" -m uvicorn app.main:app --host 0.0.0.0 --port $BackendPort"
    Start-DetachedCmd -Name "backend" -WorkingDir $ApiDir -CommandLine $apiCmd -OutLog $ApiOutLog -ErrLog $ApiErrLog -PidFile $ApiPidFile
    Wait-Http -Name "Backend" -Url "http://127.0.0.1:$BackendPort/health"
}

if (-not $NoFrontend) {
    $webCmd = "npm.cmd run dev -- --host 0.0.0.0 --port $FrontendPort"
    Start-DetachedCmd -Name "frontend" -WorkingDir $WebDir -CommandLine $webCmd -OutLog $WebOutLog -ErrLog $WebErrLog -PidFile $WebPidFile
    Wait-Http -Name "Frontend" -Url "http://127.0.0.1:$FrontendPort"
}

Write-Host ""
Write-Info "Startup done."
if (-not $NoFrontend) {
    Write-Host "  Web: http://localhost:$FrontendPort"
    Write-Host "  Web log: $WebOutLog"
}
if (-not $NoBackend) {
    Write-Host "  API: http://localhost:$BackendPort"
    Write-Host "  Health: http://localhost:$BackendPort/health"
    Write-Host "  API log: $ApiOutLog"
}
Write-Host ""
Write-Host "Quick stop commands:"
Write-Host "  Stop-Process -Id (Get-Content `"$ApiPidFile`") -Force"
Write-Host "  Stop-Process -Id (Get-Content `"$WebPidFile`") -Force"

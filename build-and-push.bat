@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title Build va Push Docker - OCR Studio

rem === CAU HINH ===
set "DOCKER_IMAGE=nanbao/ocr"
set "DOCKERFILE=Dockerfile"
set "CONTEXT=."

rem === LAY TAG TU THAM SO DONG LENH HOAC HOI NGUOI DUNG ===
set "TAG=%~1"
if "%TAG%"=="" (
    cls
    echo ========================================================
    echo   BUILD ^& PUSH DOCKER - OCR Studio
    echo ========================================================
    echo Image: %DOCKER_IMAGE%
    echo.
    echo Vi du tag: latest / lastest / v1.0.2 / 20260418
    echo.
    set /p TAG="Nhap tag (Enter de dung mac dinh 'lastest'): "
    if "!TAG!"=="" set "TAG=lastest"
)

rem setlocal enabledelayedexpansion can thiet cho check tren
setlocal enabledelayedexpansion
if "!TAG!"=="" set "TAG=lastest"
set "FULL_TAG=%DOCKER_IMAGE%:!TAG!"

cls
echo ========================================================
echo   BUILD ^& PUSH DOCKER - OCR Studio
echo ========================================================
echo Image : %DOCKER_IMAGE%
echo Tag   : !TAG!
echo Full  : !FULL_TAG!
echo ========================================================
echo.

rem === BUOC 1: BUILD ===
echo [1/3] Dang BUILD image...
echo.
docker build -t "!FULL_TAG!" -f "%DOCKERFILE%" "%CONTEXT%"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ========================================================
    echo [LOI] BUILD THAT BAI! Kiem tra Dockerfile va thu lai.
    echo ========================================================
    pause
    exit /b 1
)
echo.
echo [OK] Build thanh cong: !FULL_TAG!
echo.

rem === BUOC 2 (tuy chon): Tag them :latest ===
if /i not "!TAG!"=="latest" (
    echo [2/3] Tag them :latest...
    docker tag "!FULL_TAG!" "%DOCKER_IMAGE%:latest"
    echo [OK] Da tag: %DOCKER_IMAGE%:latest
) else (
    echo [2/3] Tag la latest, bo qua buoc tag them.
)
echo.

rem === BUOC 3: PUSH ===
echo [3/3] Dang PUSH len Docker Hub...
echo.
docker push "!FULL_TAG!"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ========================================================
    echo [LOI] PUSH THAT BAI!
    echo Kiem tra:
    echo   1. Ban da dang nhap Docker Hub chua? (docker login)
    echo   2. Ket noi mang co on khong?
    echo ========================================================
    pause
    exit /b 1
)

rem Push them :latest neu tag khac latest
if /i not "!TAG!"=="latest" (
    echo.
    docker push "%DOCKER_IMAGE%:latest"
    if %ERRORLEVEL% NEQ 0 (
        echo [CANH BAO] Push :latest that bai nhung :!TAG! da thanh cong.
    )
)

echo.
echo ========================================================
echo   HOAN TAT!
echo   - !FULL_TAG!
if /i not "!TAG!"=="latest" echo   - %DOCKER_IMAGE%:latest
echo ========================================================
echo.
pause

@echo off
chcp 65001 >nul
title Phan Mem Quan Ly OCR Studio

:menu
cls
echo ========================================================
echo          MENU QUAN LY OCR STUDIO
echo ========================================================
echo 1. Cai dat lan dau
echo 2. Cap nhat phien ban
echo 3. Chay ung dung
echo 4. Dung ung dung
echo 5. Thoat
echo ========================================================
set /p choice="Moi ban nhap lua chon (1-5): "

if "%choice%"=="1" goto install
if "%choice%"=="2" goto update
if "%choice%"=="3" goto run
if "%choice%"=="4" goto stop
if "%choice%"=="5" goto end

echo Lua chon cua ban khong hop le, vui long thu lai!
pause
goto menu

:create_file
if exist "docker-compose.yml" goto :eof
echo.
echo Dang tu dong tao file cau hinh he thong (docker-compose.yml)...
echo version: '3.8'> docker-compose.yml
echo.>> docker-compose.yml
echo services:>> docker-compose.yml
echo   redis:>> docker-compose.yml
echo     image: redis:7>> docker-compose.yml
echo     container_name: nanbao-ocr-redis>> docker-compose.yml
echo     restart: unless-stopped>> docker-compose.yml
echo     ports:>> docker-compose.yml
echo       - "6379:6379">> docker-compose.yml
echo.>> docker-compose.yml
echo   app:>> docker-compose.yml
echo     image: nanbao/ocr:latest>> docker-compose.yml
echo     container_name: nanbao-ocr-app>> docker-compose.yml
echo     restart: unless-stopped>> docker-compose.yml
echo     ports:>> docker-compose.yml
echo       - "8000:8000">> docker-compose.yml
echo     environment:>> docker-compose.yml
echo       - APP_NAME=NanBao OCR Studio>> docker-compose.yml
echo       - PORT=8000>> docker-compose.yml
echo       - WEB_ORIGIN=http://localhost:8000>> docker-compose.yml
echo       - ALLOWED_HOSTS=localhost,127.0.0.1>> docker-compose.yml
echo       - ENABLE_DOCS=true>> docker-compose.yml
echo       - DATABASE_URL=sqlite+pysqlite:////data/ocr.db>> docker-compose.yml
echo       - REDIS_URL=redis://redis:6379/0>> docker-compose.yml
echo       - STORAGE_ROOT=/data/projects>> docker-compose.yml
echo     volumes:>> docker-compose.yml
echo       - app_data:/data>> docker-compose.yml
echo     depends_on:>> docker-compose.yml
echo       - redis>> docker-compose.yml
echo.>> docker-compose.yml
echo volumes:>> docker-compose.yml
echo   app_data:>> docker-compose.yml
goto :eof

:install
call :create_file
echo.
echo ========================================================
echo DANG TAI VA CAI DAT UNG DUNG...
echo Vui long doi Docker tai du lieu trong it phut...
echo ========================================================
docker compose pull
docker compose up -d
echo.
echo ========================================================
echo KHOI VA CAI DAT HOAN TAT! Ung dung dang chay ngam.
echo Vui long mo trinh duyet va truy cap: http://localhost:8000
echo ========================================================
pause
goto menu

:update
call :create_file
echo.
echo ========================================================
echo DANG CAP NHAT PHIEN BAN MOI NHAT...
echo ========================================================
docker compose pull
docker compose down
docker compose up -d
echo.
echo ========================================================
echo HOAN TAT DE CAP NHAT! He thong da khoi dong lai.
echo Vui long mo trinh duyet va truy cap: http://localhost:8000
echo ========================================================
pause
goto menu

:run
call :create_file
echo.
echo ========================================================
echo DANG KHOI DONG UNG DUNG...
echo ========================================================
docker compose up -d
echo.
echo ========================================================
echo HOAN TAT! Ung dung da san sang.
echo Vui long mo trinh duyet va truy cap: http://localhost:8000
echo ========================================================
pause
goto menu

:stop
if not exist "docker-compose.yml" (
    echo.
    echo He thong chua tung duoc cai dat. Khong co gi de dung!
    pause
    goto menu
)
echo.
echo ========================================================
echo DANG DUNG UNG DUNG AN TOAN...
echo ========================================================
docker compose down
echo.
echo ========================================================
echo DA DUNG AN TOAN! Du lieu cua ban van duoc giu nguyen.
echo ========================================================
pause
goto menu

:end
exit

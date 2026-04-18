@echo off
rem Su dung ma hoa tieu chuan de tranh loi CMD
chcp 65001 >nul
cd /d "%~dp0"
title Phan Mem Quan Ly OCR Studio

:menu
cls
echo ========================================================
echo          MENU QUAN LY TU DONG OCR STUDIO
echo ========================================================
echo Ban dang mo vi tri tai thu muc: %CD%
echo ========================================================
echo 1. Cai dat lan dau
echo 2. Cap nhat phien ban moi
echo 3. Chay ung dung (Dung hang ngay)
echo 4. Dung ung dung
echo 5. Thoat bang quan ly
echo ========================================================
set /p choice="Moi ban nhap lua chon (1-5): "

if "%choice%"=="1" goto install
if "%choice%"=="2" goto update
if "%choice%"=="3" goto run
if "%choice%"=="4" goto stop
if "%choice%"=="5" goto end

echo.
echo [LOI] Lua chon cua ban khong hop le, vui long go dung so tu 1 nhes!
pause
goto menu

:check_docker
docker info >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ========================================================
    echo [LOI TOI TU HE THONG GOC] DOCKER CHUA HOAT DONG!
    echo - Co the ban chua cai dat phan mem Docker Desktop.
    echo - Hoac ban cai roi nhung quen chua bat phan mem Docker len.
    echo - Vui long bat Docker Desktop va cho no chay xong roi hang thu lai nhe!
    echo ========================================================
    pause
    goto menu
)
goto :eof

:create_file
if exist "docker-compose.yml" goto :eof
echo.
echo Dang tu dong tao file cau hinh loi (docker-compose.yml)...
echo name: ocr_studio> docker-compose.yml
echo services:>> docker-compose.yml
echo   redis:>> docker-compose.yml
echo     image: redis:7>> docker-compose.yml
echo     restart: unless-stopped>> docker-compose.yml
echo     ports:>> docker-compose.yml
echo       - "6379:6379">> docker-compose.yml
echo.>> docker-compose.yml
echo   app:>> docker-compose.yml
echo     image: nanbao/ocr:tagname>> docker-compose.yml
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
call :check_docker
call :create_file
echo.
echo ========================================================
echo DANG TAI VA CAI DAT UNG DUNG MOI...
echo Vui long doi cau hinh mang tai du lieu ve trong it phut...
echo ========================================================
docker compose pull
docker compose up -d
if %ERRORLEVEL% NEQ 0 goto error_handling
echo.
echo ========================================================
echo KHOI CHAY VA CAI DAT HOAN TAT! Ung dung dang chay ngam.
echo Vui long mo trinh duyet va truy cap: http://localhost:8000
echo ========================================================
pause
goto menu

:update
call :check_docker
call :create_file
echo.
echo ========================================================
echo DANG CAP NHAT PHIEN BAN MOI NHAT TREN MAY CHU...
echo ========================================================
docker compose pull
docker compose down
docker compose up -d
if %ERRORLEVEL% NEQ 0 goto error_handling
echo.
echo ========================================================
echo HOAN TAT QUA TRINH CAP NHAT! He thong da thay phien ban moi.
echo Vui long truy cap lai web: http://localhost:8000
echo ========================================================
pause
goto menu

:run
call :check_docker
call :create_file
echo.
echo ========================================================
echo DANG KHOI DONG UNG DUNG BINH THUONG...
echo ========================================================
docker compose up -d
if %ERRORLEVEL% NEQ 0 goto error_handling
echo.
echo ========================================================
echo HOAN TAT! Ung dung da san sang.
echo Truy cap vao: http://localhost:8000
echo ========================================================
pause
goto menu

:stop
call :check_docker
if not exist "docker-compose.yml" (
    echo.
    echo [THONG BAO] He thong chua tung duoc thiet lap. Khong co gi de tat!
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
echo DA DUNG UNG DUNG THANH CONG!
echo Toan bo du lieu cua ban truoc do van duoc luu tru nguyen ven.
echo ========================================================
pause
goto menu

:error_handling
echo.
echo ========================================================
echo [CO LOI XAY RA LAM TIEN TRINH THAT BAI]
echo Vui long tu kiem tra cac nguyen nhan pho bien sau:
echo 1. CONG MANG BI CHIEM DUNG (Bind failed / Port allocated):
echo    - Loi nay xuat hien neu ban dang chay app khac cung dung cong 8000.
echo    - Hoac dang chay app OCR nay o 1 thu muc khac roi chua tat.
echo    - CACH SUA: Mo Docker Desktop, vao muc Containers de xoa toan bo container.
echo      Hoac mo 'docker-compose.yml', sua 8000:8000 thanh 8080:8000 nhe!
echo 2. LOI MANG KHONG KET NOI (Network timeout):
echo    - CACH SUA: Kiem tra Internet hoac tat bat lai Docker.
echo ========================================================
pause
goto menu

:end
exit

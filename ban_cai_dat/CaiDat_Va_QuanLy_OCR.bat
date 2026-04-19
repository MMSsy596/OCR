@echo off
rem Su dung ma hoa tieu chuan de tranh loi CMD
chcp 65001 >nul
cd /d "%~dp0"
title Phan Mem Quan Ly OCR Studio

rem === URL tai ban cap nhat file quan ly nay ===
set "BAT_UPDATE_URL=https://raw.githubusercontent.com/nanbao/ocr/main/ban_cai_dat/CaiDat_Va_QuanLy_OCR.bat"

:menu
cls
echo ========================================================
echo          MENU QUAN LY TU DONG OCR STUDIO
echo ========================================================
echo Ban dang mo vi tri tai thu muc: %CD%
echo ========================================================
echo 1. Cai dat lan dau
echo 2. Cap nhat ung dung (Docker image)
echo 3. Chay ung dung (Dung hang ngay)
echo 4. Dung ung dung
echo 5. Tu cap nhat file quan ly nay
echo 6. Thoat bang quan ly
echo ========================================================
set /p choice="Moi ban nhap lua chon (1-6): "

if "%choice%"=="1" goto install
if "%choice%"=="2" goto update
if "%choice%"=="3" goto run
if "%choice%"=="4" goto stop
if "%choice%"=="5" goto update_self
if "%choice%"=="6" goto end

echo.
echo [LOI] Lua chon cua ban khong hop le, vui long go dung so tu 1 den 6!
pause
goto menu

:check_docker
rem --- Buoc 1: Kiem tra Docker co duoc cai dat khong ---
docker --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ========================================================
    echo [LOI] DOCKER CHUA DUOC CAI DAT TREN MAY NAY!
    echo.
    echo Vui long tai va cai Docker Desktop tai:
    echo   https://www.docker.com/products/docker-desktop
    echo.
    echo Sau khi cai xong, khoi dong lai may tinh va thu lai.
    echo ========================================================
    pause
    goto menu
)

rem --- Buoc 2: Kiem tra Docker daemon co dang chay khong ---
docker info >nul 2>&1
if %ERRORLEVEL% EQU 0 goto :eof

rem --- Docker cai roi nhung daemon chua chay => tu dong mo Docker Desktop ---
echo.
echo ========================================================
echo [THONG BAO] Docker da cai nhung chua duoc bat!
echo Dang tu dong khoi dong Docker Desktop, vui long cho...
echo ========================================================

rem Thu mo Docker Desktop (cac vi tri pho bien)
set "DOCKER_EXE="
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
    set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
)
if exist "%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe" (
    set "DOCKER_EXE=%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe"
)

if defined DOCKER_EXE (
    start "" "%DOCKER_EXE%"
) else (
    echo [CANH BAO] Khong tim thay Docker Desktop.exe, vui long tu mo tay.
)

rem --- Cho Docker khoi dong (thu moi 5 giay, toi da 60 giay) ---
set WAIT_COUNT=0
:wait_docker
timeout /t 5 /nobreak >nul
docker info >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [OK] Docker da san sang! Tiep tuc...
    goto :eof
)
set /a WAIT_COUNT+=1
if %WAIT_COUNT% LSS 12 (
    echo Dang cho Docker khoi dong... [%WAIT_COUNT%/12 - khoang %WAIT_COUNT%0 giay]
    goto wait_docker
)

rem --- Qua 60 giay van chua chay ---
echo.
echo ========================================================
echo [LOI] Docker van chua san sang sau 60 giay!
echo.
echo Vui long tu mo Docker Desktop va doi den khi icon Docker
echo xuat hien o goc phai man hinh (thanh taskbar) roi thu lai.
echo ========================================================
pause
goto menu


:create_file
if exist "docker-compose.yml" goto :eof
echo.
echo Dang tu dong tao file cau hinh (docker-compose.yml)...

rem --- Tu dong lay duong dan CapCut cua user hien tai ---
set "CAPCUT_HOST_PATH=C:/Users/%USERNAME%/AppData/Local/CapCut/User Data/Projects/com.lveditor.draft"
set "CAPCUT_FOUND=0"
if exist "%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft" (
    set "CAPCUT_FOUND=1"
)

rem --- Tinh HOST_STORAGE_ROOT: duong dan Windows cua thu muc luu du lieu ---
set "HOST_STORAGE_WIN=%CD%\ocr-data\projects"
set "HOST_STORAGE_FWD=%HOST_STORAGE_WIN:\=/%"

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
echo       - CAPCUT_DRAFT_DIR=/capcut-data>> docker-compose.yml
echo       - HOST_STORAGE_ROOT=%HOST_STORAGE_FWD%>> docker-compose.yml
echo     volumes:>> docker-compose.yml
echo       - ./ocr-data:/data>> docker-compose.yml
echo       - %CAPCUT_HOST_PATH%:/capcut-data>> docker-compose.yml
echo     depends_on:>> docker-compose.yml
echo       - redis>> docker-compose.yml

if "%CAPCUT_FOUND%"=="1" (
    echo.
    echo [OK] Da tim thay CapCut tai: %LOCALAPPDATA%\CapCut
    echo      Tinh nang Xuat sang CapCut se hoat dong binh thuong.
) else (
    echo.
    echo [CANH BAO] Khong tim thay thu muc CapCut tai:
    echo   %LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft
    echo   Tinh nang Xuat sang CapCut se khong hoat dong cho den khi ban cai CapCut.
)
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
docker compose down --remove-orphans
rem --- Xoa container cu con sot neu docker compose down chua don het ---
docker rm -f nanbao-ocr-redis >nul 2>&1
docker rm -f nanbao-ocr-app >nul 2>&1
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

:update_self
echo.
echo ========================================================
echo   TU CAP NHAT FILE QUAN LY
echo ========================================================
echo Dang tai phien ban moi tu:
echo   %BAT_UPDATE_URL%
echo.

rem --- Tai file moi ve thu muc tam ---
set "TMP_NEW=%TEMP%\ocr_update_new.bat"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { Invoke-WebRequest -Uri '%BAT_UPDATE_URL%' -OutFile '%TMP_NEW%' -UseBasicParsing; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [LOI] Khong tai duoc ban cap nhat!
    echo Kiem tra lai:
    echo   1. Ket noi Internet cua ban
    echo   2. URL trong file nay co chinh xac khong
    pause
    goto menu
)

rem --- Kiem tra file tai ve co hop le khong ---
findstr /i "@echo off" "%TMP_NEW%" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [LOI] File tai ve bi loi hoac khong phai file quan ly hop le!
    del "%TMP_NEW%" >nul 2>&1
    pause
    goto menu
)

echo [OK] Da tai xong phien ban moi!
echo.
echo Dang chuan bi thay the va khoi dong lai...
echo Cua so nay se tu dong dong va mo lai sau khi cap nhat.
timeout /t 2 /nobreak >nul

rem --- Tao helper script chay sau khi bat nay thoat ---
rem    Helper se: cho 2s -> copy de -> mo bat moi -> tu xoa ban than
set "HELPER=%TEMP%\ocr_self_update_helper.bat"
set "THIS_BAT=%~f0"

(
    echo @echo off
    echo timeout /t 2 /nobreak ^>nul
    echo copy /y "%TMP_NEW%" "%THIS_BAT%" ^>nul
    echo if %%ERRORLEVEL%% EQU 0 ^(
    echo     start "" "%THIS_BAT%"
    echo ^) else ^(
    echo     echo [LOI] Khong the ghi de file. Thu chay lai bang quyen Admin.
    echo     pause
    echo ^)
    echo del "%TMP_NEW%" ^>nul 2^>^&1
    echo del "%%~f0"
) > "%HELPER%"

rem Chay helper trong nen roi thoat de giai phong file lock
start "" "%HELPER%"
exit

:end
exit

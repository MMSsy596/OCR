@echo off
chcp 65001 >nul
title Menu Quan ly OCR Studio

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

echo Lua chon cua ban khong hop le, vui long thu lai.
pause
goto menu

:install
echo.
echo ========================================================
echo DANG TAI VA CAI DAT UNG DUNG...
echo Doi may giay de tai phien ban moi nhat nhe...
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

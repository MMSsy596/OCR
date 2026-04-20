@echo off
chcp 65001 >nul
title Phần Mềm Quản Lý OCR Studio

:menu
cls
echo ========================================================
echo          MENU QUẢN LÝ OCR STUDIO
echo ========================================================
echo 1. Cài đặt lần đầu
echo 2. Cập nhật phiên bản
echo 3. Chạy ứng dụng
echo 4. Dừng ứng dụng
echo 5. Thoát
echo ========================================================
set /p choice="Mời bạn nhập lựa chọn (1-5): "

if "%choice%"=="1" goto install
if "%choice%"=="2" goto update
if "%choice%"=="3" goto run
if "%choice%"=="4" goto stop
if "%choice%"=="5" goto end

echo Lựa chọn của bạn không hợp lệ, vui lòng thử lại!
pause
goto menu

:create_file
if exist "docker-compose.yml" goto :eof
echo.
echo Đang tự động tạo file cấu hình hệ thống (docker-compose.yml)...
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
echo     image: nanbao/ocr:tagname>> docker-compose.yml
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
echo ĐANG TẢI VÀ CÀI ĐẶT ỨNG DỤNG...
echo Vui lòng đợi Docker tải dữ liệu trong ít phút...
echo ========================================================
docker compose pull
docker compose up -d
echo.
echo ========================================================
echo KHỞI TẠO VÀ CÀI ĐẶT HOÀN TẤT! Ứng dụng đang chạy ngầm.
echo Vui lòng mở trình duyệt và truy cập: http://localhost:8000
echo ========================================================
pause
goto menu

:update
call :create_file
echo.
echo ========================================================
echo ĐANG CẬP NHẬT PHIÊN BẢN MỚI NHẤT...
echo ========================================================
docker compose pull
docker compose down --remove-orphans
rem --- Xoa container cu con sot neu docker compose down chua don het ---
docker rm -f nanbao-ocr-redis >nul 2>&1
docker rm -f nanbao-ocr-app >nul 2>&1
docker compose up -d
echo.
echo ========================================================
echo HOÀN TẤT CẬP NHẬT! Hệ thống đã khởi động lại.
echo Vui lòng mở trình duyệt và truy cập: http://localhost:8000
echo ========================================================
pause
goto menu

:run
call :create_file
echo.
echo ========================================================
echo ĐANG KHỞI ĐỘNG ỨNG DỤNG...
echo ========================================================
docker compose up -d
echo.
echo ========================================================
echo HOÀN TẤT! Ứng dụng đã sẵn sàng.
echo Vui lòng mở trình duyệt và truy cập: http://localhost:8000
echo ========================================================
pause
goto menu

:stop
if not exist "docker-compose.yml" (
    echo.
    echo Hệ thống chưa từng được cài đặt. Không có gì để dừng!
    pause
    goto menu
)
echo.
echo ========================================================
echo ĐANG DỪNG ỨNG DỤNG AN TOÀN...
echo ========================================================
docker compose down
echo.
echo ========================================================
echo ĐÃ DỪNG AN TOÀN! Dữ liệu của bạn vẫn được giữ nguyên.
echo ========================================================
pause
goto menu

:end
exit

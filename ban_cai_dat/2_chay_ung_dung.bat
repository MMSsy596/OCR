@echo off
chcp 65001 >nul
echo ========================================================
echo DANG KHOI DONG U'NG DU'NG...
echo ========================================================
docker compose up -d
echo.
echo ========================================================
echo CA'C DI.CH VU DA DUOC BAT.
echo Vui long mo trinh duyet va truy cap: http://localhost:8000
echo ========================================================
pause

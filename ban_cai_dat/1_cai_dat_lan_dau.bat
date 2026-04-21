@echo off
chcp 65001 >nul
echo ========================================================
echo DANG TAI VA CAI DAT U'NG DU.NG (OCR)
echo Vui long doi trong it phut...
echo ========================================================
docker compose pull
echo.
echo DANG KHOI DONG THEO PHIEN BAN DA TAI...
docker compose up -d
echo.
echo ========================================================
echo HOAN TAT! Ung dung dang chay ngam.
echo Vui long mo trinh duyet va truy cap: http://localhost:8000
echo ========================================================
pause

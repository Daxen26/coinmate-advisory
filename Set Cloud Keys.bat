@echo off
REM ===== One-time: put your OKX keys into Cloudflare (encrypted) =====
REM Run this ONCE, after the first deploy. Reads okx-keys.json on this PC and
REM uploads the 3 keys to Cloudflare as encrypted secrets. They never show on screen.
cd /d "%~dp0"
echo Uploading your OKX keys to Cloudflare as encrypted secrets...
echo (read from your local okx-keys.json -- they never appear on screen)
echo.
call node "cloud\set-cloud-keys.js"
echo.
pause

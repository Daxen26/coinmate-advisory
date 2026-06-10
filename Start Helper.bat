@echo off
title Coinmate OKX Helper
cd /d "%~dp0"

REM --- 1) make sure Node.js is installed on this PC ---
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ============================================================
  echo   Node.js is not installed on this PC yet.
  echo.
  echo   Install it once (free, about 2 minutes):
  echo     1. Go to:  https://nodejs.org/en/download
  echo     2. Download the Windows "LTS" installer and run it.
  echo     3. Click Next / Next / Install with the defaults.
  echo   Then double-click "Start Helper.bat" again.
  echo  ============================================================
  echo.
  pause
  exit /b
)

REM --- 2) friendly note if the keys file is not here (advisor still works) ---
if not exist "okx-keys.json" (
  echo  Note: okx-keys.json was not found on this PC.
  echo        The price advisor and competitor view will still work.
  echo        To also show your live balance / orders / ledger, copy your
  echo        okx-keys.json file into this same folder, then restart.
  echo.
)

echo Starting the Coinmate OKX helper...
echo Your browser will open the app in a few seconds.
echo Keep THIS black window open the whole time you use the app.
echo.
start "" /min "%~dp0open-app.bat"
node "%~dp0okx-helper.js"
echo.
echo The helper has stopped. You can close this window.
pause

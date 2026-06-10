@echo off
title Coinmate OKX Helper
echo Starting the Coinmate OKX helper...
echo The app will open in your browser in a few seconds.
echo.
REM open the browser shortly after the server starts (runs minimized, then exits)
start "" /min "%~dp0open-app.bat"
node "%~dp0okx-helper.js"
echo.
echo The helper has stopped. You can close this window.
pause

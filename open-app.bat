@echo off
REM waits a moment for the helper to start, then opens the app in your browser
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:8787/
exit

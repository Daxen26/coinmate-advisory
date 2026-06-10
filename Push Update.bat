@echo off
REM ===== Coinmate: push a local update live =====
REM Double-click this whenever you change coinmate_advisor_bot.html.
REM It (1) backs up to GitHub and (2) deploys the new page to Cloudflare.
cd /d "%~dp0"

echo.
echo [1/3] Copying the app into the deploy folder...
if not exist "cloud\public" mkdir "cloud\public"
copy /Y "coinmate_advisor_bot.html" "cloud\public\index.html" >nul

echo [2/3] Backing up to GitHub...
git add -A
git commit -m "Update %date% %time%"
git push

echo [3/3] Deploying to Cloudflare...
cd cloud
call npx wrangler deploy

echo.
echo ============================================
echo  Done. Your update is now LIVE.
echo ============================================
pause

@echo off
cd /d "%~dp0server"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
echo Starting Velvet North Network and Blackjack...
start "Velvet North Blackjack" http://localhost:8787/
node server.js
pause

@echo off
rem  Run this once to put a "StockPilot" shortcut on your Desktop.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Create-Desktop-Shortcut.ps1" %*
echo.
pause

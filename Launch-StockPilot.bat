@echo off
rem  Double-click this file (or the "StockPilot" desktop shortcut) to open StockPilot.
rem  It starts the backend and the screen if they are not running yet, waits until they are ready,
rem  then opens StockPilot in your default browser. Your data is not touched.
title StockPilot Launcher
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Launch-StockPilot.ps1" %*
if errorlevel 1 (
  echo.
  pause
)

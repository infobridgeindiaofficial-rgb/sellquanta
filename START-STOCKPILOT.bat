@echo off
rem  Old start file. It now uses the new launcher so StockPilot is never started twice.
rem  (For development you can still run "npm run dev" yourself.)
call "%~dp0Launch-StockPilot.bat" %*

@echo off
cd /d "%~dp0"
echo Installing StockPilot dependencies...
call npm run install:all
echo.
echo Installation finished.
echo Now double-click START-STOCKPILOT.bat
pause

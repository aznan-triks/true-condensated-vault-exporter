@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync.ps1"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERREUR] Le script s'est arrete avec une erreur (%ERRORLEVEL%).
    pause
)

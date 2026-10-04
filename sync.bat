@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync.ps1"
if errorlevel 1 (
    echo [ERROR] The Git sync script stopped with an error.
    pause
)

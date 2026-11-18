@echo off
chcp 65001 >nul
title Arena Live OS Kurulum
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
if %errorlevel% neq 0 pause & exit /b %errorlevel%
echo.
echo Kurulum tamam. Arena-Live-OS.bat ile başlatılıyor...
start "" "%~dp0Arena-Live-OS.bat"

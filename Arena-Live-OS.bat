@echo off
chcp 65001 >nul
title Arena Live OS
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1" -CheckUpdate
pause

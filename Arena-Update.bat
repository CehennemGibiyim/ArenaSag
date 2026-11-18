@echo off
chcp 65001 >nul
title Arena Live OS Güncelleme
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\windows\update-arena.ps1"
pause

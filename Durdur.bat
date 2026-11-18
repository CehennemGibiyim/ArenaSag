@echo off
chcp 65001 >nul
title Arena Live OS - Durdur
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a
echo Arena Live OS durduruldu.
timeout /t 2 >nul

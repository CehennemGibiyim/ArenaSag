@echo off
chcp 65001 >nul
title Arena Radar - Durdur
set "PIDFILE=%LOCALAPPDATA%\ArenaRadar\radar.pid"
if exist "%PIDFILE%" (
  set /p RADARPID=<"%PIDFILE%"
  taskkill /F /PID %RADARPID% >nul 2>&1
  del "%PIDFILE%" >nul 2>&1
  echo Arena Radar durduruldu.
) else (
  echo Calisan Arena Radar kaydi bulunamadi.
)
timeout /t 2 >nul

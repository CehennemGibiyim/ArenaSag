@echo off
chcp 65001 >nul
title Arena Radar
cd /d "%~dp0"
if exist "%~dp0node.exe" (set "NODE=%~dp0node.exe") else (set "NODE=node")
if "%~1"=="--silent" (
  start "" /min "%NODE%" "%~dp0desktop\main.mjs" --silent
) else (
  start "" "%NODE%" "%~dp0desktop\main.mjs"
)

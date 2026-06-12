@echo off
title Base44 Standalone Converter Extension Launcher
echo =======================================================
echo   Base44 Standalone Converter Launcher
echo   Starting local HTTP server on http://localhost:4444 ...
echo =======================================================
echo.

:: Launch the default web browser to the dashboard URL
start "" "http://localhost:4444"

:: Run the Node.js server
node "%~dp0ui\server.js"

if %ERRORLEVEL% neq 0 (
  echo.
  echo [ERROR] Failed to start local Node.js server. 
  echo Ensure Node.js is installed on your computer and port 4444 is not in use.
  echo.
  pause
)

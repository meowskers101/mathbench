@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed to run Mathbench from source. Get it from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing Mathbench's dependencies into this folder. This only happens once...
  call npm install
  if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
)
call npm start

@echo off
rem Starts the AI Village hub (or opens it if it is already running). Leave this window open or minimize it.
cd /d "%~dp0"
node scripts\start.mjs %*
if errorlevel 1 pause

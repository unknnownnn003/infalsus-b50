@echo off
setlocal
where py >nul 2>nul
if not errorlevel 1 goto use_py
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3 is required. Install Python 3, then run this file again.
  pause
  exit /b 1
)
call python "%~dp0run-local.py"
if errorlevel 1 exit /b 1
exit /b 0

:use_py
call py -3 "%~dp0run-local.py"
if errorlevel 1 exit /b 1
exit /b 0

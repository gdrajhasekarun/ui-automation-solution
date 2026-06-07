@echo off
set SVC_DIR=%~dp0
set SVC_DIR=%SVC_DIR:~0,-1%
for %%I in ("%SVC_DIR%\..\..") do set ROOT=%%~fI
set UVICORN=%ROOT%\.venv\Scripts\uvicorn.exe
if not exist "%UVICORN%" (echo Run setup.bat from repo root first. & pause & exit /b 1)
if exist "%ROOT%\.env" for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%\.env") do if not "%%A:~0,1%%"=="#" set "%%A=%%B"
set SHARED_DIR=%ROOT%\shared
cd /d "%SVC_DIR%"
"%UVICORN%" main:app --port 8000 --reload
pause

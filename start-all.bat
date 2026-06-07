@echo off
setlocal enabledelayedexpansion

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║   AI-Powered UI Test Automation — POC Demo       ║
echo ╠══════════════════════════════════════════════════╣
echo ║   Dashboard API     :8000   always-on            ║
echo ║   Crawl Service     :8001   lambda-style         ║
echo ║   Generator Service :8002   lambda-style         ║
echo ║   Planner Service   :8003   on-demand            ║
echo ║   Executor Service  :8004   always-on            ║
echo ╚══════════════════════════════════════════════════╝
echo.

set ROOT=%~dp0
set ROOT=%ROOT:~0,-1%
set UVICORN=%ROOT%\.venv\Scripts\uvicorn.exe

if not exist "%UVICORN%" (
    echo Shared venv not found. Run setup.bat first.
    pause
    exit /b 1
)

:: Load .env if present
if exist "%ROOT%\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%\.env") do (
        set "line=%%A"
        if not "!line:~0,1!"=="#" (
            set "%%A=%%B"
        )
    )
)

set SHARED_DIR=%ROOT%\shared
set JAVA_DIR=%ROOT%\shared\java
set DASHBOARD_URL=http://localhost:8000
set GENERATOR_URL=http://localhost:8002
set PLANNER_URL=http://localhost:8003
set EXECUTOR_URL=http://localhost:8004

echo Starting Dashboard API (port 8000)...
start "Dashboard :8000" cmd /k "cd /d %ROOT%\services\dashboard && set SHARED_DIR=%SHARED_DIR%&& set DASHBOARD_URL=%DASHBOARD_URL%&& "%UVICORN%" main:app --port 8000"
timeout /t 2 /nobreak >nul

echo Starting Executor Service (port 8004)...
start "Executor :8004" cmd /k "cd /d %ROOT%\services\executor && set SHARED_DIR=%SHARED_DIR%&& set DASHBOARD_URL=%DASHBOARD_URL%&& "%UVICORN%" main:app --port 8004"

echo Starting Crawl Service (port 8001)...
start "Crawl :8001" cmd /k "cd /d %ROOT%\services\crawl && set SHARED_DIR=%SHARED_DIR%&& set DASHBOARD_URL=%DASHBOARD_URL%&& set GENERATOR_URL=%GENERATOR_URL%&& "%UVICORN%" main:app --port 8001"

echo Starting Generator Service (port 8002)...
start "Generator :8002" cmd /k "cd /d %ROOT%\services\generator && set SHARED_DIR=%SHARED_DIR%&& set DASHBOARD_URL=%DASHBOARD_URL%&& "%UVICORN%" main:app --port 8002"

echo Starting Planner Service (port 8003)...
start "Planner :8003" cmd /k "cd /d %ROOT%\services\planner && set SHARED_DIR=%SHARED_DIR%&& set DASHBOARD_URL=%DASHBOARD_URL%&& "%UVICORN%" main:app --port 8003"

echo.
echo All services started — each in its own window.
echo.
echo Dashboard UI : http://localhost:8000
echo UI dev server: cd ui ^&^& npm run dev   (http://localhost:5173)
echo.
echo Press any key to exit this window (services keep running).
pause >nul

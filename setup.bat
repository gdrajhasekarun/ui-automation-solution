@echo off
setlocal

set ROOT=%~dp0
set ROOT=%ROOT:~0,-1%
set VENV=%ROOT%\.venv

echo.
echo Setting up shared venv for all services...
echo.

cd /d "%ROOT%"

:: Create venv and install via Poetry into local .venv
call poetry config virtualenvs.in-project true
call poetry install --no-root
if errorlevel 1 (
    echo ERROR: poetry install failed.
    pause
    exit /b 1
)

echo.
echo Running post-install steps for crawl tools...
call "%VENV%\Scripts\crawl4ai-setup.exe" || echo   crawl4ai-setup skipped
call "%VENV%\Scripts\playwright.exe" install chromium || echo   playwright install skipped

echo.
echo Setup complete. Run start-all.bat to start all services.
echo.
pause

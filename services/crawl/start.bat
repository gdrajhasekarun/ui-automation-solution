@echo off
cd /d "%~dp0"
call poetry install --no-root -q
call poetry run uvicorn main:app --port 8001 --reload
pause

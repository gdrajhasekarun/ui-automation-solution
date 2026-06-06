#!/bin/bash
set -e
cd "$(dirname "$0")"
poetry install --no-root -q
poetry run uvicorn main:app --port 8001 --reload

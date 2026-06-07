#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UVICORN="$ROOT/.venv/bin/uvicorn"
if [ ! -f "$UVICORN" ]; then echo "Run ./setup.sh from repo root first."; exit 1; fi
[ -f "$ROOT/.env" ] && export $(grep -v '^#' "$ROOT/.env" | xargs)
export SHARED_DIR="$ROOT/shared"
export DASHBOARD_URL="http://localhost:8000"
cd "$(dirname "$0")"
"$UVICORN" main:app --port 8002 --reload

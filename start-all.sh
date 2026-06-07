#!/bin/bash
set -e
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   AI-Powered UI Test Automation — POC Demo       ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║   Dashboard API     :8000   always-on            ║"
echo "║   Crawl Service     :8001   lambda-style         ║"
echo "║   Generator Service :8002   lambda-style         ║"
echo "║   Planner Service   :8003   on-demand            ║"
echo "║   Executor Service  :8004   always-on            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

ROOT="$(cd "$(dirname "$0")" && pwd)"
UVICORN="$ROOT/.venv/bin/uvicorn"

if [ ! -f "$UVICORN" ]; then
  echo "Shared venv not found. Run ./setup.sh first."
  exit 1
fi

[ -f "$ROOT/.env" ] && export $(grep -v '^#' "$ROOT/.env" | xargs)

export SHARED_DIR="$ROOT/shared"
export JAVA_DIR="$ROOT/shared/java"
export DASHBOARD_URL="http://localhost:8000"
export GENERATOR_URL="http://localhost:8002"
export PLANNER_URL="http://localhost:8003"
export EXECUTOR_URL="http://localhost:8004"

echo "Starting Dashboard API (port 8000)..."
(cd "$ROOT/services/dashboard" && "$UVICORN" main:app --port 8000) &
sleep 2

echo "Starting Executor Service (port 8004)..."
(cd "$ROOT/services/executor" && "$UVICORN" main:app --port 8004) &

echo "Starting Crawl Service (port 8001)..."
(cd "$ROOT/services/crawl" && "$UVICORN" main:app --port 8001) &

echo "Starting Generator Service (port 8002)..."
(cd "$ROOT/services/generator" && "$UVICORN" main:app --port 8002) &

echo "Starting Planner Service (port 8003)..."
(cd "$ROOT/services/planner" && "$UVICORN" main:app --port 8003) &

echo ""
echo "All services started."
echo "UI dev server:  cd ui && npm run dev  (http://localhost:5173)"
echo ""
wait

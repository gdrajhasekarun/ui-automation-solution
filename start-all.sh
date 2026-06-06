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
[ -f "$ROOT/.env" ] && export $(grep -v '^#' "$ROOT/.env" | xargs)

export SHARED_DIR="$ROOT/shared"
export JAVA_DIR="$ROOT/shared/java"
export DASHBOARD_URL="http://localhost:8000"
export GENERATOR_URL="http://localhost:8002"
export PLANNER_URL="http://localhost:8003"
export EXECUTOR_URL="http://localhost:8004"

echo "Installing dependencies for all services..."
for svc in dashboard crawl generator planner executor; do
  (cd "$ROOT/services/$svc" && poetry install --no-root -q) &
done
wait
echo "Dependencies installed."
echo ""

echo "Starting Dashboard API (port 8000)..."
(cd "$ROOT/services/dashboard" && poetry run uvicorn main:app --port 8000) &
sleep 2

echo "Starting Executor Service (port 8004)..."
(cd "$ROOT/services/executor" && poetry run uvicorn main:app --port 8004) &

echo "Starting Crawl Service (port 8001)..."
(cd "$ROOT/services/crawl" && poetry run uvicorn main:app --port 8001) &

echo "Starting Generator Service (port 8002)..."
(cd "$ROOT/services/generator" && poetry run uvicorn main:app --port 8002) &

echo "Starting Planner Service (port 8003)..."
(cd "$ROOT/services/planner" && poetry run uvicorn main:app --port 8003) &

echo ""
echo "All services started. Open http://localhost:8000"
echo "UI dev server:  cd ui && npm run dev  (http://localhost:3000)"
echo ""
wait

#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "Setting up shared venv for all services..."
echo ""

cd "$ROOT"

# Install deps via Poetry into a local .venv
poetry config virtualenvs.in-project true
poetry install --no-root

echo ""
echo "Running post-install steps for crawl tools..."
poetry run crawl4ai-setup || echo "  crawl4ai-setup skipped (may already be done)"
poetry run playwright install chromium || echo "  playwright install skipped"

echo ""
echo "Setup complete. Run ./start-all.sh to start all services."
echo ""

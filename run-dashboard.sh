#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-5173}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required to run this React app."
  echo "Install Node.js (LTS), then run: npm install && npm run dev -- --host 0.0.0.0 --port ${PORT}"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting React dev server on http://localhost:${PORT}"
exec npm run dev -- --host 0.0.0.0 --port "${PORT}"

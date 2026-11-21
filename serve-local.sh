#!/bin/sh
# Serve Veggie Bros. on localhost only (http://127.0.0.1:8010).
# Usage: ./serve-local.sh [port]   (default 8010; Ctrl-C stops it)
set -eu
cd "$(dirname "$0")"

PORT="${1:-8010}"
if [ "$PORT" = "8000" ]; then
  echo "refusing port 8000 — reserved for the splash inference engine" >&2
  exit 1
fi
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is already in use" >&2
  exit 1
fi

echo "Veggie Bros. -> http://127.0.0.1:$PORT (localhost only)"
exec python3 tools/serve.py "$PORT" --bind 127.0.0.1

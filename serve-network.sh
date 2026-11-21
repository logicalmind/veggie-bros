#!/bin/sh
# Serve Veggie Bros. on all network interfaces (playable from other devices).
# Usage: ./serve-network.sh [port]   (default 8010; Ctrl-C stops it)
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

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "<this-machine-ip>")
echo "Veggie Bros. -> http://$LAN_IP:$PORT (all interfaces — use this address from other devices)"
exec python3 tools/serve.py "$PORT" --bind 0.0.0.0

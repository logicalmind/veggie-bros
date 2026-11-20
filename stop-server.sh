#!/bin/sh
# Stop the Veggie Bros. dev server started by serve-local.sh or serve-network.sh.
# Stops by port, so it works whichever bind address was used.
# Usage: ./stop-server.sh [port]   (default 8010)
set -eu
cd "$(dirname "$0")"

PORT="${1:-8010}"
if [ "$PORT" = "8000" ]; then
  echo "refusing port 8000 — reserved for the splash inference engine" >&2
  exit 1
fi
if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof not found — find and stop the listener yourself (ps -o pid,command | grep http.server)" >&2
  exit 1
fi

listening() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true; }

PIDS=$(listening)
if [ -z "$PIDS" ]; then
  echo "nothing listening on port $PORT"
  exit 0
fi

# Refuse to touch anything that is not the dev server we started.
for PID in $PIDS; do
  CMD=$(ps -ww -o command= -p "$PID" 2>/dev/null || true)
  # Matched case-insensitively: the interpreter binary is often "Python" (framework
  # builds), so a case-sensitive match would falsely refuse our own server.
  case $(printf '%s' "$CMD" | tr 'A-Z' 'a-z') in
    *python*http.server*) ;;
    *)
      echo "port $PORT is held by PID $PID, which is not a python http.server — leaving it alone:" >&2
      echo "  ${CMD:-<unknown>}" >&2
      exit 1
      ;;
  esac
done

for PID in $PIDS; do kill "$PID" 2>/dev/null || true; done

i=0
while [ "$i" -lt 20 ]; do
  PIDS=$(listening)
  if [ -z "$PIDS" ]; then
    echo "stopped the server on port $PORT"
    exit 0
  fi
  i=$((i + 1))
  sleep 0.1
done

kill -9 $PIDS 2>/dev/null || true
echo "force-stopped the server on port $PORT"

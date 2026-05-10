#!/bin/bash
# Relay launcher for Tilt — runs relay in foreground so Tilt can manage its lifecycle
# Tilt will auto-restart this serve_cmd if the relay exits

DELETION_DETECTOR_DIR="/mnt/Storage/github/relayer/deletion_detector"
RELAY_DIR="/mnt/Storage/github/relayer"
PORT=18421
LOG_DIR="$RELAY_DIR/logs"
RELAY_LOG="$LOG_DIR/relay-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

# Kill any stale process holding our port before starting
holder=$(lsof -ti :$PORT 2>/dev/null || true)
if [ -n "$holder" ]; then
    echo "[spawn] Killing stale process on port $PORT (PID $holder)"
    kill -9 $holder 2>/dev/null
    sleep 1
fi

# Start deletion detector in background
"$DELETION_DETECTOR_DIR/venv/bin/python" "$DELETION_DETECTOR_DIR/bot.py" >> "$LOG_DIR/deletion-detector-$(date +%Y-%m-%d).log" 2>&1 &
DD_PID=$!

# Cleanup deletion detector on exit
cleanup() {
    kill $DD_PID 2>/dev/null
    wait $DD_PID 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "[spawn] Starting relay on port $PORT..."

# Run relay in foreground — when this exits, the script exits and Tilt sees it
cd "$RELAY_DIR"
WEBHOOK_PORT=$PORT exec /usr/bin/node \
    --require /home/ubuntubox/.npm-global/lib/node_modules/tsx/dist/preflight.cjs \
    --import file:///home/ubuntubox/.npm-global/lib/node_modules/tsx/dist/loader.mjs \
    src/index.ts >> "$RELAY_LOG" 2>&1

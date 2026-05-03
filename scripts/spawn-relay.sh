#!/bin/bash
# Minimal relay launcher - spawns deletion detector + relay
# Bypasses start-production.js to avoid uv_signal_start EINVAL bug
set -m  # job control ON

DELETION_DETECTOR_DIR="/mnt/Storage/github/relayer/deletion_detector"
RELAY_DIR="/mnt/Storage/github/relayer"
PORT=18421

# Remove stale lockfile
rm -f "$RELAY_DIR/.relay.lock"

# Start deletion detector in background
echo "[spawn] Starting deletion detector..."
"$DELETION_DETECTOR_DIR/venv/bin/python" "$DELETION_DETECTOR_DIR/bot.py" &
DD_PID=$!

# Give deletion detector time to initialize
sleep 3

# Start relay
echo "[spawn] Starting relay on port $PORT..."
cd "$RELAY_DIR"
WEBHOOK_PORT=$PORT /usr/bin/node \
  --require /home/ubuntubox/.npm-global/lib/node_modules/tsx/dist/preflight.cjs \
  --import file:///home/ubuntubox/.npm-global/lib/node_modules/tsx/dist/loader.mjs \
  src/index.ts &

RELAY_PID=$!
echo "[spawn] Relay started as PID $RELAY_PID"

# Wait for relay to bind port
sleep 3

# Write lockfile
echo "{\"pid\":$$,\"started\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"port\":$PORT}" > "$RELAY_DIR/.relay.lock"
echo "[spawn] Lockfile written"

# Wait for both to finish (they run forever)
wait $DD_PID $RELAY_PID

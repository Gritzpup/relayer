#!/bin/bash
# Relay launcher for Tilt — runs relay in foreground so Tilt can manage its lifecycle
# Tilt will auto-restart this serve_cmd if the relay exits

DELETION_DETECTOR_DIR="/mnt/Storage/github/relayer/deletion_detector"
RELAY_DIR="/mnt/Storage/github/relayer"
PORT=18421
LOG_DIR="$RELAY_DIR/logs"
RELAY_LOG="$LOG_DIR/relay-$(date +%Y-%m-%d).log"
CLOUDFLARED="/home/ubuntubox2/.local/bin/cloudflared"
TUNNEL_LOG="/tmp/cloudflared-relay.log"

mkdir -p "$LOG_DIR"

# Kill any stale processes
holder=$(lsof -ti :$PORT 2>/dev/null || true)
if [ -n "$holder" ]; then
    echo "[spawn] Killing stale process on port $PORT (PID $holder)"
    kill -9 $holder 2>/dev/null
    sleep 1
fi

# Cloudflare tunnel is managed by Tilt as a separate resource (cloudflared-tunnel)
# Wait for the tunnel URL to appear, then sync it to .env
if [ -x "$CLOUDFLARED" ]; then
    echo "[spawn] Waiting for Cloudflare tunnel (managed by Tilt)..."
    # Clear stale log from previous runs so we only match the current tunnel URL
    > /tmp/cloudflared-tunnel.log
    TUNNEL_URL=""
    for i in $(seq 1 20); do
        sleep 2
        TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cloudflared-tunnel.log 2>/dev/null | head -1)
        if [ -n "$TUNNEL_URL" ]; then
            echo "[spawn] Tunnel ready: $TUNNEL_URL"
            break
        fi
    done

    if [ -n "$TUNNEL_URL" ]; then
        WEBHOOK_URL="${TUNNEL_URL}/api/kick-webhook"
        if grep -q "^KICK_WEBHOOK_URL=" "$RELAY_DIR/.env"; then
            sed -i "s|^KICK_WEBHOOK_URL=.*|KICK_WEBHOOK_URL=$WEBHOOK_URL|" "$RELAY_DIR/.env"
        else
            echo "KICK_WEBHOOK_URL=$WEBHOOK_URL" >> "$RELAY_DIR/.env"
        fi
        echo "[spawn] KICK_WEBHOOK_URL synced to: $WEBHOOK_URL"
    else
        echo "[spawn] WARNING: Could not find tunnel URL after 40s - continuing anyway"
    fi
else
    echo "[spawn] WARNING: cloudflared not found at $CLOUDFLARED"
fi

# Start deletion detector in background
"$DELETION_DETECTOR_DIR/venv/bin/python" "$DELETION_DETECTOR_DIR/bot.py" >> "$LOG_DIR/deletion-detector-$(date +%Y-%m-%d).log" 2>&1 &
DD_PID=$!

# Cleanup on exit
cleanup() {
    kill $DD_PID 2>/dev/null
    wait $DD_PID 2>/dev/null
    # cloudflared is managed externally
}
trap cleanup EXIT INT TERM

echo "[spawn] Starting relay on port $PORT..."

# Run relay in foreground — when this exits, the script exits and Tilt sees it
cd "$RELAY_DIR"
WEBHOOK_PORT=$PORT exec /home/ubuntubox2/.nvm/versions/node/v24.15.0/bin/node \
    --require /mnt/Storage/github/relayer/node_modules/tsx/dist/preflight.cjs \
    --import file:///mnt/Storage/github/relayer/node_modules/tsx/dist/loader.mjs \
    src/index.ts >> "$RELAY_LOG" 2>&1

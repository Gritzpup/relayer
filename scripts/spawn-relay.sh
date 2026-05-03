#!/bin/bash
# Robust relay launcher with auto-restart and SIGKILL tracing
# Bypasses start-production.js to avoid uv_signal_start EINVAL bug
set -m  # job control ON

DELETION_DETECTOR_DIR="/mnt/Storage/github/relayer/deletion_detector"
RELAY_DIR="/mnt/Storage/github/relayer"
PORT=18421
LOG_DIR="$RELAY_DIR/logs"
SIGKILL_LOG="$LOG_DIR/sigkill-trace.log"
RELAY_LOG="$LOG_DIR/relay-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [spawn] $*" | tee -a "$RELAY_LOG"
}

trace_sigkill() {
    local target_pid=$1
    local relay_pid=$2
    local ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    local parent_pid=$(ps -o ppid= -p "$target_pid" 2>/dev/null | tr -d ' ')
    local killer_ppid=""
    local killer_comm="unknown"
    local killer_cmd=""
    if [ -n "$parent_pid" ] && [ "$parent_pid" != "1" ]; then
        killer_ppid=$parent_pid
        killer_comm=$(ps -o comm= -p "$parent_pid" 2>/dev/null || echo "unknown")
        killer_cmd=$(ps -o cmd= -p "$parent_pid" 2>/dev/null || echo "")
    fi
    echo "[$ts] SIGKILL_TRACE target=$target_pid relay=$relay_pid killer_ppid=$killer_ppid killer_comm=$killer_comm killer_cmd=$killer_cmd" >> "$SIGKILL_LOG"
    log "SIGKILL traced: relay_pid=$relay_pid killer_ppid=$killer_ppid comm=$killer_comm"
}

# Cleanup function
cleanup() {
    log "Spawn script shutting down..."
    rm -f "$RELAY_DIR/.relay.lock"
    # Kill all children
    jobs -p | xargs -r kill -9 2>/dev/null
    exit 0
}

trap cleanup EXIT INT TERM

DD_PID=""
RELAY_PID=""

start_deletion_detector() {
    log "Starting deletion detector..."
    "$DELETION_DETECTOR_DIR/venv/bin/python" "$DELETION_DETECTOR_DIR/bot.py" >> "$LOG_DIR/deletion-detector-$(date +%Y-%m-%d).log" 2>&1 &
    DD_PID=$!
    log "Deletion detector started PID=$DD_PID"
    sleep 3
}

start_relay() {
    log "Starting relay on port $PORT..."
    cd "$RELAY_DIR"
    WEBHOOK_PORT=$PORT /usr/bin/node \
        --require /home/ubuntubox/.npm-global/lib/node_modules/tsx/dist/preflight.cjs \
        --import file:///home/ubuntubox/.npm-global/lib/node_modules/tsx/dist/loader.mjs \
        src/index.ts >> "$RELAY_LOG" 2>&1 &
    RELAY_PID=$!
    log "Relay started PID=$RELAY_PID"
    sleep 3
    echo "{\"pid\":$$,\"relay_pid\":$RELAY_PID,\"started\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"port\":$PORT}" > "$RELAY_DIR/.relay.lock"
    log "Lockfile written"
}

monitor_relay() {
    while true; do
        sleep 10
        # Check if relay is still alive
        if [ -n "$RELAY_PID" ]; then
            if ! kill -0 "$RELAY_PID" 2>/dev/null; then
                # Relay died — check why
                wait "$RELAY_PID" 2>/dev/null
                EXIT_CODE=$?
                SIGNAL=$(kill -l $EXIT_CODE 2>/dev/null || echo "unknown")
                log "Relay exited: exit=$EXIT_CODE signal=$SIGNAL"

                if [ "$SIGNAL" = "KILL" ] || [ "$SIGNAL" = "9" ]; then
                    trace_sigkill "$RELAY_PID" "$RELAY_PID"
                    log "Relay died to SIGKILL — NOT restarting (external kill)"
                    # Exit so tilt can restart us
                    exit 1
                elif [ "$EXIT_CODE" = "0" ]; then
                    # Exit 0 means the relay self-exited because the lock was held
                    # by an already-running instance — check if port is already in use
                    PORT_HOLDER=$(lsof -ti :$PORT 2>/dev/null || true)
                    if [ -n "$PORT_HOLDER" ]; then
                        log "Another relay already running on port $PORT (PID $PORT_HOLDER) — NOT restarting"
                        exit 0
                    fi
                    log "Relay self-exited (lock contention) — restarting..."
                    sleep 5
                    start_relay
                else
                    log "Relay crashed or exited — restarting in 5s..."
                    sleep 5
                    start_relay
                fi
            fi
        fi
    done
}

# Start deletion detector once
start_deletion_detector

# Start relay
start_relay

# Monitor in background
monitor_relay &
MONITOR_PID=$!

# Wait for monitor (this blocks)
wait $MONITOR_PID 2>/dev/null

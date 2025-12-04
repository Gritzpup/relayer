#!/bin/bash

# Monitor script for deletion detector bot
# Checks heartbeat and restarts bot if it's not responding

cd "$(dirname "$0")"

HEARTBEAT_FILE="heartbeat.txt"
MAX_AGE=300  # 5 minutes
LOG_FILE="monitor.log"

check_heartbeat() {
    if [[ ! -f "$HEARTBEAT_FILE" ]]; then
        echo "$(date): No heartbeat file found" >> "$LOG_FILE"
        return 1
    fi
    
    local heartbeat_time=$(cat "$HEARTBEAT_FILE" 2>/dev/null)
    if [[ -z "$heartbeat_time" ]]; then
        echo "$(date): Empty heartbeat file" >> "$LOG_FILE"
        return 1
    fi
    
    # Convert heartbeat time to epoch
    local heartbeat_epoch=$(date -d "$heartbeat_time" +%s 2>/dev/null)
    if [[ $? -ne 0 ]]; then
        echo "$(date): Invalid heartbeat format: $heartbeat_time" >> "$LOG_FILE"
        return 1
    fi
    
    local current_epoch=$(date +%s)
    local age=$((current_epoch - heartbeat_epoch))
    
    echo "$(date): Heartbeat age: ${age}s (max: ${MAX_AGE}s)" >> "$LOG_FILE"
    
    if [[ $age -gt $MAX_AGE ]]; then
        echo "$(date): Heartbeat too old (${age}s > ${MAX_AGE}s)" >> "$LOG_FILE"
        return 1
    fi
    
    return 0
}

restart_bot() {
    echo "$(date): Restarting bot due to failed health check" >> "$LOG_FILE"
    
    # Kill existing bot processes
    pkill -f "bot.py" 2>/dev/null
    sleep 5
    
    # Run database unlock
    cd ..
    python3 scripts/unlock_database.py >> "$LOG_FILE" 2>&1
    cd deletion_detector
    
    # Start bot in background
    nohup ./venv/bin/python bot.py >> bot_output.log 2>&1 &
    
    echo "$(date): Bot restart initiated" >> "$LOG_FILE"
}

# Main monitoring logic
echo "$(date): Monitoring bot health" >> "$LOG_FILE"

if ! check_heartbeat; then
    restart_bot
else
    echo "$(date): Bot is healthy" >> "$LOG_FILE"
fi
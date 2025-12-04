#!/bin/bash

# Auto-restart script for deletion detector bot
# This script will restart the bot if it stops unexpectedly

cd "$(dirname "$0")"

LOG_FILE="restart.log"
MAX_RESTARTS=10
RESTART_DELAY=30

echo "$(date): Starting deletion detector with auto-restart" >> "$LOG_FILE"

restart_count=0

while [ $restart_count -lt $MAX_RESTARTS ]; do
    echo "$(date): Starting bot (attempt $((restart_count + 1)))" >> "$LOG_FILE"
    
    # Run database unlock before each restart (after first attempt)
    if [ $restart_count -gt 0 ]; then
        echo "$(date): Running database unlock before restart" >> "$LOG_FILE"
        cd ..
        python3 scripts/unlock_database.py >> "$LOG_FILE" 2>&1
        cd deletion_detector
        sleep 5
    fi
    
    # Start the bot
    ./venv/bin/python bot.py
    
    exit_code=$?
    restart_count=$((restart_count + 1))
    
    echo "$(date): Bot stopped with exit code $exit_code (restart $restart_count/$MAX_RESTARTS)" >> "$LOG_FILE"
    
    # If exit code is 0, it was a clean shutdown, don't restart
    if [ $exit_code -eq 0 ]; then
        echo "$(date): Clean shutdown detected, not restarting" >> "$LOG_FILE"
        break
    fi
    
    # If we've hit max restarts, stop
    if [ $restart_count -ge $MAX_RESTARTS ]; then
        echo "$(date): Maximum restarts reached, giving up" >> "$LOG_FILE"
        break
    fi
    
    echo "$(date): Waiting $RESTART_DELAY seconds before restart" >> "$LOG_FILE"
    sleep $RESTART_DELAY
done

echo "$(date): Auto-restart script finished" >> "$LOG_FILE"
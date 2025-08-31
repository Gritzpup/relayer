#!/bin/bash

# Check if relayer database is locked and manage the process

DB_FILE="/home/ubuntubox/Documents/Github/relayer/relay_messages.db"
RELAYER_DIR="/home/ubuntubox/Documents/Github/relayer"

echo "Checking relayer database lock status..."

# Check if database file exists
if [ ! -f "$DB_FILE" ]; then
    echo "Database file not found: $DB_FILE"
    exit 0
fi

# Check what process is using the database
LOCK_INFO=$(lsof "$DB_FILE" 2>/dev/null)

if [ -z "$LOCK_INFO" ]; then
    echo "✅ Database is not locked"
else
    echo "⚠️  Database is locked by process:"
    echo "$LOCK_INFO"
    
    # Extract PID
    PID=$(echo "$LOCK_INFO" | grep -v COMMAND | awk '{print $2}' | head -1)
    
    if [ ! -z "$PID" ]; then
        echo ""
        echo "Process details:"
        ps -fp "$PID"
        
        echo ""
        read -p "Do you want to kill this process? (y/n): " -n 1 -r
        echo ""
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kill "$PID"
            sleep 1
            
            # Check if process is still running
            if ps -p "$PID" > /dev/null 2>&1; then
                echo "Process didn't terminate, force killing..."
                kill -9 "$PID"
            fi
            
            echo "✅ Process killed"
        else
            echo "Process not killed"
        fi
    fi
fi

# Check for any running relayer processes
echo ""
echo "Checking for relayer processes..."
RELAYER_PROCS=$(ps aux | grep -E "(tsx|node).*relayer" | grep -v grep | grep -v check-relayer)

if [ -z "$RELAYER_PROCS" ]; then
    echo "✅ No relayer processes running"
else
    echo "Found relayer processes:"
    echo "$RELAYER_PROCS"
fi
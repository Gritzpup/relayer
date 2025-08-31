#!/bin/bash

# Script to clean up database locks before starting the relay service

echo "🧹 Cleaning up potential database locks..."

# Remove SQLite journal files if they exist
if [ -f "relay_messages.db-journal" ]; then
    echo "Removing stale journal file..."
    rm -f relay_messages.db-journal
fi

# Remove SQLite shared memory file if it's stale
if [ -f "relay_messages.db-shm" ]; then
    echo "Checking shared memory file..."
    # Check if any process is using the database
    if ! lsof relay_messages.db > /dev/null 2>&1; then
        echo "No processes using database, removing shared memory file..."
        rm -f relay_messages.db-shm
    fi
fi

# Remove WAL file if it's stale
if [ -f "relay_messages.db-wal" ]; then
    echo "Checking WAL file..."
    # Check if any process is using the database
    if ! lsof relay_messages.db > /dev/null 2>&1; then
        echo "No processes using database, removing WAL file..."
        rm -f relay_messages.db-wal
    fi
fi

# Check for the deletion detector session file
SESSION_FILE="deletion_detector/deletion_bot.session"
if [ -f "$SESSION_FILE-journal" ]; then
    echo "Removing deletion detector session journal..."
    rm -f "$SESSION_FILE-journal"
fi

echo "✅ Cleanup complete"
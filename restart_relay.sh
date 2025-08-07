#!/bin/bash

echo "Restarting relay bot with Telegram fixes..."

# Find and kill existing relay process
echo "Stopping existing relay process..."
pkill -f "node.*dist/index.js" || echo "No existing process found"

# Wait a moment for cleanup
sleep 2

# Rebuild the project
echo "Rebuilding project..."
npm run build

# Start the relay bot
echo "Starting relay bot..."
npm run start &

# Get the PID
RELAY_PID=$!
echo "Relay bot started with PID: $RELAY_PID"

# Wait a bit and check if it's still running
sleep 5
if ps -p $RELAY_PID > /dev/null; then
    echo "Relay bot is running successfully!"
    echo ""
    echo "To view logs, run: tail -f logs/relay.log"
    echo "To stop the bot, run: kill $RELAY_PID"
else
    echo "Relay bot failed to start. Check logs for errors."
    exit 1
fi
#!/bin/bash

echo "🚀 Starting Relay Bot..."
echo ""

# Kill any existing processes
echo "🧹 Cleaning up existing processes..."
pkill -f "tsx watch" 2>/dev/null
pkill -f "npm exec tsx" 2>/dev/null
pkill -f "deletion_detector" 2>/dev/null
pkill -f "start-with-deletion" 2>/dev/null

# Kill anything on port 3000
lsof -ti:3000 | xargs -r kill -9 2>/dev/null

# Wait a moment for processes to fully terminate
sleep 2

# Check if port is free
if lsof -i:3000 >/dev/null 2>&1; then
    echo "❌ Port 3000 is still in use!"
    exit 1
fi

echo "✅ Port 3000 is free"
echo ""

# Start the relay bot
echo "🤖 Starting relay bot with deletion detection..."
npm run dev
#!/bin/bash
# Stop the relay so we can run topic ID detection without conflicts

# Find and kill node processes running the relay
pkill -f "node.*start-with-deletion-detector.js"
pkill -f "node.*src/index.ts"

# Kill the deletion detector python process
pkill -f "python.*bot.py"

echo "Relay stopped. You can now run topic detection scripts."
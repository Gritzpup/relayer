#!/bin/bash
# Stop the relay so we can run topic ID detection without conflicts

# Find and kill node processes running the relay
pkill -f "/relayer/.*start-with-deletion-detector.js"
pkill -f "/relayer/.*src/index.ts"

# Kill the deletion detector python process
pkill -f "/relayer/deletion_detector/.*bot.py"

echo "Relay stopped. You can now run topic detection scripts."
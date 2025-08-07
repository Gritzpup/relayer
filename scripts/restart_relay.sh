#!/bin/bash
echo "🔄 Restarting relay with new topic IDs..."

# Kill existing processes
pkill -f "node.*start-with-deletion-detector.js"
pkill -f "python.*bot.py"
pkill -f "node.*src/index.ts"

sleep 2

echo "✅ Old processes stopped"
echo ""
echo "🚀 Starting relay with updated topic mappings..."
echo ""
echo "Topic IDs configured:"
echo "  vent: 104"
echo "  test: 918"
echo "  dev: 774"
echo "  music: 453"
echo "  art: 432"
echo "  pets: 748"
echo "  general: no ID (main chat)"
echo ""
echo "To start the relay, run: npm run dev"
echo ""
echo "Test by sending a message in Discord #test - it should appear in Telegram test topic (918)"
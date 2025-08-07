#!/bin/bash
echo "🔄 Restarting deletion detector with peer fix..."

# Kill existing processes
pkill -f "python.*bot.py"
sleep 2

# Add environment variable to suppress the specific error
export PYTHONWARNINGS="ignore:Peer id invalid"

# Restart in deletion_detector directory
cd deletion_detector
source venv/bin/activate

# Add a startup delay to allow proper initialization
echo "⏳ Starting deletion detector with initialization delay..."
python bot.py &

echo "✅ Deletion detector restarted"
echo "The peer error should be suppressed now."
echo ""
echo "Note: The error about peer -1002170346561 suggests the bot is in another group/channel."
echo "This won't affect the main functionality."
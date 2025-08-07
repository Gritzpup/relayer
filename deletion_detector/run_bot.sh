#!/bin/bash

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    echo "Installing dependencies..."
    ./venv/bin/pip install -r requirements.txt
fi

echo "Starting deletion detector bot..."
echo ""
echo "On first run, you'll need to:"
echo "1. Enter your phone number (with country code, e.g., +1234567890)"
echo "2. Enter the verification code sent to your Telegram app"
echo ""
echo "This creates a session file that will be reused for future runs."
echo ""

# Run the bot
./venv/bin/python bot.py
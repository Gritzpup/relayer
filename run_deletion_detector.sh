#!/bin/bash

echo "Starting Telegram Deletion Detector..."
echo ""
echo "IMPORTANT: This bot monitors Telegram for message deletions."
echo "If you see 'Enter phone number', you need to authenticate first."
echo ""
echo "To authenticate:"
echo "1. Run: cd deletion_detector && ./venv/bin/python authenticate.py"
echo "2. Enter your phone number and verification code"
echo ""
echo "Starting bot..."
echo "=" 
cd deletion_detector && ./venv/bin/python bot.py
#!/usr/bin/env python3
"""Test script to run the deletion detector bot with proper logging"""

import os
import sys
import asyncio
from pyrogram import Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")
GROUP_ID = int(os.getenv("TELEGRAM_GROUP_ID", "0"))

print(f"API_ID: {API_ID}")
print(f"API_HASH: {API_HASH[:10]}..." if API_HASH else "None")
print(f"GROUP_ID: {GROUP_ID}")

# Check session file
session_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sessions")
session_file = os.path.join(session_path, "deletion_detector.session")
print(f"Session path: {session_path}")
print(f"Session file exists: {os.path.exists(session_file)}")

if not os.path.exists(session_file):
    print("ERROR: Session file does not exist! You need to authenticate first.")
    sys.exit(1)

# Initialize client
app = Client(
    "deletion_detector",
    api_id=API_ID,
    api_hash=API_HASH,
    workdir=session_path
)

async def test_connection():
    """Test if we can connect to Telegram"""
    try:
        await app.start()
        me = await app.get_me()
        print(f"Successfully connected as: {me.first_name} ({me.username or 'no username'})")
        print(f"User ID: {me.id}")
        
        # Get chat info
        try:
            chat = await app.get_chat(GROUP_ID)
            print(f"Connected to chat: {chat.title}")
            print(f"Chat type: {chat.type}")
        except Exception as e:
            print(f"Error getting chat info: {e}")
        
        await app.stop()
    except Exception as e:
        print(f"Error connecting: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_connection())
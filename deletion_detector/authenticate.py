#!/usr/bin/env python3
"""
Script to authenticate the deletion detector bot.
Run this manually in a terminal where you can enter your phone number and code.
"""

import os
import sys
from pyrogram import Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")

if not API_ID or not API_HASH:
    print("ERROR: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env file")
    sys.exit(1)

print(f"API_ID: {API_ID}")
print(f"API_HASH: {API_HASH[:10]}...")

# Use absolute path for session
session_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sessions")
os.makedirs(session_path, exist_ok=True)

print(f"Session will be saved to: {session_path}")

# Remove old session if it exists
session_file = os.path.join(session_path, "deletion_detector.session")
if os.path.exists(session_file):
    print(f"Removing old session file: {session_file}")
    os.remove(session_file)

# Initialize client
app = Client(
    "deletion_detector",
    api_id=API_ID,
    api_hash=API_HASH,
    workdir=session_path
)

print("\n" + "="*50)
print("AUTHENTICATION PROCESS")
print("="*50)
print("\nYou will be asked to:")
print("1. Enter your phone number (with country code, e.g., +1234567890)")
print("2. Enter the verification code sent to your Telegram app")
print("\nThis creates a session file that will be reused for future runs.")
print("="*50 + "\n")

with app:
    me = app.get_me()
    print(f"\n✅ Successfully authenticated as: {me.first_name} ({me.username or 'no username'})")
    print(f"User ID: {me.id}")
    print(f"\nSession saved to: {session_file}")
    print("\nYou can now run the deletion detector bot!")
#!/usr/bin/env python3
"""Test if we can access the Telegram group"""

import os
import asyncio
from pyrogram import Client
from dotenv import load_dotenv

load_dotenv()

API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")
GROUP_ID = int(os.getenv("TELEGRAM_GROUP_ID", "0"))

print(f"Testing access to group ID: {GROUP_ID}")

session_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sessions")
app = Client(
    "deletion_detector",
    api_id=API_ID,
    api_hash=API_HASH,
    workdir=session_path
)

async def test():
    await app.start()
    
    # Get your user info
    me = await app.get_me()
    print(f"\nLogged in as: {me.first_name} (@{me.username or 'no username'})")
    
    # Try to list your chats
    print("\nYour chats:")
    async for dialog in app.get_dialogs():
        if dialog.chat.type in ["group", "supergroup"]:
            print(f"- {dialog.chat.title} (ID: {dialog.chat.id})")
            if dialog.chat.id == GROUP_ID:
                print("  ✅ THIS IS YOUR RELAY GROUP!")
    
    # Try to access the specific group
    print(f"\nTrying to access group {GROUP_ID}...")
    try:
        chat = await app.get_chat(GROUP_ID)
        print(f"✅ Success! Group name: {chat.title}")
        print(f"   Type: {chat.type}")
        print(f"   Members count: {chat.members_count}")
    except Exception as e:
        print(f"❌ Error: {e}")
        print("\nPossible issues:")
        print("1. You're not a member of this group")
        print("2. The group ID might be incorrect")
        print("3. You need to join the group with your account")
    
    await app.stop()

asyncio.run(test())
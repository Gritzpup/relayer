#!/usr/bin/env python3
"""
Simple topic monitor - shows recent messages with topic IDs
Just send a message in the food room and I'll show you the topic ID
"""

import asyncio
import os
import sys
from datetime import datetime
from pyrogram import Client, filters
from pyrogram.types import Message
from dotenv import load_dotenv

load_dotenv()

group_id = int(os.getenv("TELEGRAM_GROUP_ID"))
print(f"🍕 FOOD TOPIC FINDER")
print(f"Monitoring group: {group_id}")
print("="*50)
print("1. Go to Telegram food room")  
print("2. Send a message like 'test food topic'")
print("3. The topic ID will appear below")
print("="*50)

# Use existing session from deletion detector
app = Client(
    "deletion_detector",
    workdir="../deletion_detector/sessions"
)

@app.on_message(filters.chat(group_id))
async def show_message_info(client: Client, message: Message):
    """Show info about incoming messages"""
    if hasattr(message, 'message_thread_id') and message.message_thread_id:
        thread_id = message.message_thread_id
        content = (message.text or message.caption or '[Media]')[:100]
        username = message.from_user.username if message.from_user else 'Unknown'
        
        print(f"\n🆕 NEW MESSAGE:")
        print(f"   Topic ID: {thread_id}")
        print(f"   From: @{username}")
        print(f"   Content: {content}")
        print(f"   Time: {datetime.now().strftime('%H:%M:%S')}")
        print("-" * 40)

async def main():
    print("\n⏳ Connecting...")
    async with app:
        print("✅ Connected! Waiting for messages...")
        print("(Press Ctrl+C to stop)")
        
        # Keep running
        await asyncio.Event().wait()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Stopped monitoring")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("Make sure the deletion detector session exists")
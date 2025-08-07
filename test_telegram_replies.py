#!/usr/bin/env python3
import asyncio
import json
from pyrogram import Client, filters
from pyrogram.types import Message
import os
from dotenv import load_dotenv

load_dotenv()

# Get credentials from environment
api_id = os.getenv('TELEGRAM_API_ID')
api_hash = os.getenv('TELEGRAM_API_HASH')
group_id = int(os.getenv('TELEGRAM_GROUP_ID', '0'))

if not api_id or not api_hash:
    print("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in .env")
    exit(1)

# Create client
app = Client(
    "reply_test_bot",
    api_id=api_id,
    api_hash=api_hash
)

# Track messages
message_map = {}

@app.on_message(filters.chat(group_id))
async def handle_message(client: Client, message: Message):
    print("\n=== NEW MESSAGE (Pyrogram) ===")
    print(f"Message ID: {message.id}")
    print(f"From: {message.from_user.username if message.from_user else 'Unknown'}")
    print(f"Text: {message.text}")
    print(f"Topic ID: {message.topic.id if message.topic else 'none'}")
    print(f"Has reply: {message.reply_to_message is not None}")
    print(f"Reply to message ID: {message.reply_to_message_id}")
    print(f"Reply to top message ID: {message.reply_to_top_message_id}")
    
    if message.reply_to_message:
        print("\n--- REPLY DETAILS (Pyrogram) ---")
        reply = message.reply_to_message
        print(f"Reply message ID: {reply.id}")
        print(f"Reply text: {reply.text}")
        print(f"Reply from: {reply.from_user.username if reply.from_user else 'Unknown'}")
        print(f"Reply is bot: {reply.from_user.is_bot if reply.from_user else 'Unknown'}")
        
        # Check if it's a topic reply
        if message.topic and reply.id == message.topic.id:
            print("This is a reply to the topic itself, not a real message reply")
    
    # Store message
    message_map[message.id] = message
    
    # Test command
    if message.text == "/pyrogram_test":
        test_msg = await message.reply("Reply to this message to test Pyrogram reply detection!")
        print(f"\nSent test message {test_msg.id}")
        message_map[test_msg.id] = test_msg
    
    # Debug dump
    if message.text and "debug" in message.text:
        print("\n=== FULL MESSAGE DUMP (Pyrogram) ===")
        # Convert to dict for JSON serialization
        msg_dict = {
            "id": message.id,
            "text": message.text,
            "date": str(message.date),
            "chat_id": message.chat.id,
            "from_user": {
                "id": message.from_user.id,
                "username": message.from_user.username,
                "is_bot": message.from_user.is_bot
            } if message.from_user else None,
            "reply_to_message_id": message.reply_to_message_id,
            "reply_to_top_message_id": message.reply_to_top_message_id,
            "topic": {
                "id": message.topic.id,
                "title": message.topic.title
            } if message.topic else None,
            "message_thread_id": message.message_thread_id
        }
        print(json.dumps(msg_dict, indent=2))

async def main():
    print("Starting Pyrogram reply test...")
    print(f"Group ID: {group_id}")
    
    async with app:
        # Get chat info
        try:
            chat = await app.get_chat(group_id)
            print(f"Chat info: {chat.title} (type: {chat.type})")
        except Exception as e:
            print(f"Failed to get chat info: {e}")
        
        print("\nBot is running. Send messages in the Telegram group to test.")
        print("Commands:")
        print("  /pyrogram_test - Send a test message you can reply to")
        print("  Include 'debug' in your message for full message dump")
        print("\nPress Ctrl+C to stop.")
        
        # Keep the script running
        await app.idle()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopping bot...")
#!/usr/bin/env python3
import os
import asyncio
from pyrogram import Client, filters
from pyrogram.types import Message
from pyrogram.handlers import MessageHandler
from dotenv import load_dotenv
import logging

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")
GROUP_ID = int(os.getenv("TELEGRAM_GROUP_ID", "0"))

# Create client
app = Client(
    "deletion_detector",  # Use same session as main bot
    api_id=API_ID,
    api_hash=API_HASH,
    workdir="./sessions"
)

# Define handler function
async def on_message(client: Client, message: Message):
    logger.info(f"[MESSAGE] {message.id} from {message.from_user.first_name if message.from_user else 'Unknown'}: {message.text or '[Media]'}")

async def main():
    logger.info("Starting test client...")
    
    # Start client first
    await app.start()
    logger.info("Client started")
    
    # Get me info
    me = await app.get_me()
    logger.info(f"Logged in as {me.first_name} (@{me.username})")
    
    # Add handler using MessageHandler object
    handler = MessageHandler(on_message, filters.chat(GROUP_ID))
    app.add_handler(handler)
    logger.info(f"Added handler: {handler}")
    
    # Check dispatcher state
    logger.info(f"Dispatcher: {app.dispatcher}")
    logger.info(f"Dispatcher groups: {app.dispatcher.groups}")
    
    # Check if handlers are registered
    total = 0
    for group_id, handlers in app.dispatcher.groups.items():
        logger.info(f"Group {group_id}: {len(handlers)} handlers")
        total += len(handlers)
    logger.info(f"Total handlers: {total}")
    
    logger.info("Waiting for messages...")
    try:
        await asyncio.Event().wait()
    except KeyboardInterrupt:
        logger.info("Stopping...")
    finally:
        await app.stop()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Stopped by user")
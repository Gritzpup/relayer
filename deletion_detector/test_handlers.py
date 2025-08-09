#!/usr/bin/env python3
import os
import asyncio
from pyrogram import Client, filters
from pyrogram.types import Message
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
    "test_handler",
    api_id=API_ID,
    api_hash=API_HASH,
    workdir="./sessions"
)

# Register handlers BEFORE starting
@app.on_message()
async def handle_all_messages(client: Client, message: Message):
    logger.info(f"Got message {message.id} from {message.from_user.first_name if message.from_user else 'Unknown'}")

@app.on_message(filters.chat(GROUP_ID))
async def handle_group_messages(client: Client, message: Message):
    logger.info(f"Got GROUP message {message.id} in {GROUP_ID}")

@app.on_deleted_messages()
async def handle_deletions(client: Client, messages):
    logger.info(f"Detected {len(messages)} deleted messages")

async def main():
    logger.info("Starting test client...")
    await app.start()
    
    me = await app.get_me()
    logger.info(f"Logged in as {me.first_name} (@{me.username})")
    
    # Check handlers
    logger.info(f"Dispatcher: {app.dispatcher}")
    logger.info(f"Handler groups: {app.dispatcher.groups}")
    
    total = 0
    for group_id, handlers in app.dispatcher.groups.items():
        if handlers:
            logger.info(f"Group {group_id}: {len(handlers)} handlers")
            for handler in handlers:
                logger.info(f"  - {handler}")
            total += len(handlers)
    
    logger.info(f"Total handlers: {total}")
    
    logger.info("Waiting for messages...")
    await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(main())
#!/usr/bin/env python3
import os
import asyncio
import aiohttp
from pyrogram import Client, filters, idle
from pyrogram.types import Message
import sqlite3
from datetime import datetime, timedelta
from dotenv import load_dotenv
import logging
from pyrogram import utils

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Enable Pyrogram logs
logging.getLogger("pyrogram").setLevel(logging.INFO)

# Configuration
API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")
GROUP_ID = int(os.getenv("TELEGRAM_GROUP_ID", "0"))
WEBHOOK_URL = "http://localhost:5847/api/deletion-webhook"
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "relay_messages.db")

logger.info(f"Using database path: {DB_PATH}")
logger.info(f"Monitoring group: {GROUP_ID}")

# Initialize Pyrogram client
session_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sessions")
app = Client(
    "deletion_detector",
    api_id=API_ID,
    api_hash=API_HASH,
    workdir=session_path
)

# Initialize message cache
message_cache = {}

def get_db():
    """Get database connection with proper timeout"""
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except:
        pass
    return conn

# Message handler - using decorator
@app.on_message(filters.chat(GROUP_ID))
async def track_message(client: Client, message: Message):
    """Track all messages in the group"""
    username = message.from_user.username if message.from_user else 'Unknown'
    user_id = message.from_user.id if message.from_user else 'Unknown'
    logger.info(f"[TRACKING] Message {message.id} from @{username} (ID: {user_id})")
    logger.info(f"[TRACKING] Content: {(message.text or message.caption or '[Media]')[:50]}...")
    
    # Store in cache
    message_cache[message.id] = {
        'chat_id': message.chat.id,
        'timestamp': datetime.now(),
        'username': username,
        'content': (message.text or message.caption or '[Media]')[:50]
    }
    
    logger.info(f"Cached message {message.id} (cache size: {len(message_cache)})")

# Deletion handler - using decorator  
@app.on_deleted_messages(filters.chat(GROUP_ID))
async def handle_deleted_messages(client: Client, messages):
    """Handle message deletion events"""
    logger.info(f"=== DELETION DETECTED ===")
    logger.info(f"Deleted {len(messages)} messages: {[msg.id for msg in messages]}")
    
    db = get_db()
    cursor = db.cursor()
    
    for msg in messages:
        try:
            msg_id = msg.id
            logger.info(f"Processing deletion of message {msg_id}")
            
            # Check if we have this message in cache
            if msg_id in message_cache:
                logger.info(f"Message {msg_id} was in our cache")
                del message_cache[msg_id]
            
            # Check database for mapping
            cursor.execute(
                "SELECT mapping_id FROM platform_messages WHERE platform = 'Telegram' AND message_id = ?",
                (str(msg_id),)
            )
            result = cursor.fetchone()
            
            if result and result[0]:
                mapping_id = result[0]
                logger.info(f"Found mapping {mapping_id} for deleted message {msg_id}")
                
                # Notify main bot via webhook
                async with aiohttp.ClientSession() as session:
                    try:
                        webhook_data = {
                            "telegram_msg_id": msg_id,
                            "mapping_id": mapping_id
                        }
                        logger.info(f"Sending webhook: {webhook_data}")
                        async with session.post(WEBHOOK_URL, json=webhook_data) as resp:
                            if resp.status == 200:
                                logger.info(f"Successfully notified main bot")
                            else:
                                logger.error(f"Webhook failed: {resp.status}")
                    except Exception as e:
                        logger.error(f"Failed to notify main bot: {e}")
            else:
                logger.warning(f"No mapping found for message {msg_id}")
                
        except Exception as e:
            logger.error(f"Error handling deleted message: {e}")
    
    db.close()

async def periodic_check():
    """Periodically check for deleted messages"""
    await asyncio.sleep(10)  # Initial delay
    check_count = 0
    
    while True:
        await asyncio.sleep(30)
        check_count += 1
        
        try:
            logger.debug(f"[PERIODIC CHECK #{check_count}] Checking {len(message_cache)} cached messages")
            current_time = datetime.now()
            messages_to_check = []
            
            # Check messages older than 10 seconds
            for msg_id, msg_data in list(message_cache.items()):
                msg_age = (current_time - msg_data['timestamp']).total_seconds()
                if msg_age > 10 and msg_age < 3600:
                    messages_to_check.append((msg_id, msg_data['chat_id']))
            
            logger.info(f"Checking {len(messages_to_check)} messages for deletion")
            
            for msg_id, chat_id in messages_to_check[:50]:  # Limit to 50
                try:
                    # Get single message
                    msg = await app.get_messages(chat_id, msg_id)
                    
                    # Check if message was deleted
                    if msg is None or msg.empty:
                        logger.info(f"Message {msg_id} was deleted")
                        # Create deleted message object
                        class DeletedMsg:
                            def __init__(self, id):
                                self.id = id
                        
                        await handle_deleted_messages(None, [DeletedMsg(msg_id)])
                        
                except Exception as e:
                    if "MESSAGE_ID_INVALID" in str(e):
                        logger.info(f"Message {msg_id} was deleted (INVALID)")
                        class DeletedMsg:
                            def __init__(self, id):
                                self.id = id
                        await handle_deleted_messages(None, [DeletedMsg(msg_id)])
                        
        except Exception as e:
            logger.error(f"Error in periodic check: {e}")

@app.on_message(filters.private)
async def handle_private(client: Client, message: Message):
    """Handle private messages to avoid unhandled updates"""
    logger.debug(f"Received private message from {message.from_user.first_name if message.from_user else 'Unknown'}")

# Catch-all handler for other groups to prevent unhandled updates
@app.on_message(~filters.chat(GROUP_ID) & filters.group)
async def handle_other_groups(client: Client, message: Message):
    """Handle messages from other groups to avoid peer resolution errors"""
    pass  # Silently ignore messages from other groups

@app.on_deleted_messages(~filters.chat(GROUP_ID))
async def handle_other_deletions(client: Client, messages):
    """Handle deletions from other groups to avoid peer resolution errors"""
    pass  # Silently ignore deletions from other groups

# Main function
async def main():
    logger.info("="*60)
    logger.info("Starting Telegram Deletion Detector")
    logger.info(f"Monitoring group: {GROUP_ID}")
    logger.info(f"Webhook URL: {WEBHOOK_URL}")
    logger.info("="*60)
    
    # Start the client
    await app.start()
    
    # Get session info
    me = await app.get_me()
    logger.info(f"Logged in as: {me.first_name} @{me.username} (ID: {me.id})")
    
    # Verify group access
    try:
        chat = await app.get_chat(GROUP_ID)
        logger.info(f"Monitoring: {chat.title} (ID: {chat.id})")
        logger.info(f"Type: {chat.type}, Members: {chat.members_count}")
    except Exception as e:
        logger.error(f"Cannot access group: {e}")
    
    # Pre-resolve peers to avoid errors
    logger.info("Pre-resolving peer information...")
    try:
        async for dialog in app.get_dialogs(limit=100):
            try:
                # Just accessing the dialog pre-resolves the peer
                logger.debug(f"Resolved peer: {dialog.chat.title if dialog.chat.title else dialog.chat.id}")
            except Exception as e:
                logger.debug(f"Could not resolve peer: {e}")
    except Exception as e:
        logger.debug(f"Error pre-resolving peers: {e}")
    
    # Start periodic check
    asyncio.create_task(periodic_check())
    
    logger.info("Bot is running and monitoring for deletions...")
    logger.info("="*60)
    
    # Keep running
    await idle()
    
    # Cleanup
    await app.stop()

if __name__ == "__main__":
    app.run(main())
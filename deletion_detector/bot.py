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
WEBHOOK_PORT = os.getenv("WEBHOOK_PORT", "5847")
WEBHOOK_URL = f"http://localhost:{WEBHOOK_PORT}/api/deletion-webhook"
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

# Initialize message cache with size limit
message_cache = {}
MAX_CACHE_SIZE = 200  # Limit cache to 200 messages to prevent memory issues
CACHE_MAX_AGE = 600  # 10 minutes in seconds

def cleanup_old_cache_entries():
    """Remove old entries from message cache to prevent memory leaks"""
    current_time = datetime.now()
    entries_to_remove = []
    
    for msg_id, msg_data in message_cache.items():
        age = (current_time - msg_data['timestamp']).total_seconds()
        if age > CACHE_MAX_AGE:
            entries_to_remove.append(msg_id)
    
    for msg_id in entries_to_remove:
        del message_cache[msg_id]
    
    if entries_to_remove:
        logger.info(f"Cleaned up {len(entries_to_remove)} old cache entries")

def get_db():
    """Get database connection with proper timeout and WAL mode"""
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    # Set WAL mode and busy timeout for better concurrency
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")  # 5 second busy timeout
    conn.execute("PRAGMA synchronous=NORMAL")  # Better performance with WAL
    return conn

# Message handler - using decorator
@app.on_message(filters.chat(GROUP_ID))
async def track_message(client: Client, message: Message):
    """Track ALL messages in the group including bot messages"""
    username = message.from_user.username if message.from_user else 'Unknown'
    user_id = message.from_user.id if message.from_user else 'Unknown'
    is_bot = message.from_user.is_bot if message.from_user else False
    
    logger.info(f"[TRACKING] Message {message.id} from @{username} (ID: {user_id}, Bot: {is_bot})")
    logger.info(f"[TRACKING] Content: {(message.text or message.caption or '[Media]')[:50]}...")
    
    # Store ALL messages in cache, including bot messages
    message_cache[message.id] = {
        'chat_id': message.chat.id,
        'timestamp': datetime.now(),
        'username': username,
        'user_id': user_id,
        'content': (message.text or message.caption or '[Media]')[:50],
        'is_bot': is_bot,  # Track if it's a bot message
        'is_own': message.from_user and message.from_user.is_self
    }
    
    logger.info(f"Cached message {message.id} (cache size: {len(message_cache)}, bot: {is_bot})")
    
    # Clean up old messages from cache if it's getting too large
    if len(message_cache) > MAX_CACHE_SIZE:
        cleanup_old_cache_entries()

# Deletion handler - using decorator  
@app.on_deleted_messages(filters.chat(GROUP_ID))
async def handle_deleted_messages(client: Client, messages):
    """Handle message deletion events"""
    logger.info(f"=== DELETION DETECTED ===")
    logger.info(f"Deleted {len(messages)} messages: {[msg.id for msg in messages]}")
    logger.info(f"Detection method: {'Event' if client else 'Periodic Check'}")
    
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
        await asyncio.sleep(15)  # Check more frequently (every 15 seconds instead of 30)
        check_count += 1
        
        try:
            # Only log debug if we have a meaningful number of messages
            if len(message_cache) > 1:
                logger.debug(f"[PERIODIC CHECK #{check_count}] Checking {len(message_cache)} cached messages")
            
            current_time = datetime.now()
            messages_to_check = []
            
            # Check messages with different timing based on type
            for msg_id, msg_data in list(message_cache.items()):
                msg_age = (current_time - msg_data['timestamp']).total_seconds()
                is_bot = msg_data.get('is_bot', False)
                is_own = msg_data.get('is_own', False)
                
                # Check bot messages (relayed messages) more aggressively (after 3 seconds)
                # Check own messages after 5 seconds
                # Check other messages after 10 seconds
                if is_bot:
                    min_age = 3  # Bot messages checked very quickly
                elif is_own:
                    min_age = 5  # Own messages checked quickly
                else:
                    min_age = 10  # Other messages normal timing
                
                if msg_age > min_age and msg_age < CACHE_MAX_AGE:
                    messages_to_check.append((msg_id, msg_data['chat_id'], is_bot))
                elif msg_age > CACHE_MAX_AGE:
                    # Remove very old messages from cache
                    del message_cache[msg_id]
            
            # Only log if we have actual messages to check
            if messages_to_check and len(messages_to_check) > 1:
                bot_msg_count = sum(1 for _, _, is_bot in messages_to_check if is_bot)
                logger.info(f"Checking {len(messages_to_check)} messages for deletion (including {bot_msg_count} bot messages)")
            
            for msg_id, chat_id, is_bot in messages_to_check[:50]:  # Limit to 50
                try:
                    # Get single message
                    msg = await app.get_messages(chat_id, msg_id)
                    
                    # Check if message was deleted
                    if msg is None or msg.empty:
                        logger.info(f"Message {msg_id} was deleted (bot message: {is_bot})")
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
    
    # Add test command for manual deletion trigger
    if message.text and message.text.startswith("/testdelete "):
        try:
            msg_id = int(message.text.split()[1])
            logger.info(f"Manual deletion test for message {msg_id}")
            
            # Create deleted message object
            class DeletedMsg:
                def __init__(self, id):
                    self.id = id
            
            await handle_deleted_messages(None, [DeletedMsg(msg_id)])
            await message.reply("Deletion event triggered")
        except (ValueError, IndexError):
            await message.reply("Usage: /testdelete <message_id>")

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
    
    # Add a small delay to avoid startup conflicts with other SQLite databases
    await asyncio.sleep(2)
    
    # Start the client with retry logic for database lock issues
    max_retries = 10  # Increased from 3
    retry_delay = 2
    
    for attempt in range(max_retries):
        try:
            # Clear any potential locks first
            if attempt > 0:
                # Try to force close any hanging database connections
                try:
                    import gc
                    gc.collect()
                    await asyncio.sleep(0.5)
                except:
                    pass
            
            await app.start()
            logger.info("Successfully started Pyrogram client")
            break
        except (sqlite3.OperationalError, Exception) as e:
            error_msg = str(e).lower()
            if ("database is locked" in error_msg or "database lock" in error_msg) and attempt < max_retries - 1:
                logger.warning(f"Database locked, retrying in {retry_delay} seconds... (attempt {attempt + 1}/{max_retries})")
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 1.5, 30)  # Exponential backoff with cap
            else:
                if attempt == max_retries - 1:
                    logger.error(f"Failed to start client after {max_retries} attempts. Forcing database cleanup...")
                    # Last resort: try to remove the session file and recreate
                    try:
                        import os
                        session_file = "deletion_detector/deletion_bot.session"
                        if os.path.exists(session_file):
                            logger.warning("Removing locked session file...")
                            os.remove(session_file)
                            # Try one more time with fresh session
                            await asyncio.sleep(2)
                            await app.start()
                            logger.info("Successfully started with fresh session")
                            break
                    except Exception as cleanup_err:
                        logger.error(f"Cleanup failed: {cleanup_err}")
                        raise e
                else:
                    raise
    
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
    
    # Pre-resolve only the monitored group's peer
    logger.info("Pre-resolving monitored group peer...")
    try:
        # Only resolve the specific group we're monitoring
        await app.resolve_peer(GROUP_ID)
        logger.debug(f"Resolved monitored group peer: {GROUP_ID}")
    except Exception as e:
        logger.debug(f"Error pre-resolving monitored group peer: {e}")
    
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
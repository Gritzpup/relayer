import os
import asyncio
import aiohttp
from pyrogram import Client, filters
from pyrogram.types import Message
from pyrogram.handlers import DeletedMessagesHandler
import sqlite3
from datetime import datetime, timedelta
from dotenv import load_dotenv
import logging
from pyrogram import utils

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Suppress Pyrogram's verbose debug logs
logging.getLogger("pyrogram").setLevel(logging.WARNING)

# Configuration
API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")
GROUP_ID = int(os.getenv("TELEGRAM_GROUP_ID", "0"))
WEBHOOK_URL = "http://localhost:3000/api/deletion-webhook"
DB_PATH = "../relay_messages.db"

if not API_ID or not API_HASH:
    logger.error("TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env file")
    exit(1)

if GROUP_ID == 0:
    logger.error("TELEGRAM_GROUP_ID must be set in .env file")
    exit(1)

# Initialize Pyrogram client
# Use absolute path for session to avoid issues with working directory
session_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sessions")
app = Client(
    "deletion_detector",
    api_id=API_ID,
    api_hash=API_HASH,
    workdir=session_path
)

# Track resolved peers
resolved_peers = set()

# Monkey patch to ignore peer resolution errors from other groups
original_get_peer_type = utils.get_peer_type

def safe_get_peer_type(peer_id: int):
    """Safely get peer type, ignoring unknown peers"""
    try:
        return original_get_peer_type(peer_id)
    except ValueError as e:
        if "Peer id invalid" in str(e):
            logger.debug(f"Ignoring unknown peer: {peer_id}")
            # Return channel type for unknown peers to avoid crashes
            return "channel"
        raise

# Apply the monkey patch
utils.get_peer_type = safe_get_peer_type

def get_db():
    """Get database connection"""
    return sqlite3.connect(DB_PATH)

@app.on_message(filters.chat(GROUP_ID))
async def track_message(client: Client, message: Message):
    """Track all messages in the group"""
    # Skip bot messages except the relay bot
    if message.from_user and message.from_user.is_bot:
        if message.from_user.username != "GritzRelayerBot":
            return
    
    # For user messages (not bot messages), wait a bit for the main bot to process it
    if not (message.from_user and message.from_user.is_bot):
        await asyncio.sleep(0.5)  # Give main bot time to create mapping_id
        
    db = get_db()
    cursor = db.cursor()
    
    try:
        # Check if this message has been tracked by the main bot with a mapping_id
        cursor.execute("""
            SELECT mapping_id FROM message_tracking 
            WHERE telegram_msg_id = ? AND platform = 'Telegram'
        """, (message.id,))
        
        existing = cursor.fetchone()
        
        if existing and existing[0]:
            # Message already tracked with mapping_id
            logger.debug(f"Message {message.id} already tracked with mapping {existing[0]}")
        else:
            # Track it without mapping_id for now (main bot will update it later)
            cursor.execute("""
                INSERT OR IGNORE INTO message_tracking 
                (telegram_msg_id, chat_id, user_id, username, content, platform)
                VALUES (?, ?, ?, ?, ?, 'Telegram')
            """, (
                message.id,
                message.chat.id,
                message.from_user.id if message.from_user else None,
                message.from_user.username if message.from_user else None,
                message.text or message.caption or '[Media]'
            ))
            
            db.commit()
            logger.info(f"Tracked message {message.id} from {message.from_user.username if message.from_user else 'Unknown'} (waiting for mapping_id)")
    except Exception as e:
        logger.error(f"Error tracking message: {e}")
    finally:
        db.close()

@app.on_deleted_messages(filters.chat(GROUP_ID))
async def handle_deleted_messages(client: Client, messages):
    """Handle message deletion events"""
    logger.info(f"=== DELETION HANDLER TRIGGERED ===")
    logger.info(f"Detected {len(messages)} deleted messages")
    logger.info(f"Deleted message IDs: {[msg.id for msg in messages]}")
    
    db = get_db()
    cursor = db.cursor()
    
    for msg in messages:
        try:
            logger.info(f"Processing deletion of message {msg.id}")
            
            # Get mapping ID (might have been updated since tracking)
            cursor.execute(
                "SELECT mapping_id FROM message_tracking WHERE telegram_msg_id = ?",
                (msg.id,)
            )
            result = cursor.fetchone()
            
            # Mark as deleted in database
            cursor.execute("""
                UPDATE message_tracking 
                SET is_deleted = TRUE, deleted_at = datetime('now')
                WHERE telegram_msg_id = ?
            """, (msg.id,))
            
            if result and result[0]:
                logger.info(f"Found mapping {result[0]} for deleted message {msg.id}")
                # Notify main bot
                async with aiohttp.ClientSession() as session:
                    try:
                        async with session.post(WEBHOOK_URL, json={
                            "telegram_msg_id": msg.id,
                            "mapping_id": result[0]
                        }) as resp:
                            if resp.status == 200:
                                logger.info(f"Successfully notified main bot about deletion")
                            else:
                                text = await resp.text()
                                logger.error(f"Webhook returned status {resp.status}: {text}")
                    except Exception as e:
                        logger.error(f"Failed to notify main bot: {e}")
            else:
                logger.warning(f"No mapping_id found for deleted message {msg.id} - it may not have been relayed")
                
        except Exception as e:
            logger.error(f"Error handling deleted message {msg.id}: {e}")
    
    db.commit()
    db.close()

async def periodic_check():
    """Periodically check for deleted messages"""
    # Track when the bot started to avoid checking old messages
    bot_start_time = datetime.now()
    logger.info(f"Periodic check will only monitor messages after {bot_start_time}")
    
    while True:
        await asyncio.sleep(30)  # Check every 30 seconds
        
        db = get_db()
        cursor = db.cursor()
        
        try:
            # Only check messages that were tracked after the bot started
            # AND are at least 10 seconds old (to avoid race conditions)
            check_after = bot_start_time.strftime('%Y-%m-%d %H:%M:%S')
            check_before = (datetime.now() - timedelta(seconds=10)).strftime('%Y-%m-%d %H:%M:%S')
            
            cursor.execute("""
                SELECT telegram_msg_id, chat_id 
                FROM message_tracking
                WHERE timestamp > ? 
                AND timestamp < ?
                AND is_deleted = FALSE
                AND platform = 'Telegram'
                LIMIT 50
            """, (check_after, check_before))
            
            messages = cursor.fetchall()
            logger.info(f"Periodic check: Checking {len(messages)} messages for deletion")
            
            for msg_id, chat_id in messages:
                try:
                    # Try to get the message
                    msgs = await app.get_messages(chat_id, msg_id)
                    if msgs.empty:
                        logger.info(f"Message {msg_id} not found - marking as deleted")
                        # Create a simple object with just the ID
                        class DeletedMsg:
                            def __init__(self, id):
                                self.id = id
                        await handle_deleted_messages(None, [DeletedMsg(msg_id)])
                except Exception as e:
                    if "MESSAGE_ID_INVALID" in str(e) or "message not found" in str(e).lower():
                        logger.info(f"Message {msg_id} was deleted - marking in DB")
                        class DeletedMsg:
                            def __init__(self, id):
                                self.id = id
                        await handle_deleted_messages(None, [DeletedMsg(msg_id)])
                    else:
                        logger.debug(f"Error checking message {msg_id}: {e}")
        
        except Exception as e:
            logger.error(f"Error in periodic check: {e}")
        finally:
            db.close()

async def main():
    """Main function to run the bot"""
    logger.info(f"Deletion detector bot started, monitoring group {GROUP_ID}")
    
    # Set up error handler for peer resolution errors
    def handle_peer_error(loop, context):
        exception = context.get('exception')
        if exception and "Peer id invalid" in str(exception):
            logger.debug(f"Ignoring peer resolution error: {exception}")
            return
        # Call the default handler for other errors
        loop.default_exception_handler(context)
    
    # Install the error handler
    asyncio.get_event_loop().set_exception_handler(handle_peer_error)
    
    try:
        # Start the Pyrogram client
        await app.start()
        logger.info("Bot connected successfully")
        
        # Verify we can access the group and resolve peers
        try:
            # Add a small delay to ensure client is fully initialized
            await asyncio.sleep(1)
            
            # Pre-resolve the main group to avoid peer resolution errors
            try:
                await app.resolve_peer(GROUP_ID)
                resolved_peers.add(GROUP_ID)
                logger.info(f"Resolved peer for group {GROUP_ID}")
            except Exception as e:
                logger.warning(f"Could not pre-resolve group {GROUP_ID}: {e}")
            
            chat = await app.get_chat(GROUP_ID)
            logger.info(f"Monitoring group: {chat.title}")
            logger.info(f"Group type: {chat.type}")
            logger.info(f"Members count: {chat.members_count}")
            
            # Try to resolve any other groups the bot is in
            try:
                async for dialog in app.get_dialogs():
                    if dialog.chat.id not in resolved_peers:
                        try:
                            await app.resolve_peer(dialog.chat.id)
                            resolved_peers.add(dialog.chat.id)
                            logger.debug(f"Pre-resolved peer: {dialog.chat.id} ({dialog.chat.title})")
                        except Exception as e:
                            logger.debug(f"Could not resolve peer {dialog.chat.id}: {e}")
            except Exception as e:
                logger.debug(f"Could not enumerate dialogs: {e}")
                
        except Exception as e:
            logger.error(f"Cannot access group {GROUP_ID}: {e}")
            logger.error("This might be a temporary issue. The bot will continue running.")
            # Don't return - let it continue running since the handlers might still work
        
        # Start periodic check in background
        asyncio.create_task(periodic_check())
        
        logger.info("Bot is running and monitoring for deletions...")
        
        # Keep the bot running
        await asyncio.Event().wait()
    except Exception as e:
        logger.error(f"Failed to start bot: {e}")
        raise

if __name__ == "__main__":
    logger.info("Starting deletion detector bot...")
    
    # Create sessions directory if it doesn't exist
    session_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sessions")
    os.makedirs(session_dir, exist_ok=True)
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Bot stopped by user")
    except Exception as e:
        logger.error(f"Bot crashed: {e}")
        import sys
        sys.exit(1)  # Exit with error code
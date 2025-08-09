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
    level=logging.DEBUG,  # Set to DEBUG for more detailed logs
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Enable Pyrogram logs to see what's happening
logging.getLogger("pyrogram").setLevel(logging.INFO)

# Configuration
API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")
GROUP_ID = int(os.getenv("TELEGRAM_GROUP_ID", "0"))
WEBHOOK_URL = "http://localhost:3000/api/deletion-webhook"
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "relay_messages.db")
logger.info(f"Using database path: {DB_PATH}")

# Check if database exists
if os.path.exists(DB_PATH):
    logger.info(f"Database file exists at {DB_PATH}")
    try:
        test_db = sqlite3.connect(DB_PATH, timeout=30.0)
        test_db.execute("PRAGMA journal_mode=WAL")
        test_db.close()
        logger.info("Database is accessible")
    except Exception as e:
        logger.error(f"Cannot access database: {e}")
else:
    logger.error(f"Database file NOT FOUND at {DB_PATH}")

if not API_ID or not API_HASH:
    logger.error("TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env file")
    exit(1)

if GROUP_ID == 0:
    logger.error("TELEGRAM_GROUP_ID must be set in .env file")
    exit(1)

# Initialize Pyrogram client as user account
# Use absolute path for session to avoid issues with working directory
session_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sessions")
app = Client(
    "deletion_detector",  # Use existing session name
    api_id=API_ID,
    api_hash=API_HASH,
    workdir=session_path
)

# Simple test handler without any filters
@app.on_message()
async def test_any_message(client: Client, message: Message):
    """Test handler to catch ANY message"""
    logger.info(f"[TEST HANDLER] Got ANY message: {message.id} in chat {message.chat.id if message.chat else 'Unknown'}")

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
    """Get database connection with proper timeout"""
    conn = sqlite3.connect(DB_PATH, timeout=30.0)  # 30 second timeout
    # Try to enable WAL mode for better concurrency
    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except:
        pass  # Ignore if already set or not supported
    return conn

# Test if handlers are being registered
logger.info(f"Registering handlers for GROUP_ID: {GROUP_ID}")

# Debug handler to catch ALL messages - register FIRST
@app.on_message()
async def debug_all_messages(client: Client, message: Message):
    """Debug handler to see all messages"""
    logger.debug(f"[DEBUG ALL] Got message {message.id} in chat {message.chat.id if message.chat else 'Unknown'}")
    if message.chat and message.chat.id == GROUP_ID:
        logger.debug(f"[DEBUG ALL] This message IS in our target group!")

# Handler for messages in our specific group
@app.on_message(filters.chat(GROUP_ID))
async def track_message(client: Client, message: Message):
    """Track all messages in the group"""
    username = message.from_user.username if message.from_user else 'Unknown'
    user_id = message.from_user.id if message.from_user else 'Unknown'
    logger.info(f"[TRACKING] Message {message.id} from @{username} (ID: {user_id}) in chat {message.chat.id}")
    logger.info(f"[TRACKING] Content preview: {(message.text or message.caption or '[Media]')[:50]}...")
    
    # Track message in memory for deletion detection
    # Store in a simple cache for periodic checking
    if not hasattr(app, 'message_cache'):
        app.message_cache = {}
    
    app.message_cache[message.id] = {
        'chat_id': message.chat.id,
        'timestamp': datetime.now(),
        'username': message.from_user.username if message.from_user else 'Unknown',
        'content': (message.text or message.caption or '[Media]')[:50]
    }
    
    logger.info(f"Cached message {message.id} for deletion tracking (cache size: {len(app.message_cache)})")

# Handler for deleted messages
logger.info(f"Registering deletion handler for GROUP_ID: {GROUP_ID}")

# Test handler to catch ANY deletion
@app.on_deleted_messages()
async def handle_any_deleted_messages(client: Client, messages):
    """Debug handler for ANY deletion"""
    logger.info(f"[DELETION EVENT] ANY deletion detected: {len(messages)} messages")
    logger.info(f"[DELETION EVENT] Message IDs: {[msg.id for msg in messages]}")
    logger.info(f"[DELETION EVENT] Chat ID: {messages[0].chat.id if messages and messages[0].chat else 'Unknown'}")
    for msg in messages:
        if msg.chat and msg.chat.id == GROUP_ID:
            logger.info(f"[DELETION EVENT] This deletion IS in our target group {GROUP_ID}!")

@app.on_deleted_messages(filters.chat(GROUP_ID))
async def handle_deleted_messages(client: Client, messages, is_periodic=False):
    """Handle message deletion events"""
    if not is_periodic:
        logger.info(f"=== REAL-TIME DELETION DETECTED ===")
        logger.info(f"Pyrogram real-time handler triggered!")
    else:
        logger.info(f"=== PERIODIC CHECK DELETION ===")
    logger.info(f"Detected {len(messages)} deleted messages")
    logger.info(f"Deleted message IDs: {[msg.id for msg in messages]}")
    
    db = get_db()
    cursor = db.cursor()
    
    for msg in messages:
        try:
            logger.info(f"Processing deletion of message {msg.id}")
            
            # First check if message exists in database at all
            cursor.execute(
                "SELECT telegram_msg_id, mapping_id, platform FROM message_tracking WHERE telegram_msg_id = ?",
                (msg.id,)
            )
            result = cursor.fetchone()
            
            logger.info(f"Database lookup for message {msg.id}: {result}")
            
            # Also check the platform_messages table
            cursor.execute(
                "SELECT mapping_id FROM platform_messages WHERE platform = 'Telegram' AND message_id = ?",
                (str(msg.id),)
            )
            mapping_result = cursor.fetchone()
            logger.info(f"Direct mapping lookup for message {msg.id}: {mapping_result}")
            
            # Mark as deleted in database
            cursor.execute("""
                UPDATE message_tracking 
                SET is_deleted = TRUE, deleted_at = datetime('now')
                WHERE telegram_msg_id = ?
            """, (msg.id,))
            
            # Determine the mapping_id from either source
            mapping_id = None
            if result and result[1]:  # result[1] is mapping_id from message_tracking
                mapping_id = result[1]
                logger.info(f"Found mapping {mapping_id} in message_tracking for deleted message {msg.id}")
            elif mapping_result and mapping_result[0]:  # mapping_result[0] is id from message_mappings
                mapping_id = mapping_result[0]
                logger.info(f"Found mapping {mapping_id} in message_mappings for deleted message {msg.id}")
            
            if mapping_id:
                # Notify main bot
                async with aiohttp.ClientSession() as session:
                    try:
                        webhook_data = {
                            "telegram_msg_id": msg.id,
                            "mapping_id": mapping_id
                        }
                        logger.info(f"Sending webhook with data: {webhook_data}")
                        async with session.post(WEBHOOK_URL, json=webhook_data) as resp:
                            if resp.status == 200:
                                response_data = await resp.json()
                                logger.info(f"Successfully notified main bot about deletion")
                                logger.info(f"Webhook response: {response_data}")
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
    check_count = 0
    
    while True:
        await asyncio.sleep(30)  # Check every 30 seconds
        check_count += 1
        
        db = get_db()
        cursor = db.cursor()
        
        try:
            logger.debug(f"[PERIODIC CHECK #{check_count}] Starting periodic deletion check...")
            # Only check messages that were tracked after the bot started
            # AND are at least 10 seconds old (to avoid race conditions)
            check_after = bot_start_time.strftime('%Y-%m-%d %H:%M:%S')
            check_before = (datetime.now() - timedelta(seconds=10)).strftime('%Y-%m-%d %H:%M:%S')
            
            # Check messages from our in-memory cache
            if not hasattr(app, 'message_cache'):
                app.message_cache = {}
                
            messages_to_check = []
            current_time = datetime.now()
            
            # Only check messages older than 10 seconds to avoid race conditions
            for msg_id, msg_data in list(app.message_cache.items()):
                msg_age = (current_time - msg_data['timestamp']).total_seconds()
                if msg_age > 10 and msg_age < 3600:  # Between 10 seconds and 1 hour old
                    messages_to_check.append((msg_id, msg_data['chat_id']))
            
            logger.info(f"Periodic check: Checking {len(messages_to_check)} messages for deletion (cache has {len(app.message_cache)} total)")
            messages = messages_to_check[:50]  # Limit to 50 at a time
            
            for msg_id, chat_id in messages:
                try:
                    # Try to get the message
                    msg = await app.get_messages(chat_id, msg_id)
                    if msg is None or (hasattr(msg, 'empty') and msg.empty) or (hasattr(msg, 'text') and msg.text is None and msg.media is None):
                        logger.info(f"Message {msg_id} not found - marking as deleted")
                        # Create a simple object with just the ID
                        class DeletedMsg:
                            def __init__(self, id):
                                self.id = id
                        await handle_deleted_messages(None, [DeletedMsg(msg_id)], is_periodic=True)
                        # Remove from cache
                        if hasattr(app, 'message_cache') and msg_id in app.message_cache:
                            del app.message_cache[msg_id]
                except Exception as e:
                    if "MESSAGE_ID_INVALID" in str(e) or "message not found" in str(e).lower():
                        logger.info(f"Message {msg_id} was deleted - marking in DB")
                        class DeletedMsg:
                            def __init__(self, id):
                                self.id = id
                        await handle_deleted_messages(None, [DeletedMsg(msg_id)], is_periodic=True)
                        # Remove from cache
                        if hasattr(app, 'message_cache') and msg_id in app.message_cache:
                            del app.message_cache[msg_id]
                    else:
                        logger.debug(f"Error checking message {msg_id}: {e}")
        
        except Exception as e:
            logger.error(f"Error in periodic check: {e}")
        finally:
            db.close()

async def main():
    """Main function to run the bot"""
    logger.info("="*60)
    logger.info(f"Deletion detector bot started, monitoring group {GROUP_ID}")
    logger.info(f"Monitoring as numeric group ID: {GROUP_ID}")
    logger.info(f"Expected chat ID format: {GROUP_ID}")
    logger.info(f"Webhook URL: {WEBHOOK_URL}")
    logger.info(f"Database path: {DB_PATH}")
    logger.info("="*60)
    
    # Initialize message cache
    app.message_cache = {}
    
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
        logger.info("Starting Pyrogram client...")
        await app.start()
        logger.info("Bot connected successfully")
        
        # Get session info and verify authentication
        me = await app.get_me()
        logger.info("="*60)
        logger.info("SESSION VERIFICATION")
        logger.info(f"User account logged in as: {me.first_name} @{me.username} (ID: {me.id})")
        logger.info(f"Phone number: {me.phone_number if hasattr(me, 'phone_number') else 'N/A'}")
        logger.info(f"Is bot: {me.is_bot}")
        logger.info(f"Is verified: {me.is_verified if hasattr(me, 'is_verified') else 'N/A'}")
        logger.info(f"This user account will track all messages including deletions")
        logger.info("="*60)
        
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
            logger.info(f"Group chat ID: {chat.id}")
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
        
        # Log that we're ready
        logger.info("Deletion detector is ready and monitoring for messages and deletions")
        
        # Log handler status
        logger.info("="*60)
        logger.info("HANDLER STATUS CHECK")
        logger.info(f"Dispatcher object: {app.dispatcher}")
        logger.info(f"Dispatcher groups: {app.dispatcher.groups}")
        
        # Count all handlers
        total_handlers = 0
        for group_id, handlers in app.dispatcher.groups.items():
            if handlers:
                total_handlers += len(handlers)
                logger.info(f"  Group {group_id}: {len(handlers)} handlers - {[h.__name__ for h in handlers]}")
        
        logger.info(f"Total handlers registered: {total_handlers}")
        logger.info("="*60)
        
        # Keep the bot running
        logger.info("Bot is now monitoring for messages and deletions...")
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
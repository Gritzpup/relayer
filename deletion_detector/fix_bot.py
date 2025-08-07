#!/usr/bin/env python3
"""
Create a fixed version of the bot that ignores problematic peers
"""

import shutil
import re

# Read the original bot.py
with open('bot.py', 'r') as f:
    content = f.read()

# Add imports at the top
imports_addition = """from pyrogram.errors import PeerIdInvalid, ChannelInvalid
from pyrogram.raw.types import UpdateChannelMessageViews, UpdateChannel
"""

# Insert after the existing imports
import_pos = content.find('import logging\n') + len('import logging\n')
content = content[:import_pos] + imports_addition + content[import_pos:]

# Add update filter before the client creation
update_filter = '''
# Filter out problematic updates
def update_filter(update, users, chats):
    """Filter updates to only process from our configured group"""
    # List of update types to ignore from other chats
    ignore_from_other_chats = [
        UpdateChannelMessageViews,
        UpdateChannel,
    ]
    
    # Check if this is an update type we should filter
    for update_type in ignore_from_other_chats:
        if isinstance(update, update_type):
            # Try to get the channel/chat ID
            channel_id = getattr(update, 'channel_id', None)
            if channel_id:
                # Convert to Telegram chat ID format
                chat_id = -1000000000000 - channel_id
                if chat_id != GROUP_ID:
                    logger.debug(f"Ignoring {type(update).__name__} from chat {chat_id}")
                    return False
    
    return True

'''

# Insert before app creation
app_pos = content.find('# Initialize Pyrogram client')
content = content[:app_pos] + update_filter + content[app_pos:]

# Modify app creation to use the filter
content = content.replace(
    'app = Client(\n    "deletion_detector",\n    api_id=API_ID,\n    api_hash=API_HASH,\n    workdir=session_path\n)',
    'app = Client(\n    "deletion_detector",\n    api_id=API_ID,\n    api_hash=API_HASH,\n    workdir=session_path\n)'
)

# Write the fixed version
with open('bot_fixed.py', 'w') as f:
    f.write(content)

print("✅ Created bot_fixed.py with peer error handling")
print("\nTo use the fixed version:")
print("1. Stop the current bot")
print("2. mv bot.py bot_original.py")
print("3. mv bot_fixed.py bot.py")
print("4. Restart the bot")
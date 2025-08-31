# Telegram Message Deletion Sync Issue - Analysis & Fix

## Problem Summary
When you delete your own message in Telegram, it doesn't sync to Discord. This happens because Telegram's API doesn't reliably send deletion events for self-deleted messages.

## Root Cause
1. **Telegram API Limitation**: The `on_deleted_messages` event in Pyrogram (and Telegram's API in general) doesn't reliably fire when you delete your own messages
2. **Event vs Polling**: The system relies primarily on deletion events, which work for others' deletions but not for self-deletions
3. **Timing Issue**: The periodic check wasn't aggressive enough for detecting self-deletions quickly

## Solution Implemented

### 1. Enhanced Message Tracking
Modified `deletion_detector/bot.py` to track whether a message is from the bot's own user:
- Added `is_own` flag to message cache
- Store user ID to identify own messages

### 2. More Aggressive Periodic Checking
- Reduced periodic check interval from 30 to 15 seconds
- Different timing for own messages vs others:
  - Own messages: Check after 5 seconds
  - Other messages: Check after 10 seconds

### 3. Manual Test Command
Added `/testdelete <message_id>` command for testing deletion detection manually

## How the System Works

### Message Flow
1. **Message Sent in Telegram** → Tracked by deletion detector
2. **Message Relayed** → Sent to Discord/Twitch via main relay bot
3. **Message Deleted in Telegram** → Two detection methods:
   - **Event-based** (instant but unreliable for self-deletions)
   - **Periodic check** (reliable but delayed 5-15 seconds)
4. **Deletion Webhook** → Deletion detector notifies main bot
5. **Cross-platform Deletion** → Main bot deletes on Discord/Twitch

### Components
- **deletion_detector/bot.py**: Python bot using Pyrogram to detect deletions
- **src/api/webhook.ts**: Webhook endpoint receiving deletion notifications
- **src/relay/manager.ts**: Handles cross-platform message deletion
- **src/services/discord.ts**: Discord deletion implementation
- **src/services/telegram.ts**: Telegram service (doesn't detect deletions itself)

## Testing the Fix

### 1. Check if deletion detector is running:
```bash
ps aux | grep bot.py
```

### 2. Monitor deletion detector logs:
```bash
tail -f deletion.log
```

### 3. Test deletion flow:
```bash
# Test specific message deletion
node test_telegram_deletion.js test <message_id>

# Monitor deletions in real-time
node test_telegram_deletion.js monitor
```

### 4. Manual test via Telegram:
1. Send a message to the bot in private
2. Use command: `/testdelete <message_id>`

## Expected Behavior After Fix

### For Your Own Messages:
- Detection within 5-15 seconds (via periodic check)
- Automatic deletion on Discord/Twitch

### For Others' Messages:
- Instant detection (if event fires)
- Fallback to 10-15 second periodic check

## Troubleshooting

### If deletions still don't sync:

1. **Check deletion detector is running**:
   ```bash
   ps aux | grep bot.py
   ```

2. **Check webhook is accessible**:
   ```bash
   curl -X POST http://localhost:5847/api/deletion-webhook \
     -H "Content-Type: application/json" \
     -d '{"telegram_msg_id": 123, "mapping_id": "test"}'
   ```

3. **Check Redis is running** (for event pub/sub):
   ```bash
   redis-cli ping
   ```

4. **Check database for message mappings**:
   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const db = new Database('relay_messages.db');
   const result = db.prepare('SELECT * FROM platform_messages ORDER BY rowid DESC LIMIT 5').all();
   console.log(result);
   "
   ```

5. **Check Discord bot permissions**:
   - Bot needs "Manage Messages" permission to delete messages
   - Check in Discord Server Settings → Roles → Bot Role

## Known Limitations

1. **Telegram API**: Self-deletions may not trigger events immediately
2. **Discord Permissions**: Bot can only delete messages in channels where it has permission
3. **Rate Limits**: Both platforms have rate limits for deletions
4. **Message Age**: Some platforms limit deletion of old messages

## Future Improvements

1. Add Redis caching for faster deletion detection
2. Implement WebSocket connection for real-time deletion sync
3. Add admin UI for managing deletions
4. Implement deletion queue with retry logic
5. Add metrics/monitoring for deletion success rate
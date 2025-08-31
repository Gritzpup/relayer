# Admin Deletion Feature

## Overview
As an admin in Telegram, you can now delete ANY relayed message (regardless of who sent it originally) and have that deletion sync across all platforms (Discord, Twitch).

## How It Works

### Admin Privileges
- Admins are defined by their Telegram user ID in the `TELEGRAM_ADMIN_IDS` environment variable
- Multiple admins can be configured using comma-separated IDs
- Default admin ID: `746386717`

### Deletion Flow
1. **See a message you want to delete** (e.g., someone posts something inappropriate in Discord)
2. **Message appears in Telegram** (relayed by the bot)
3. **Reply to the message with `/delete` command** in Telegram
4. **Message is deleted across all platforms** (Discord, Telegram, Twitch)

## Commands

### `/delete` - Delete a Message
- **For Regular Users**: Can only delete their own messages
- **For Admins**: Can delete ANY message
- Usage: Reply to any relayed message with `/delete`

### `/admin` - Check Admin Status
- Shows whether you have admin privileges
- Displays your Telegram user ID
- Usage: Type `/admin` in the group

## Configuration

### Setting Admin IDs
Add to your `.env` file:
```env
# Single admin
TELEGRAM_ADMIN_IDS=746386717

# Multiple admins (comma-separated)
TELEGRAM_ADMIN_IDS=746386717,987654321,123456789
```

### Finding Your Telegram User ID
1. Send `/admin` command to the bot in the group
2. The bot will show your user ID in the response

## Technical Details

### Admin vs Regular Deletion
- **Regular Deletion**: When a user deletes their own message, it only syncs to other platforms (not the source)
- **Admin Deletion**: When an admin deletes any message, it deletes on ALL platforms including the source

### Platform Requirements
- **Discord**: Bot needs "Manage Messages" permission
- **Telegram**: Bot needs administrator rights with delete message permission
- **Twitch**: Bot needs moderator status with `moderator:manage:chat_messages` scope

### Deletion Detection Methods
1. **Command-based** (`/delete`): Instant deletion via admin command
2. **Event-based**: Automatic detection when messages are deleted in Telegram
3. **Periodic Check**: Backup method that checks every 5-15 seconds

## Example Scenarios

### Scenario 1: Removing Inappropriate Content
1. User posts inappropriate content in Discord
2. Message gets relayed to Telegram
3. Admin sees it in Telegram
4. Admin replies with `/delete`
5. Message is removed from Discord, Telegram, and Twitch

### Scenario 2: Cleaning Up Spam
1. Spam appears in any platform
2. Gets relayed to all platforms
3. Admin can delete from Telegram
4. All copies are removed across platforms

## Limitations

1. **Message Age**: Some platforms limit deletion of old messages
2. **Rate Limits**: Each platform has rate limits for deletions
3. **Permissions**: Bot must have appropriate permissions on each platform
4. **Deleted by Platform**: If a platform (like Discord) deletes a message for ToS violations, it may not sync

## Troubleshooting

### Message Won't Delete
1. Check bot permissions on the target platform
2. Verify you're an admin with `/admin` command
3. Ensure you're replying to a relayed message (not a direct message)

### Admin Status Not Working
1. Check your user ID with `/admin`
2. Verify ID is in `TELEGRAM_ADMIN_IDS` environment variable
3. Restart the relay service after adding new admin IDs

### Deletion Not Syncing
1. Check if deletion detector is running
2. Verify webhook is accessible
3. Check Redis is running for event distribution
4. Review logs for error messages

## Security Considerations

- Only trusted users should be given admin privileges
- Admin actions are logged for accountability
- Consider implementing an audit log for admin deletions
- Regularly review admin list and remove inactive admins
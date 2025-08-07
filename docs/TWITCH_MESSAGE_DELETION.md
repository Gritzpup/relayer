# Twitch Message Deletion Issue

## The Problem

As of February 18, 2023, Twitch removed support for IRC-based chat commands (except `/me`). This means that TMI.js's `deletemessage` function no longer works, even if your bot has moderator permissions.

## The Solution

We've updated the bot to use the Twitch Helix API for message deletion instead. This requires:

1. **Bot must be a moderator** in the channel (which you already have)
2. **OAuth token must include the `moderator:manage:chat_messages` scope**

## How to Fix

### Step 1: Generate a New OAuth Token

Run the helper script:
```bash
node scripts/get-twitch-oauth.js
```

This will give you a URL to authorize your bot with all required scopes, including `moderator:manage:chat_messages`.

### Step 2: Update Your .env File

Replace your `TWITCH_OAUTH` with the new token:
```
TWITCH_OAUTH=oauth:YOUR_NEW_TOKEN_HERE
```

### Step 3: Restart the Bot

The bot will now use the Twitch API to delete messages when edits come through.

## Technical Details

- **Old Method**: TMI.js `client.deletemessage()` - Deprecated since Feb 2023
- **New Method**: Twitch Helix API `DELETE /helix/moderation/chat`
- **Required Scope**: `moderator:manage:chat_messages`
- **Limitations**: 
  - Can only delete messages from the last 6 hours
  - Cannot delete messages from the broadcaster or other moderators

## What Changed in the Code

1. Added `deleteChatMessage` method to `TwitchAPI` class
2. Updated `deleteMessage` in `TwitchService` to use the API instead of TMI.js
3. Added scope checking to warn if the required scope is missing

## References

- [Twitch IRC Migration Guide](https://dev.twitch.tv/docs/chat/irc-migration/)
- [Twitch API Reference - Delete Chat Messages](https://dev.twitch.tv/docs/api/reference/#delete-chat-messages)
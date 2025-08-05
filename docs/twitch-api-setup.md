# Twitch Chat API Setup

This guide explains how to set up and use the Twitch Chat Message API for sending messages instead of the traditional IRC-based TMI.js method.

## Benefits of Using the Chat API

1. **Message IDs**: The API returns message IDs, allowing for better message tracking
2. **Better Rate Limiting**: Clear rate limit information in API responses
3. **More Reliable**: Official API with better error handling
4. **Future Proof**: Twitch is moving away from IRC-based chat

## Prerequisites

1. A Twitch bot account (e.g., "twitchrelayer")
2. A Twitch application with Client ID
3. OAuth token with proper scopes

## Required Scopes

When generating your OAuth token, ensure these scopes are enabled:
- `chat:read` - Read messages from chat
- `chat:edit` - Send messages to chat  
- `user:write:chat` - Use the Chat Message API
- `user:bot` - Mark account as a bot
- `channel:bot` - Bot channel access

Optional but recommended:
- `channel:moderate` - Moderation capabilities
- `moderator:manage:chat_messages` - Delete messages

## Setup Steps

### 1. Create a Twitch Application

1. Go to https://dev.twitch.tv/console/apps
2. Click "Register Your Application"
3. Fill in:
   - Name: Your bot name (e.g., "Relay Bot")
   - OAuth Redirect URLs: `http://localhost`
   - Category: Chat Bot
4. Click "Create"
5. Copy your Client ID

### 2. Generate OAuth Token

1. Go to https://twitchtokengenerator.com/
2. Enter your Client ID
3. Select the required scopes listed above
4. Generate the token
5. Save both the Access Token and Refresh Token

### 3. Configure Environment Variables

Update your `.env` file:

```env
# Twitch Configuration
TWITCH_USERNAME=twitchrelayer
TWITCH_OAUTH=oauth:your_access_token_here
TWITCH_CHANNEL=your_channel_name
TWITCH_CLIENT_ID=your_client_id_here
TWITCH_USE_API_FOR_CHAT=true
```

Note: The `TWITCH_OAUTH` should include the `oauth:` prefix.

### 4. Grant Bot Permissions

Ensure your bot account can send messages in your channel:
- Either make it a moderator: `/mod twitchrelayer`
- Or ensure your channel allows all users to chat

## How It Works

When `TWITCH_USE_API_FOR_CHAT` is enabled and a Client ID is provided:

1. On connection, the bot validates the OAuth token
2. Checks if required scopes are available
3. Gets the broadcaster ID for the channel
4. Attempts to send messages via the API
5. Falls back to TMI.js if the API fails

## API vs TMI.js Comparison

| Feature | Chat API | TMI.js |
|---------|----------|---------|
| Message IDs | ✅ Returns ID | ❌ No ID |
| Rate Limits | ✅ Clear headers | ⚠️ Implicit |
| Authentication | OAuth + Client ID | OAuth only |
| Reliability | ✅ HTTP API | ⚠️ WebSocket |
| Setup Complexity | Medium | Simple |

## Troubleshooting

### "Missing required scopes"
- Regenerate your OAuth token with all required scopes
- Ensure `user:write:chat` and `user:bot` are selected

### "Failed to get broadcaster ID"
- Check that the channel name in config matches exactly
- Ensure the bot has access to the channel

### "403 Forbidden" errors
- The bot may need moderator status in the channel
- Check if the channel has follower-only or subscriber-only mode

### Fallback to TMI.js
The bot automatically falls back to TMI.js if:
- No Client ID is provided
- Required scopes are missing
- API initialization fails
- Any API error occurs when sending

## Monitoring

Watch the logs for API status:
```
Twitch API client initialized
Twitch Chat API enabled - messages will be sent via API
Sent message via Twitch API with ID: abc123...
```

## Rate Limits

The Chat API has the following limits:
- 20 messages per 30 seconds per user
- 100 messages per 30 seconds for moderators/VIPs
- Rate limit information is included in API response headers
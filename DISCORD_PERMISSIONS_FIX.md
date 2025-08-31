# Discord Bot Permission Issue - IMPORTANT

## The Problem
The Discord bot cannot delete messages because it lacks the **"Manage Messages"** permission in your Discord server. This is shown by the error:
```
DiscordAPIError[50013]: Missing Permissions
```

## The Solution
You need to grant the bot "Manage Messages" permission in your Discord server.

### Option 1: Update Bot Permissions (Recommended)
1. Go to your Discord server settings
2. Navigate to **Integrations** or **Members** 
3. Find your bot (twitchrelayer)
4. Click on the bot and go to **Permissions**
5. Enable the **"Manage Messages"** permission
6. Save changes

### Option 2: Re-invite Bot with Correct Permissions
1. Generate a new invite link with these permissions:
   - Send Messages
   - Read Messages/View Channels
   - **Manage Messages** (REQUIRED for deletion)
   - Embed Links
   - Attach Files
   - Read Message History
   
2. Use this invite link generator:
   https://discord.com/developers/applications/YOUR_APP_ID/oauth2/url-generator
   
3. Select "bot" scope and the permissions above
4. Re-invite the bot using the generated link

## Current Status
- ✅ Telegram deletion detection is working
- ✅ Webhook system is working
- ✅ Message mapping is working
- ✅ Twitch deletion is working
- ❌ Discord deletion fails due to missing permissions

## Testing After Fix
Once you've granted the "Manage Messages" permission:
1. Send a test message from Discord
2. Wait for it to relay to Telegram
3. Delete the relayed message in Telegram
4. The original Discord message should now be deleted automatically

## Note
The code is working correctly. The only issue is the Discord bot needs the "Manage Messages" permission to delete messages in your server.
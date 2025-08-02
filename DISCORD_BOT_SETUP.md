# Discord Bot Setup & Permissions Guide

## Creating Your Relayer Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Name it "Relayer" (or your preferred name)
4. Go to the "Bot" section
5. Click "Add Bot"
6. Copy the bot token for your .env file

## Required Bot Permissions

For full media relay functionality, your bot needs these permissions:

### Text Permissions
- **Read Messages/View Channels** - To see messages
- **Send Messages** - To relay messages
- **Send Messages in Threads** - If using threads
- **Read Message History** - To process existing messages
- **Mention Everyone** - For @mentions (optional)
- **Use External Emojis** - To send emojis from other servers
- **Use External Stickers** - To send stickers from other servers

### Media Permissions  
- **Embed Links** - For URL previews
- **Attach Files** - To send images/videos/files
- **Add Reactions** - To react with emojis

### Voice Permissions (if needed later)
- **Connect** - For voice channel access
- **Speak** - For voice functionality

### Permission Integer
The combined permissions integer is: **51539607552**

## Bot Invite Link

Use this format to invite your bot:
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_CLIENT_ID&permissions=51539607552&scope=bot
```

## Cross-Platform Media Support

### What Works:
- **Discord → Telegram**: Images, videos, files, GIFs
- **Discord → Twitch**: Text only (URLs for media)
- **Telegram → Discord**: Images, videos, files, stickers (as images)
- **Telegram → Twitch**: Text only (URLs for media)
- **Twitch → Discord**: Text and emote names
- **Twitch → Telegram**: Text and emote names

### Enhanced Features Possible:
1. **Sticker Conversion**: Telegram stickers → Discord images
2. **Emoji Mapping**: Custom emoji names across platforms
3. **GIF Support**: Direct GIF relay between Discord/Telegram
4. **File Sharing**: Documents and media files

### Twitch Limitations:
- Can only send text messages
- Media appears as URLs
- Emotes shown as text (e.g., :emote_name:)

## Next Steps

1. Create GitHub repository:
   ```bash
   # Go to GitHub and create new repo named "relayer"
   # Then run:
   git remote add origin https://github.com/YOUR_USERNAME/relayer.git
   git push -u origin main
   ```

2. Update Discord bot token in .env:
   ```
   DISCORD_TOKEN=YOUR_NEW_BOT_TOKEN
   ```

3. Restart the relay service
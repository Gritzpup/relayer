# Using Custom Platform Logo Emojis

This guide explains how to use actual platform logos instead of generic emojis when relaying messages.

## Overview

By default, the relayer uses generic emojis to represent different platforms:
- Discord: 🎮 (gaming controller)
- Telegram: ✈️ (paper plane)
- Twitch: 📺 (TV)

However, you can configure custom Discord emojis to show actual platform logos.

## Discord Custom Emojis

Discord supports custom emojis that can display actual logos. To use them:

### 1. Upload Platform Logos to Your Discord Server

First, you need to upload the platform logos as custom emojis to your Discord server:

1. Go to Server Settings → Emoji
2. Click "Upload Emoji"
3. Upload logos for Discord, Telegram, and Twitch
4. Name them appropriately (e.g., `discord_logo`, `telegram_logo`, `twitch_logo`)

### 2. Get the Emoji IDs

To get the ID of a custom emoji:

1. Type `\:emoji_name:` in Discord (e.g., `\:discord_logo:`)
2. Send the message
3. You'll see something like: `<:discord_logo:1234567890123456789>`
4. Copy this entire string

### 3. Configure Environment Variables

Add the emoji strings to your `.env` file:

```env
# Custom Emoji Configuration
CUSTOM_EMOJI_DISCORD=<:discord_logo:1234567890123456789>
CUSTOM_EMOJI_TELEGRAM=<:telegram_logo:9876543210987654321>
CUSTOM_EMOJI_TWITCH=<:twitch_logo:1357924680135792468>
```

For animated emojis, use the format `<a:name:id>` instead.

### 4. Restart the Bot

After configuring the environment variables, restart the bot to apply the changes.

## How It Works

- **Discord**: When messages are sent to Discord, the bot will use the custom emoji if configured. The emoji will appear as the actual platform logo.
- **Telegram**: Telegram doesn't support Discord's custom emojis, so it will continue to use the fallback emojis (✈️, 🎮, 📺).
- **Twitch**: Twitch continues to use text prefixes `[Platform]` as it has limited emoji support.

## Fallback Behavior

If custom emojis are not configured or if there's an error, the bot will automatically fall back to the default generic emojis.

## Example

With custom emojis configured, a message from Telegram to Discord would appear as:

```
<telegram_logo> BarmtheBear: Hello from Telegram!
```

Instead of:

```
✈️ BarmtheBear: Hello from Telegram!
```

## Tips

- Use high-quality, square logos for best results
- Keep logos simple and recognizable at small sizes
- Consider using official platform logos or well-known community versions
- Test the emojis in Discord to ensure they display correctly
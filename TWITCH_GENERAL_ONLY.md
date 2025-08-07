# Twitch General Channel Only

## Overview
The relay bot is configured to only send messages from the "general" channel to Twitch. This prevents topic-specific conversations from flooding the Twitch chat.

## How It Works

### Messages TO Twitch:
- ✅ Discord #general → Twitch chat
- ✅ Telegram general topic → Twitch chat
- ❌ Discord #vent → NOT sent to Twitch
- ❌ Discord #test → NOT sent to Twitch
- ❌ Discord #dev → NOT sent to Twitch
- ❌ Discord #music → NOT sent to Twitch
- ❌ Discord #art → NOT sent to Twitch
- ❌ Discord #pets → NOT sent to Twitch
- ❌ Telegram topic messages → NOT sent to Twitch

### Messages FROM Twitch:
- All Twitch messages go to Discord #general and Telegram general topic

## Why This Design?
- Keeps Twitch chat focused on general conversation
- Prevents topic-specific discussions from overwhelming Twitch viewers
- Maintains privacy for topic-specific channels
- Twitch viewers can still participate in general chat

## Configuration
This is hardcoded in `src/relay/manager.ts`. To change this behavior, modify the `relayToPlatform` method.

## Channel Mappings
- Discord ↔ Telegram mappings for all topics work normally
- Only the Twitch relay is restricted to general channel
# Twitch Reply Detection

This document explains how the relayer detects and handles replies in Twitch chat.

## Overview

Since Twitch doesn't have a native reply system like Discord or Telegram, users typically reply by starting their message with `@username`. The relayer detects this pattern and converts it to proper replies on other platforms.

## How It Works

### 1. Message Storage

The Twitch service maintains a cache of recent messages:
- Stores the last message from each user
- Keeps messages for up to 10 minutes
- Automatically cleans up old messages

### 2. Reply Detection

When a Twitch message starts with `@username`:
1. Extract the mentioned username
2. Look up the most recent message from that user
3. If found (and within 5 minutes), treat it as a reply

### 3. Message Format

Original Twitch message:
```
@gritzpup thanks for the info
```

Becomes:
- **Discord**: Shows as a proper reply to gritzpup's last message
- **Telegram**: Shows as a proper reply with reply_to_message_id
- **Message content**: "thanks for the info" (without the @mention)

### 4. Cross-Platform Replies

The system also tracks messages relayed FROM other platforms:
- When Discord/Telegram messages are relayed to Twitch
- Extracts the original author from `[Platform] username: message`
- Allows Twitch users to reply to messages from other platforms

## Examples

### Example 1: Simple Reply
1. Twitch user `gritzpup` says: "anyone know a good tutorial?"
2. Twitch user `viewer123` says: "@gritzpup check out the docs"
3. Result: "check out the docs" is sent as a reply to gritzpup's message

### Example 2: Cross-Platform Reply
1. Discord user `player1` says: "I need help with the boss"
2. Twitch sees: "[Discord] player1: I need help with the boss"
3. Twitch user says: "@player1 use fire attacks"
4. Result: Reply is properly linked back to the Discord message

## Limitations

1. **Time Window**: Only messages within the last 5 minutes are considered for replies
2. **One Message Per User**: Only tracks the most recent message from each user
3. **Case Insensitive**: Usernames are matched case-insensitively
4. **No Threading**: Twitch doesn't support message threads, so complex conversations may lose context

## Configuration

The reply detection is automatic and doesn't require configuration. The time windows are:
- Message storage: 10 minutes
- Reply matching: 5 minutes

These values are optimized for typical chat speeds and can be adjusted if needed.
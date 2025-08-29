# Chat Relay Service

A powerful cross-platform message relay service that synchronizes conversations between Discord, Telegram, and Twitch in real-time.

## Features

- **Multi-Platform Support**: Seamlessly relay messages between Discord, Telegram, and Twitch
- **Channel Mapping**: Map specific Discord channels to Telegram topics/threads
- **Message Replies**: Preserves reply context across platforms
- **Message Editing**: Syncs edited messages across all platforms
- **Message Deletion**: Supports message deletion synchronization
- **Admin Deletion**: Admins can delete any message across all platforms
- **Attachment Support**: Relay images, videos, and files between platforms
- **Custom Emojis**: Handles platform-specific emojis and stickers
- **Rate Limiting**: Built-in rate limiting to prevent spam
- **Auto-Reconnection**: Automatic reconnection on network issues
- **Redis Integration**: Distributed message tracking and synchronization
- **Deletion Detection**: Advanced Telegram deletion detection using user API
- **Webhook API**: HTTP API for external integrations

## Prerequisites

- Node.js 18+ 
- Python 3.8+ (for deletion detector)
- Redis server
- Bot tokens for each platform

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/relayer.git
cd relayer
```

2. Install Node.js dependencies:
```bash
npm install
```

3. Install Python dependencies for deletion detector:
```bash
cd deletion_detector
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
cd ..
```

4. Set up environment variables in `.env`:
```env
# Discord Configuration
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=your_discord_channel_id

# Telegram Configuration  
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_GROUP_ID=your_telegram_group_id

# Twitch Configuration
TWITCH_USERNAME=your_twitch_username
TWITCH_OAUTH=oauth:your_twitch_oauth_token
TWITCH_CHANNEL=target_twitch_channel
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret

# Deletion Detector (Telegram User API)
TELEGRAM_API_ID=your_telegram_api_id
TELEGRAM_API_HASH=your_telegram_api_hash

# Webhook Configuration
WEBHOOK_PORT=5847
```

5. Configure channel mappings in `src/config/index.ts`:
```typescript
export const channelMappings: ChannelMappings = {
  'general': {
    discord: 'discord_channel_id',
    telegram: null // null for general chat
  },
  'dev': {
    discord: 'discord_dev_channel_id',
    telegram: 'telegram_topic_id'
  }
};
```

## Usage

### Production Mode (Recommended)
Single instance with lock file protection:
```bash
npm start
```

### Development Mode
With auto-restart on file changes:
```bash
npm run dev
```

### Other Commands
```bash
npm run stop       # Stop all relay processes
npm run status     # Check service status
npm run build      # Build TypeScript
npm run lint       # Run ESLint
npm run typecheck  # Check TypeScript types
```

## Admin Features

### Admin Message Deletion
Admins can delete any message across all platforms. Configure admin user IDs in the service files:

**Discord** (`src/services/discord.ts`):
```typescript
this.adminUserIds.add('your_discord_user_id');
```

**Telegram** (`src/services/telegram.ts`):
```typescript
private adminUserIds: Set<number> = new Set([your_telegram_user_id]);
```

When an admin deletes a message on Discord or Telegram, it will be automatically deleted from all other platforms including Twitch (requires moderator permissions on Twitch).

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Discord   │────▶│    Relay    │────▶│   Telegram  │
│   Service   │◀────│   Manager   │◀────│   Service   │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │    Twitch   │
                    │   Service   │
                    └─────────────┘
                           │
                    ┌─────────────┐
                    │    Redis    │
                    │   (State)   │
                    └─────────────┘
```

## Platform Requirements

### Discord
- Bot with Message Content Intent enabled
- Administrator permissions in the server
- Access to audit logs (for admin deletion detection)

### Telegram
- Bot created via @BotFather
- Admin rights in the group/supergroup
- For deletion detection: User account authentication

### Twitch
- OAuth token with chat scopes
- Moderator status for deletion capabilities
- Twitch API client ID and secret

## Deployment

### PM2
```bash
pm2 start ecosystem.config.js
```

### Docker
```bash
docker-compose up -d
```

### Manual
```bash
npm run build
npm start
```

## Troubleshooting

### Multiple Instances
If you see multiple instances running:
```bash
npm run stop
rm .relay.lock
npm start
```

### Telegram Connection Issues
- Check for bot conflicts (409 errors)
- Verify bot token and group ID
- Ensure bot has admin permissions

### Missing Environment Variables
The service validates all required environment variables on startup. Check the error message for missing variables.

### Database Locked Error
```bash
rm deletion_detector/sessions/*.session-journal
```

## API Endpoints

- `GET /api/status` - Get service status
- `POST /api/deletion-webhook` - Webhook for deletion events

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
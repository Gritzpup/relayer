# Chat Relay Service

Cross-platform message relay service that synchronizes messages between Telegram, Discord, and Twitch chats.

## Features

- Real-time message synchronization across platforms
- Attachment/media handling (images, videos, files)
- Rate limiting to prevent spam
- Automatic reconnection on disconnects
- Message deduplication
- Configurable message prefixes
- Comprehensive logging

## Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your credentials
3. Install dependencies: `npm install`
4. Build the project: `npm run build`
5. Start the service: `npm start`

## Development

- Run in development mode: `npm run dev`
- Check types: `npm run typecheck`
- Lint code: `npm run lint`

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

## Configuration

See `.env.example` for all available configuration options.

## Requirements

- Node.js 18+
- Discord bot token and channel ID
- Telegram bot token and group ID
- Twitch username and OAuth token
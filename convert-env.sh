#!/bin/bash

# Create a backup of the original .env
cp .env .env.backup

# Extract values from the existing .env
DISCORD_TOKEN=$(grep "^VITE_DISCORD_TOKEN=" .env | cut -d= -f2-)
DISCORD_CHANNELS=$(grep "^VITE_DISCORD_CHANNELS=" .env | cut -d= -f2-)
TELEGRAM_TOKEN=$(grep "^VITE_TELEGRAM_TOKEN=" .env | cut -d= -f2-)
TELEGRAM_GROUPS=$(grep "^VITE_TELEGRAM_GROUPS=" .env | cut -d= -f2-)
TWITCH_USERNAME=$(grep "^VITE_TWITCH_USERNAME=" .env | cut -d= -f2-)
TWITCH_OAUTH=$(grep "^VITE_TWITCH_OAUTH=" .env | cut -d= -f2-)
TWITCH_CHANNELS=$(grep "^VITE_TWITCH_CHANNELS=" .env | cut -d= -f2-)

# Extract first channel/group ID (assuming comma-separated)
DISCORD_CHANNEL_ID=$(echo $DISCORD_CHANNELS | cut -d, -f1)
TELEGRAM_GROUP_ID=$(echo $TELEGRAM_GROUPS | cut -d, -f1)
TWITCH_CHANNEL=$(echo $TWITCH_CHANNELS | cut -d, -f1)

# Create new .env file with correct format
cat > .env << EOF
# Discord Configuration
DISCORD_TOKEN=$DISCORD_TOKEN
DISCORD_CHANNEL_ID=$DISCORD_CHANNEL_ID

# Telegram Configuration
TELEGRAM_BOT_TOKEN=$TELEGRAM_TOKEN
TELEGRAM_GROUP_ID=$TELEGRAM_GROUP_ID

# Twitch Configuration
TWITCH_USERNAME=$TWITCH_USERNAME
TWITCH_OAUTH=$TWITCH_OAUTH
TWITCH_CHANNEL=$TWITCH_CHANNEL

# Relay Configuration
RELAY_PREFIX_ENABLED=true
RELAY_ATTACHMENTS=true
RELAY_RATE_LIMIT=30
RELAY_HISTORY_SIZE=100

# Logging Configuration
LOG_LEVEL=info
LOG_MAX_FILES=14d
LOG_MAX_SIZE=20m
EOF

echo "Environment file converted successfully!"
echo "Original backed up to .env.backup"
# Telegram Deletion Detector Setup Guide

This guide will help you set up automatic message deletion detection for Telegram.

## Prerequisites

- Python 3.8 or higher
- pip (Python package manager)
- Node.js 18+ (already required for main bot)

## Step 1: Install Dependencies

### Node.js Dependencies
```bash
npm install
```

### Python Dependencies
```bash
cd deletion_detector
pip install -r requirements.txt
```

## Step 2: Create Telegram Application

1. Go to https://my.telegram.org/apps
2. Log in with your phone number
3. Click "Create new application"
4. Fill in the form:
   - **App title**: `RelayBot Deletion Detector`
   - **Short name**: `relay_delete_detect`
   - **URL**: (leave empty)
   - **Platform**: Desktop
   - **Description**: `Deletion detection bot for relay system`
5. Click "Create application"
6. You'll receive:
   - **App api_id**: (e.g., 12345678)
   - **App api_hash**: (e.g., 0123456789abcdef0123456789abcdef)

## Step 3: Configure Environment

Add these to your `.env` file:
```env
# Existing variables...

# Deletion detector
TELEGRAM_API_ID=your_api_id_here
TELEGRAM_API_HASH=your_api_hash_here
WEBHOOK_PORT=3000  # Optional, defaults to 3000
```

## Step 4: Initialize Database

```bash
npm run init-db
```

This creates `relay_messages.db` with the necessary tables.

## Step 5: First Run - Authentication

The first time you run the deletion detector, it will ask for your phone number:

```bash
cd deletion_detector
python bot.py
```

You'll see:
```
Enter phone (or bot token): +1234567890
Enter code: 12345
```

This creates a session file that will be reused for future runs.

## Step 6: Running Both Bots

### Option 1: Two Terminal Windows

Terminal 1 - Main Relay Bot:
```bash
npm start
```

Terminal 2 - Deletion Detector:
```bash
cd deletion_detector
python bot.py
```

### Option 2: Using PM2 (Process Manager)

Install PM2:
```bash
npm install -g pm2
```

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [
    {
      name: 'relay-bot',
      script: 'npm',
      args: 'start',
      cwd: './',
    },
    {
      name: 'deletion-detector',
      script: 'python',
      args: 'bot.py',
      cwd: './deletion_detector',
      interpreter: 'python3'
    }
  ]
};
```

Start both:
```bash
pm2 start ecosystem.config.js
pm2 logs  # View logs
pm2 stop all  # Stop both bots
```

## How It Works

1. **Message Tracking**: Every Telegram message is tracked in the SQLite database
2. **Deletion Detection**: 
   - Pyrogram's `on_deleted_messages` event (immediate but not 100% reliable)
   - Periodic checks every 30 seconds (backup method)
3. **Cross-Platform Deletion**: When deletion is detected, webhook notifies main bot
4. **Automatic Cleanup**: Messages are deleted from Discord and Twitch automatically

## Manual Deletion (Backup Method)

Users can still use the `/delete` command:
1. Reply to any relayed message
2. Type `/delete`
3. Bot deletes from all platforms

## Troubleshooting

### "TELEGRAM_API_ID and TELEGRAM_API_HASH must be set"
- Make sure you added them to `.env` file
- Check for typos in variable names

### "No module named 'pyrogram'"
- Run `pip install -r requirements.txt` in deletion_detector folder

### Database errors
- Make sure you ran `npm run init-db`
- Check file permissions on `relay_messages.db`

### Bot not detecting deletions
- Make sure the deletion detector bot is running
- Check that the webhook server is accessible on port 3000
- Verify the bot has admin rights in the Telegram group

## Security Notes

- The session file contains authentication data - keep it secure
- Don't share your api_id and api_hash
- The database contains message history - handle with care

## Monitoring

Check logs for:
- "Tracked message X from Y" - Messages being recorded
- "Message X was deleted" - Deletions detected
- "Deleted message X from Discord/Twitch" - Successful cross-platform deletion
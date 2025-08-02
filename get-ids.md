# How to Get Required IDs

## Discord Channel ID
1. Open Discord and go to your server
2. Go to Settings → Advanced → Enable "Developer Mode"
3. Right-click on the channel you want to relay messages from
4. Click "Copy Channel ID"
5. Add to .env: `DISCORD_CHANNEL_ID=<paste-id-here>`

## Telegram Group ID
1. Add your bot to the Telegram group
2. Send a test message in the group
3. Run this command to get the group ID:
   ```bash
   curl -s "https://api.telegram.org/bot8224946532:AAEm1sKOIBwgSJ130B0hEhM3d1FyWbj51UM/getUpdates" | jq '.result[].message.chat.id' | uniq
   ```
4. Add to .env: `TELEGRAM_GROUP_ID=<the-negative-number>`

Note: Telegram group IDs are usually negative numbers like -1001234567890
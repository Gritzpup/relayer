# Running Both Services with Separate Bots

## Steps:
1. Create a new bot with @BotFather on Telegram
2. Add the new bot to your Telegram group
3. Update the relay .env file with the new bot token
4. Both services can now run simultaneously

## Alternative: Share the Same Bot
If you want to use the same bot for both services, you'd need to:
- Disable Telegram in one of the services
- OR implement a webhook server that both services connect to
- OR use a message queue (Redis/RabbitMQ) to share messages between services
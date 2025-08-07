const { Telegram } = require('telegraf');
require('dotenv').config();

async function getTopicIds() {
    const telegram = new Telegram(process.env.TELEGRAM_BOT_TOKEN);
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    console.log(`\nFetching topics for chat: ${chatId}\n`);
    
    try {
        // Get forum topics
        const topics = await telegram.getForumTopicIconStickers();
        console.log('Available forum topic stickers:', topics);
        
        // Try to get chat info
        const chat = await telegram.getChat(chatId);
        console.log('\nChat info:', {
            id: chat.id,
            title: chat.title,
            type: chat.type,
            is_forum: chat.is_forum
        });
        
        // Note: Telegram Bot API doesn't have a direct method to list all topics
        // You'll need to manually check topic IDs by observing messages
        console.log('\nTo get topic IDs:');
        console.log('1. Send a message in each topic');
        console.log('2. Check the message_thread_id in the bot logs');
        console.log('3. The message_thread_id is the topic ID');
        console.log('\nAlternatively, forward a message from each topic to @RawDataBot to see the thread_id');
        
    } catch (error) {
        console.error('Error:', error.message);
        console.log('\nMake sure:');
        console.log('1. Bot is added to the group');
        console.log('2. Group has topics enabled');
        console.log('3. Bot has necessary permissions');
    }
}

getTopicIds();
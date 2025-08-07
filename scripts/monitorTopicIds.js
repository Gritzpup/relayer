const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const topicMap = new Map();
const groupId = process.env.TELEGRAM_GROUP_ID;

console.log('Bot is monitoring for topic IDs...');
console.log(`Monitoring group: ${groupId}`);
console.log('Send a message in each topic to see its ID');
console.log('Press Ctrl+C to stop\n');

bot.on('message', (msg) => {
    const chatId = msg.chat.id.toString();
    
    // Only monitor messages from our configured group
    if (chatId !== groupId) {
        return;
    }
    
    const threadId = msg.message_thread_id || 'General (no thread ID)';
    const chatTitle = msg.chat.title;
    const from = msg.from?.username || msg.from?.first_name || 'Unknown';
    const text = msg.text || msg.caption || '[Media/Other]';
    
    // For supergroups with topics
    if (msg.chat.type === 'supergroup' && msg.chat.is_forum) {
        console.log('\n=== New Message ===');
        console.log(`Chat: ${chatTitle} (${chatId})`);
        console.log(`Topic ID: ${threadId}`);
        console.log(`From: ${from}`);
        console.log(`Message: ${text}`);
        
        // Try to detect topic name from forum_topic_created events
        if (msg.forum_topic_created) {
            const topicName = msg.forum_topic_created.name;
            console.log(`Topic Created: ${topicName}`);
            topicMap.set(threadId, topicName);
        }
        
        // Also check reply_to_message for topic info
        if (msg.reply_to_message && msg.reply_to_message.forum_topic_created) {
            const topicName = msg.reply_to_message.forum_topic_created.name;
            console.log(`Topic Name (from reply): ${topicName}`);
            topicMap.set(threadId, topicName);
        }
        
        console.log('\n--- Known Topics ---');
        topicMap.forEach((name, id) => {
            console.log(`${name}: ${id}`);
        });
        console.log('-------------------\n');
    } else {
        console.log('\n=== Message from Non-Forum Chat ===');
        console.log(`Chat: ${chatTitle} (${chatId})`);
        console.log(`Type: ${msg.chat.type}`);
        console.log(`Is Forum: ${msg.chat.is_forum || false}`);
        console.log(`From: ${from}`);
        console.log(`Message: ${text}`);
        console.log('\nNote: This group may not have topics enabled.');
        console.log('To use topics, the group must be a supergroup with topics/forums enabled.\n');
    }
});

// Handle errors
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Enable graceful stop
process.once('SIGINT', () => {
    console.log('\nStopping bot...');
    bot.stopPolling();
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log('\nStopping bot...');
    bot.stopPolling();
    process.exit(0);
});
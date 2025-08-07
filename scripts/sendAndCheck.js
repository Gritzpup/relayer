const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const groupId = process.env.TELEGRAM_GROUP_ID;

console.log('📱 Telegram Topic ID Helper\n');
console.log('Instructions:');
console.log('1. Go to your Telegram group');
console.log('2. Send a message in each topic (vent, test, dev, music, art, pets)');
console.log('3. This script will show the topic ID for each message\n');
console.log('Waiting for messages...\n');

const seenTopics = new Map();

bot.on('message', (msg) => {
    if (msg.chat.id.toString() !== groupId) return;
    
    const topicId = msg.message_thread_id || 'General (no ID)';
    const from = msg.from?.username || msg.from?.first_name || 'Unknown';
    const text = msg.text || '[Media]';
    
    console.log('📨 New Message Detected:');
    console.log(`   Topic ID: ${topicId}`);
    console.log(`   From: ${from}`);
    console.log(`   Message: ${text}`);
    console.log('');
    
    if (topicId !== 'General (no ID)' && !seenTopics.has(topicId)) {
        seenTopics.set(topicId, text);
        
        console.log('✅ Topic IDs found so far:');
        seenTopics.forEach((sample, id) => {
            console.log(`   ${id} - Sample: "${sample.substring(0, 30)}..."`);
        });
        console.log('');
    }
    
    // If user mentions the topic name, track it
    const topicNames = ['vent', 'test', 'dev', 'music', 'art', 'pets'];
    topicNames.forEach(name => {
        if (text.toLowerCase().includes(name) && topicId !== 'General (no ID)') {
            console.log(`🎯 Topic "${name}" appears to be ID: ${topicId}\n`);
        }
    });
});

console.log('📝 Tip: Send a message in each topic with the topic name');
console.log('   Example: In the "test" topic, send "This is test topic"\n');

// Handle errors
bot.on('polling_error', (error) => {
    console.error('Error:', error.message);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n📋 Final Topic IDs:');
    if (seenTopics.size > 0) {
        seenTopics.forEach((sample, id) => {
            console.log(`   Topic ${id}`);
        });
        
        console.log('\n🔧 Update your config:');
        console.log('export const channelMappings: ChannelMappings = {');
        console.log('  // Add the topic IDs you found above');
        console.log('  // Match them with the correct channel names');
        console.log('};\n');
    } else {
        console.log('   No topic IDs captured.\n');
    }
    
    bot.stopPolling();
    process.exit(0);
});
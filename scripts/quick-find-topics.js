#!/usr/bin/env node

const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const groupId = process.env.TELEGRAM_GROUP_ID;

if (!token || !groupId) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_GROUP_ID');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log('Monitoring messages for 30 seconds to detect topic IDs...');
console.log('Please send a message in the tech channel in Telegram!');
console.log('---');

const seenTopics = new Map();
let messageCount = 0;

bot.on('message', (msg) => {
  if (msg.chat.id.toString() === groupId) {
    messageCount++;
    const topicId = msg.message_thread_id || 'general';
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';
    const text = msg.text?.substring(0, 50) || '[Media]';
    
    if (!seenTopics.has(topicId)) {
      console.log(`\n🆕 NEW TOPIC FOUND!`);
      console.log(`  Topic ID: ${topicId}`);
      console.log(`  First message by: ${username}`);
      console.log(`  Message: ${text}`);
      seenTopics.set(topicId, { username, text, count: 1 });
    } else {
      seenTopics.get(topicId).count++;
    }
    
    console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] Topic ${topicId}: ${username}: ${text}`);
  }
});

// Stop after 30 seconds
setTimeout(() => {
  console.log('\n---');
  console.log('Summary of detected topics:');
  for (const [topicId, info] of seenTopics) {
    console.log(`  Topic ${topicId}: ${info.count} messages`);
  }
  
  console.log('\nTo add the tech channel, look for its topic ID above and add to config.');
  process.exit(0);
}, 30000);

bot.on('error', (error) => {
  console.error('Bot error:', error);
});
#!/usr/bin/env node

const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TELEGRAM_GROUP_ID;

if (!BOT_TOKEN || !GROUP_ID) {
  console.error('Please set TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID in .env file');
  process.exit(1);
}

console.log('🎮 Gaming Room Topic Finder');
console.log('==========================\n');
console.log('Instructions:');
console.log('1. Send a message in the Gaming Room topic in Telegram');
console.log('2. The topic ID will be displayed below');
console.log('3. Press Ctrl+C to stop when you have the ID\n');
console.log('Listening for messages...\n');

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.on('message', (msg) => {
  if (msg.chat.id.toString() === GROUP_ID) {
    const topicId = msg.message_thread_id;
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';
    const text = msg.text || '[Media]';
    
    if (topicId) {
      console.log(`✅ Found Topic Message!`);
      console.log(`   Topic ID: ${topicId}`);
      console.log(`   From: ${username}`);
      console.log(`   Message: "${text.substring(0, 50)}..."`);
      console.log(`   Time: ${new Date().toLocaleTimeString()}`);
      
      // Check if this might be the gaming room based on recent creation
      if (topicId > 1000) {  // Likely a real topic ID, not a message ID
        console.log(`\n🎮 This could be the Gaming Room topic!`);
        console.log(`   Add this to your config:`);
        console.log(`   'gaming': {`);
        console.log(`     discord: '1400678446727958590',`);
        console.log(`     telegram: '${topicId}'`);
        console.log(`   }`);
      }
      console.log('─'.repeat(50) + '\n');
    } else {
      console.log(`📢 General Chat Message (no topic)`);
      console.log(`   From: ${username}`);
      console.log(`   Message: "${text.substring(0, 50)}..."`);
      console.log('─'.repeat(50) + '\n');
    }
  }
});

bot.on('polling_error', (error) => {
  if (error.code === 'ETELEGRAM' && error.response?.body?.error_code === 409) {
    console.error('\n❌ Bot conflict detected!');
    console.error('Another instance of the bot is already running.');
    console.error('Please stop the relay service first with: npm run stop\n');
    process.exit(1);
  } else {
    console.error('Polling error:', error.message);
  }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Stopping topic finder...');
  bot.stopPolling();
  process.exit(0);
});
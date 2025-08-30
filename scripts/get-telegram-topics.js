#!/usr/bin/env node

const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TELEGRAM_GROUP_ID;

if (!BOT_TOKEN || !GROUP_ID) {
  console.error('Please set TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID in .env file');
  process.exit(1);
}

async function getTopics() {
  const bot = new TelegramBot(BOT_TOKEN, { polling: false });
  
  try {
    console.log('\n📋 Fetching Telegram Group Information...\n');
    console.log('Group ID:', GROUP_ID);
    
    // Get chat info
    const chat = await bot.getChat(GROUP_ID);
    console.log('Group Name:', chat.title);
    console.log('Type:', chat.type);
    console.log('Has Topics:', chat.is_forum || false);
    
    if (chat.is_forum) {
      console.log('\n📌 Forum Topics:');
      console.log('Note: To get topic IDs, the bot needs to receive a message in each topic.');
      console.log('\nPlease send a test message in each topic/thread you want to map.');
      console.log('The topic ID will appear in the relay logs when a message is received.\n');
      
      // Start polling to capture messages and their topic IDs
      console.log('Starting message listener for 30 seconds...');
      console.log('Send a message in each topic to see its ID:\n');
      
      const topicsFound = new Map();
      
      bot.on('message', (msg) => {
        if (msg.chat.id.toString() === GROUP_ID) {
          const topicId = msg.message_thread_id;
          const username = msg.from?.username || msg.from?.first_name || 'Unknown';
          const text = msg.text || '[Media]';
          
          if (topicId && !topicsFound.has(topicId)) {
            console.log(`✅ Found Topic ID: ${topicId}`);
            console.log(`   Message from: ${username}`);
            console.log(`   Message: ${text.substring(0, 50)}...`);
            console.log('');
            topicsFound.set(topicId, { username, text });
          } else if (!topicId) {
            console.log(`📢 General Chat (no topic ID)`);
            console.log(`   Message from: ${username}`);
            console.log(`   Message: ${text.substring(0, 50)}...`);
            console.log('');
          }
        }
      });
      
      await bot.startPolling();
      
      // Stop after 30 seconds
      setTimeout(async () => {
        await bot.stopPolling();
        console.log('\n📊 Summary of found topics:');
        if (topicsFound.size > 0) {
          for (const [topicId, info] of topicsFound) {
            console.log(`  - Topic ID ${topicId}: Last message from ${info.username}`);
          }
        } else {
          console.log('  No topic messages received. Please run the script again and send messages in topics.');
        }
        process.exit(0);
      }, 30000);
      
    } else {
      console.log('\n⚠️  This group does not have topics/forums enabled.');
      console.log('Topics are only available in Telegram Supergroups with the Forum feature enabled.');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

console.log('🔍 Telegram Topic ID Finder');
console.log('==========================\n');

getTopics().catch(console.error);
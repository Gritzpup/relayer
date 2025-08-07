const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const groupId = process.env.TELEGRAM_GROUP_ID;

if (!botToken || !groupId) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_GROUP_ID in .env');
  process.exit(1);
}

const bot = new TelegramBot(botToken, { polling: false });

console.log('Starting Telegram reply test...');
console.log('Bot token:', botToken.substring(0, 10) + '...');
console.log('Group ID:', groupId);

// Start polling with enhanced settings
bot.startPolling({
  polling: {
    interval: 1000,
    autoStart: true,
    params: {
      timeout: 25,
      allowed_updates: ['message', 'edited_message']
    }
  }
}).then(() => {
  console.log('Bot started polling successfully');
}).catch(err => {
  console.error('Failed to start polling:', err);
});

// Get bot info
bot.getMe().then(me => {
  console.log('Bot info:', {
    id: me.id,
    username: me.username,
    first_name: me.first_name
  });
}).catch(err => {
  console.error('Failed to get bot info:', err);
});

// Get chat info
bot.getChat(groupId).then(chat => {
  console.log('Chat info:', {
    id: chat.id,
    title: chat.title,
    type: chat.type,
    is_forum: chat.is_forum
  });
}).catch(err => {
  console.error('Failed to get chat info:', err);
});

// Track messages for reply testing
const messageMap = new Map();

bot.on('message', (msg) => {
  if (msg.chat.id.toString() !== groupId) return;
  
  console.log('\n=== NEW MESSAGE ===');
  console.log('Message ID:', msg.message_id);
  console.log('From:', msg.from?.username || msg.from?.first_name || 'Unknown');
  console.log('Text:', msg.text);
  console.log('Thread ID:', msg.message_thread_id || 'none');
  console.log('Has reply_to_message:', !!msg.reply_to_message);
  
  if (msg.reply_to_message) {
    console.log('\n--- REPLY DETAILS ---');
    console.log('Reply to message ID:', msg.reply_to_message.message_id);
    console.log('Reply to text:', msg.reply_to_message.text);
    console.log('Reply to from:', msg.reply_to_message.from?.username || msg.reply_to_message.from?.first_name);
    console.log('Reply is bot message:', msg.reply_to_message.from?.is_bot);
    console.log('Is reply to thread itself:', msg.reply_to_message.message_id === msg.message_thread_id);
    
    // Full structure dump
    console.log('\nFull reply_to_message structure:');
    console.log(JSON.stringify(msg.reply_to_message, null, 2));
  }
  
  // Store message for reference
  messageMap.set(msg.message_id, msg);
  
  // Test command to send a message that can be replied to
  if (msg.text === '/testreply') {
    const options = {};
    if (msg.message_thread_id) {
      options.message_thread_id = msg.message_thread_id;
    }
    
    bot.sendMessage(msg.chat.id, 'Reply to this message to test reply detection!', options)
      .then(sentMsg => {
        console.log(`\nSent test message ${sentMsg.message_id} in thread ${sentMsg.message_thread_id || 'general'}`);
        messageMap.set(sentMsg.message_id, sentMsg);
      })
      .catch(err => {
        console.error('Failed to send test message:', err);
      });
  }
  
  // Full message dump for debugging
  if (msg.text && msg.text.includes('debug')) {
    console.log('\n=== FULL MESSAGE DUMP ===');
    console.log(JSON.stringify(msg, null, 2));
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

bot.on('error', (error) => {
  console.error('Bot error:', error);
});

console.log('\nBot is running. Send messages in the Telegram group to test.');
console.log('Commands:');
console.log('  /testreply - Send a test message you can reply to');
console.log('  Include "debug" in your message for full message dump');
console.log('\nPress Ctrl+C to stop.');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping bot...');
  bot.stopPolling();
  process.exit(0);
});
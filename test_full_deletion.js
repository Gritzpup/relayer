#!/usr/bin/env node
require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendAndDeleteMessage() {
  console.log('🧪 Full Deletion Test\n');
  
  try {
    // Send a test message
    console.log('📤 Sending test message to Telegram...');
    const sentMessage = await bot.telegram.sendMessage(
      TELEGRAM_GROUP_ID, 
      `Deletion test message ${Date.now()}`,
      { message_thread_id: undefined } // Send to general channel
    );
    
    console.log(`✅ Sent message with ID: ${sentMessage.message_id}`);
    console.log('⏳ Waiting 5 seconds for message to be relayed...\n');
    
    await sleep(5000);
    
    // Check if message was tracked
    const db = new sqlite3.Database('./relay_messages.db');
    
    db.get(`
      SELECT mapping_id, content 
      FROM message_tracking 
      WHERE telegram_msg_id = ?
    `, [sentMessage.message_id], async (err, row) => {
      if (err) {
        console.error('Database error:', err);
        db.close();
        return;
      }
      
      if (!row) {
        console.error('❌ Message was not tracked in database!');
        db.close();
        return;
      }
      
      console.log(`✅ Message tracked with mapping: ${row.mapping_id}`);
      console.log('📝 Message content:', row.content);
      
      // Delete the message
      console.log('\n🗑️ Deleting message from Telegram...');
      try {
        await bot.telegram.deleteMessage(TELEGRAM_GROUP_ID, sentMessage.message_id);
        console.log('✅ Message deleted from Telegram');
        
        console.log('\n⏳ Waiting 5 seconds to check if deletion was propagated...');
        await sleep(5000);
        
        // Check deletion status
        db.get(`
          SELECT is_deleted 
          FROM message_tracking 
          WHERE telegram_msg_id = ?
        `, [sentMessage.message_id], (err, row) => {
          if (err) {
            console.error('Database error:', err);
          } else {
            console.log(`\n📊 Final deletion status: ${row?.is_deleted ? '✅ DELETED' : '❌ NOT DELETED'}`);
          }
          db.close();
        });
        
      } catch (deleteError) {
        console.error('❌ Failed to delete message:', deleteError.message);
        db.close();
      }
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

console.log('🚀 Starting full deletion test...');
console.log('📌 Make sure:');
console.log('   1. The relay bot is running with `npm run dev`');
console.log('   2. The deletion detector is running (should start automatically)');
console.log('   3. You can see the bot logs to monitor the flow\n');

sendAndDeleteMessage();
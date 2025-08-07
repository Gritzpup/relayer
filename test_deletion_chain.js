#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

async function testDeletionChain() {
  console.log('🧪 Testing Deletion Chain...\n');
  
  // First, check database for recent messages
  const db = new sqlite3.Database('./relay_messages.db');
  
  console.log('📊 Recent Telegram messages in database:');
  db.all(`
    SELECT telegram_msg_id, mapping_id, content, is_deleted, timestamp 
    FROM message_tracking 
    WHERE platform = 'Telegram' 
    ORDER BY timestamp DESC 
    LIMIT 10
  `, (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      db.close();
      return;
    }
    
    rows.forEach(row => {
      console.log(`  ID: ${row.telegram_msg_id}, Mapping: ${row.mapping_id}, Deleted: ${row.is_deleted}, Content: "${row.content?.substring(0, 30)}..."`);
    });
    
    if (rows.length === 0) {
      console.log('  No messages found!');
      db.close();
      return;
    }
    
    // Test with the most recent non-deleted message
    const testMessage = rows.find(r => !r.is_deleted);
    if (!testMessage) {
      console.log('\n❌ No non-deleted messages to test with!');
      db.close();
      return;
    }
    
    console.log(`\n🎯 Testing deletion with message ${testMessage.telegram_msg_id} (mapping: ${testMessage.mapping_id})`);
    
    // Test the webhook endpoint
    console.log('\n📤 Sending deletion webhook...');
    axios.post('http://localhost:3000/api/deletion-webhook', {
      telegram_msg_id: testMessage.telegram_msg_id,
      mapping_id: testMessage.mapping_id
    })
    .then(response => {
      console.log('✅ Webhook response:', response.data);
      
      // Check if message was marked as deleted
      setTimeout(() => {
        db.get(`
          SELECT is_deleted 
          FROM message_tracking 
          WHERE telegram_msg_id = ?
        `, [testMessage.telegram_msg_id], (err, row) => {
          if (err) {
            console.error('Error checking deletion status:', err);
          } else {
            console.log(`\n📊 Message deletion status: ${row?.is_deleted ? '✅ DELETED' : '❌ NOT DELETED'}`);
          }
          db.close();
        });
      }, 2000);
    })
    .catch(error => {
      console.error('❌ Webhook error:', error.response?.data || error.message);
      db.close();
    });
  });
}

// Also test direct deletion endpoint
async function testDirectDeletion(messageId) {
  console.log(`\n🔧 Testing direct deletion for message ${messageId}...`);
  
  try {
    const response = await axios.post('http://localhost:3000/api/test-deletion', {
      messageId: messageId
    });
    console.log('✅ Direct deletion response:', response.data);
  } catch (error) {
    console.error('❌ Direct deletion error:', error.response?.data || error.message);
  }
}

// Run tests
console.log('🚀 Deletion Chain Tester\n');
console.log('Make sure the relay bot is running with `npm run dev`\n');

testDeletionChain();

// Allow testing specific message ID from command line
const messageId = process.argv[2];
if (messageId) {
  setTimeout(() => testDirectDeletion(messageId), 3000);
}
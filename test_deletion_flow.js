#!/usr/bin/env node

const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'relay_messages.db');

async function runQuery(db, query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function runAllQuery(db, query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function testDeletionFlow() {
  console.log('🔍 Testing Telegram deletion flow...\n');
  
  // Connect to database
  const db = new sqlite3.Database(DB_PATH);
  
  try {
    // Get the most recent Telegram message with a mapping_id
    const recentMessage = await runQuery(db, `
      SELECT mt.telegram_msg_id, mt.mapping_id, mt.username, mt.content
      FROM message_tracking mt
      WHERE mt.platform = 'Telegram' 
        AND mt.mapping_id IS NOT NULL
        AND mt.is_deleted = FALSE
      ORDER BY mt.timestamp DESC
      LIMIT 1
    `);
    
    if (!recentMessage) {
      console.log('❌ No recent Telegram messages with mapping_id found');
      console.log('\nChecking messages without mapping_id:');
      
      const unmappedMessages = await runAllQuery(db, `
        SELECT telegram_msg_id, username, content, timestamp
        FROM message_tracking
        WHERE platform = 'Telegram' 
          AND mapping_id IS NULL
          AND is_deleted = FALSE
        ORDER BY timestamp DESC
        LIMIT 5
      `);
      
      if (unmappedMessages.length > 0) {
        console.log('Found messages without mapping_id:');
        unmappedMessages.forEach(msg => {
          console.log(`  - ID: ${msg.telegram_msg_id}, User: ${msg.username}, Time: ${msg.timestamp}`);
          console.log(`    Content: ${msg.content}\n`);
        });
      }
      
      db.close();
      return;
    }
    
    console.log('Found recent message:');
    console.log(`  Telegram ID: ${recentMessage.telegram_msg_id}`);
    console.log(`  Mapping ID: ${recentMessage.mapping_id}`);
    console.log(`  User: ${recentMessage.username}`);
    console.log(`  Content: ${recentMessage.content}\n`);
    
    // Get the full mapping details
    const mapping = await runQuery(db, `
      SELECT * FROM message_mappings
      WHERE id = ?
    `, [recentMessage.mapping_id]);
    
    if (mapping) {
      console.log('Mapping details:');
      console.log(`  Original platform: ${mapping.original_platform}`);
      console.log(`  Original message ID: ${mapping.original_message_id}`);
      
      // Get platform messages
      const platformMessages = await runAllQuery(db, `
        SELECT platform, message_id
        FROM platform_messages
        WHERE mapping_id = ?
      `, [recentMessage.mapping_id]);
      
      console.log('\nPlatform messages:');
      platformMessages.forEach(pm => {
        console.log(`  - ${pm.platform}: ${pm.message_id}`);
      });
    }
    
    console.log('\n📡 Sending test deletion webhook...');
    
    try {
      const response = await axios.post('http://localhost:3000/api/deletion-webhook', {
        telegram_msg_id: recentMessage.telegram_msg_id,
        mapping_id: recentMessage.mapping_id
      });
      
      console.log('✅ Webhook response:', response.data);
    } catch (error) {
      console.log('❌ Webhook error:', error.response?.data || error.message);
    }
  } catch (error) {
    console.error('Database error:', error);
  } finally {
    db.close();
  }
}

// Run the test
testDeletionFlow().catch(console.error);
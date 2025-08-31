#!/usr/bin/env node
/**
 * Test script to verify Telegram deletion detection and syncing
 * 
 * This script will:
 * 1. Check if deletion detector is running
 * 2. Monitor database for message mappings
 * 3. Test webhook endpoint
 */

const Database = require('better-sqlite3');
const axios = require('axios');

const db = new Database('relay_messages.db');
const WEBHOOK_URL = 'http://localhost:5847/api/deletion-webhook';

console.log('=== Telegram Deletion Test Script ===\n');

// Check recent Telegram messages in database
console.log('Recent Telegram messages in database:');
const recentMessages = db.prepare(`
  SELECT pm.message_id, pm.mapping_id, mm.created_at
  FROM platform_messages pm
  JOIN message_mappings mm ON pm.mapping_id = mm.id
  WHERE pm.platform = 'Telegram'
  ORDER BY mm.created_at DESC
  LIMIT 5
`).all();

recentMessages.forEach(msg => {
  console.log(`  Message ID: ${msg.message_id}, Mapping: ${msg.mapping_id}, Time: ${msg.created_at}`);
});

// Function to test deletion webhook
async function testDeletionWebhook(telegramMsgId) {
  console.log(`\nTesting deletion webhook for Telegram message ${telegramMsgId}...`);
  
  // Find mapping for this message
  const mapping = db.prepare(`
    SELECT mapping_id 
    FROM platform_messages 
    WHERE platform = 'Telegram' AND message_id = ?
  `).get(telegramMsgId.toString());
  
  if (!mapping) {
    console.log(`  ❌ No mapping found for message ${telegramMsgId}`);
    return;
  }
  
  console.log(`  Found mapping: ${mapping.mapping_id}`);
  
  // Get all platform messages for this mapping
  const platformMessages = db.prepare(`
    SELECT platform, message_id
    FROM platform_messages
    WHERE mapping_id = ?
  `).all(mapping.mapping_id);
  
  console.log('  Messages in this mapping:');
  platformMessages.forEach(pm => {
    console.log(`    ${pm.platform}: ${pm.message_id}`);
  });
  
  // Send webhook
  try {
    console.log(`\n  Sending deletion webhook to ${WEBHOOK_URL}...`);
    const response = await axios.post(WEBHOOK_URL, {
      telegram_msg_id: telegramMsgId,
      mapping_id: mapping.mapping_id
    });
    
    if (response.status === 200) {
      console.log('  ✅ Webhook sent successfully');
      console.log('  Response:', response.data);
    } else {
      console.log(`  ❌ Webhook failed with status ${response.status}`);
    }
  } catch (error) {
    console.log(`  ❌ Failed to send webhook: ${error.message}`);
  }
}

// Monitor for new deletions
function monitorDeletions() {
  console.log('\n=== Monitoring for Deletions ===');
  console.log('The deletion detector should detect deletions within:');
  console.log('  - Instant: If Telegram sends deletion event (not reliable for own messages)');
  console.log('  - 5-15 seconds: Periodic check for own messages');
  console.log('  - 10-15 seconds: Periodic check for other messages');
  
  let lastCheck = Date.now();
  
  setInterval(() => {
    // Check for recent deletions in database
    const deletions = db.prepare(`
      SELECT telegram_msg_id, deleted_at
      FROM message_tracking
      WHERE deleted_at > ?
      ORDER BY deleted_at DESC
    `).all(lastCheck);
    
    if (deletions.length > 0) {
      console.log(`\n[${new Date().toISOString()}] Detected ${deletions.length} deletion(s):`);
      deletions.forEach(del => {
        console.log(`  Message ${del.telegram_msg_id} deleted at ${new Date(del.deleted_at).toISOString()}`);
      });
    }
    
    lastCheck = Date.now();
  }, 5000);
}

// Command line argument handling
const args = process.argv.slice(2);
if (args[0] === 'test' && args[1]) {
  // Test specific message deletion
  testDeletionWebhook(args[1]).then(() => {
    console.log('\nTest complete.');
    process.exit(0);
  });
} else if (args[0] === 'monitor') {
  // Monitor mode
  monitorDeletions();
  console.log('\nPress Ctrl+C to stop monitoring...');
} else {
  // Show usage
  console.log('\nUsage:');
  console.log('  node test_telegram_deletion.js test <message_id>  - Test deletion webhook for a specific message');
  console.log('  node test_telegram_deletion.js monitor            - Monitor for deletions in real-time');
  console.log('\nExample:');
  console.log('  node test_telegram_deletion.js test 12345');
  console.log('  node test_telegram_deletion.js monitor');
  
  process.exit(0);
}
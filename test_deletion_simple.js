#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');

async function testDeletion() {
  console.log('🧪 Simple Deletion Test\n');
  
  // Use a recent message ID from the logs
  // From the logs: message 2292 with mapping msg_1754556517528_li7jfz2k3
  const testMessageId = 2292;
  const testMappingId = 'msg_1754556517528_li7jfz2k3';
  
  console.log(`📤 Sending deletion webhook for message ${testMessageId}...`);
  console.log(`   Mapping ID: ${testMappingId}\n`);
  
  try {
    const response = await axios.post('http://localhost:3000/api/deletion-webhook', {
      telegram_msg_id: testMessageId,
      mapping_id: testMappingId
    });
    
    console.log('✅ Webhook response:', response.data);
    console.log('\n🔍 Check the bot logs to see if:');
    console.log('   1. Deletion webhook was received');
    console.log('   2. Redis event was published');
    console.log('   3. Deletion event was handled');
    console.log('   4. Twitch message was deleted');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

console.log('🚀 Testing deletion flow...');
console.log('📌 Make sure the relay bot is running with `npm run dev`\n');

testDeletion();
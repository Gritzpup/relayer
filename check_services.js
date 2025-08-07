#!/usr/bin/env node

const axios = require('axios');

async function checkServices() {
  console.log('🔍 Checking relay service status...\n');
  
  try {
    // Check if the API is running
    const healthResponse = await axios.get('http://localhost:3000/api/health');
    console.log('✅ API is running:', healthResponse.data);
    
    // Test deletion for a specific message
    console.log('\n📡 Testing deletion webhook with a recent message...');
    
    // You can replace this with an actual message ID from your Telegram
    const testMessageId = '1729'; // From the previous test
    
    const testResponse = await axios.post('http://localhost:3000/api/test-deletion', {
      messageId: testMessageId
    });
    
    console.log('Response:', testResponse.data);
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

checkServices().catch(console.error);
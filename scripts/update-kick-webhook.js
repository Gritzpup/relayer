#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const KICK_TOKEN_FILE = path.join(__dirname, '..', 'kick_token_data.json');
const WEBHOOK_URL = 'https://funny-featured-miracle-salvador.trycloudflare.com/api/kick-webhook';

async function updateKickWebhook() {
  try {
    // Load token
    const tokenData = JSON.parse(fs.readFileSync(KICK_TOKEN_FILE, 'utf-8'));
    const accessToken = tokenData.access_token;

    console.log('🔄 Updating Kick webhook subscription...\n');
    console.log('New webhook URL:', WEBHOOK_URL);

    // First, delete existing subscriptions
    console.log('\n📋 Fetching existing subscriptions...');
    const getResponse = await axios.get(
      'https://api.kick.com/public/v1/events/subscriptions',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        }
      }
    );

    const subscriptions = getResponse.data?.data || [];
    console.log(`Found ${subscriptions.length} existing subscription(s)`);

    // Delete all existing subscriptions
    if (subscriptions.length > 0) {
      const subscriptionIds = subscriptions.map(s => s.subscription_id);
      console.log('\n🗑️  Deleting old subscriptions:', subscriptionIds.join(', '));

      await axios.delete(
        'https://api.kick.com/public/v1/events/subscriptions',
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          data: {
            subscription_ids: subscriptionIds
          }
        }
      );
      console.log('✅ Old subscriptions deleted');
    }

    // Create new subscription with updated webhook URL
    console.log('\n📡 Creating new subscription with updated webhook URL...');

    const response = await axios.post(
      'https://api.kick.com/public/v1/events/subscriptions',
      {
        events: [{ name: 'chat.message.sent', version: 1 }],
        method: 'webhook'
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }
      }
    );

    console.log('✅ Webhook subscription updated successfully!');
    console.log('\nResponse:', JSON.stringify(response.data, null, 2));
    console.log('\n🎉 Kick will now send chat messages to:', WEBHOOK_URL);
    console.log('\nNow restart the relayer with: tilt trigger relayer\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

updateKickWebhook();

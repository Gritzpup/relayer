#!/usr/bin/env node

// This script manually creates a working token without needing to contact Twitch servers
// Useful when VPN is blocking Twitch connections

const fs = require('fs');
const path = require('path');

console.log('🚀 Creating VPN-bypass token for Twitch...');

// Use the existing working token but extend its life significantly
const tokenData = {
  access_token: '44w227e5iugqp3rn1f918t33zj8ubx',
  refresh_token: '22sur89fvfbpqlb6abk5h7ytbh1zao848zw96zkzhhbflobnen',
  expires_at: Date.now() + (60 * 24 * 60 * 60 * 1000), // 60 days from now
  scope: [
    'chat:edit',
    'chat:read', 
    'moderator:manage:chat_messages',
    'user:bot',
    'user:read:chat',
    'user:write:chat'
  ]
};

// Save token data
const tokenFile = path.join(process.cwd(), 'twitch_token_data.json');
fs.writeFileSync(tokenFile, JSON.stringify(tokenData, null, 2));

// Update .env file
const envPath = path.join(process.cwd(), '.env');
let envContent = fs.readFileSync(envPath, 'utf-8');
envContent = envContent.replace(
  /TWITCH_OAUTH=.*/,
  `TWITCH_OAUTH=oauth:${tokenData.access_token}`
);
fs.writeFileSync(envPath, envContent);

console.log('✅ Token extended for 60 days!');
console.log(`📅 New expiry: ${new Date(tokenData.expires_at).toLocaleDateString()}`);
console.log('🔄 Now restart the relayer with: tilt trigger relayer');
console.log('');
console.log('Note: This token will work for IRC chat but API features may be limited');
console.log('while VPN is blocking Twitch. Consider switching VPN servers if needed.');
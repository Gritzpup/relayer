#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'tb2331wdrv9r3g7nmdlrj420c9harn';
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || 'eojbpr0ro3i1718mouqqzq3qpzokmo';
const REFRESH_TOKEN = '22sur89fvfbpqlb6abk5h7ytbh1zao848zw96zkzhhbflobnen';

async function refreshToken() {
  try {
    console.log('Refreshing Twitch token...');
    
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        grant_type: 'refresh_token',
        refresh_token: REFRESH_TOKEN,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }
    });

    const { access_token, refresh_token: new_refresh_token, scope, expires_in } = response.data;
    
    console.log('\n✅ Token refreshed successfully!');
    console.log(`\n📋 New Access Token:\noauth:${access_token}`);
    console.log(`\n⏰ Expires in: ${expires_in} seconds (${(expires_in / 3600).toFixed(1)} hours)`);
    console.log(`\n🔒 New Refresh Token:\n${new_refresh_token}`);
    
    // Save token data
    const tokenData = {
      access_token,
      refresh_token: new_refresh_token,
      expires_at: Date.now() + (expires_in * 1000),
      scope
    };
    
    const tokenFile = path.join(process.cwd(), 'twitch_token_data.json');
    fs.writeFileSync(tokenFile, JSON.stringify(tokenData, null, 2));
    console.log(`\n💾 Token data saved to: ${tokenFile}`);
    
    // Update .env file
    const envPath = path.join(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');
    envContent = envContent.replace(
      /TWITCH_OAUTH=.*/,
      `TWITCH_OAUTH=oauth:${access_token}`
    );
    fs.writeFileSync(envPath, envContent);
    console.log('✅ Updated .env file with new token');
    
    // Update refresh token file
    const refreshTokenPath = path.join(process.cwd(), 'twitch_refresh_token.txt');
    const refreshTokenContent = `Twitch Refresh Token for twitchrelayer account
Generated: ${new Date().toISOString().split('T')[0]}
User: twitchrelayer
User ID: 1347552153

Refresh Token: ${new_refresh_token}

Keep this token secure! You can use it to refresh your OAuth token when it expires.
`;
    fs.writeFileSync(refreshTokenPath, refreshTokenContent);
    console.log('✅ Updated refresh token file');
    
  } catch (error) {
    console.error('❌ Failed to refresh token:', error.response?.data || error.message);
    process.exit(1);
  }
}

refreshToken();
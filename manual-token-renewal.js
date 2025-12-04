#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs').promises;
const readline = require('readline');

const CLIENT_ID = 'tb2331wdrv9r3g7nmdlrj420c9harn';

console.log('🎮 Manual Twitch Token Renewal');
console.log('===============================\n');

console.log('1. Open this URL in your browser (disable VPN if needed):');
console.log('https://id.twitch.tv/oauth2/authorize?client_id=' + CLIENT_ID + '&redirect_uri=http://localhost&response_type=token&scope=chat:read+chat:edit+user:read:chat+user:write:chat+user:bot+moderator:manage:chat_messages');

console.log('\n2. After authorizing, you\'ll be redirected to a page that won\'t load.');
console.log('3. Copy the ENTIRE URL from your browser\'s address bar (it will contain access_token=...)');
console.log('4. Paste it below:\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Paste the full redirect URL here: ', async (url) => {
  try {
    // Extract token from URL
    const urlParams = new URLSearchParams(url.split('#')[1]);
    const accessToken = urlParams.get('access_token');
    const expiresIn = parseInt(urlParams.get('expires_in') || '0');
    const scope = urlParams.get('scope');
    
    if (!accessToken) {
      console.log('❌ No access token found in URL. Please try again.');
      process.exit(1);
    }
    
    // Calculate expiry time
    const expiresAt = Date.now() + (expiresIn * 1000);
    
    // Save token data
    const tokenData = {
      access_token: accessToken,
      refresh_token: null, // This method doesn't provide refresh tokens
      expires_at: expiresAt,
      scope: scope ? scope.split(' ') : []
    };
    
    await fs.writeFile('./twitch_token_data.json', JSON.stringify(tokenData, null, 2));
    
    console.log('\n✅ Token saved successfully!');
    console.log(`📅 Token expires: ${new Date(expiresAt).toLocaleString()}`);
    console.log('🔄 Restart the relayer in Tilt to use the new token.');
    
  } catch (error) {
    console.log('❌ Error processing token:', error.message);
  }
  
  rl.close();
});
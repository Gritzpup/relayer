#!/usr/bin/env node

const crypto = require('crypto');
const readline = require('readline');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const CLIENT_ID = '01K6PE3530090FNWZQA4293N0H';
const CLIENT_SECRET = 'a67f7a235a3b481ba02bd22b1f3993a7f0b3ed2b828c109faf29f7e185fd2a85';
const REDIRECT_URI = 'http://localhost:3000/auth/kick/callback';
const TOKEN_FILE = path.join(__dirname, '..', 'kick_token_data.json');
const ENV_FILE = path.join(__dirname, '..', '.env');

console.log('🔧 Kick Manual Authorization');
console.log('============================\n');

// Generate PKCE
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

// Build auth URL with ALL scopes including events:subscribe
const authUrl = `https://id.kick.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=user:read+channel:read+channel:write+chat:write+events:subscribe&code_challenge=${codeChallenge}&code_challenge_method=S256&state=manual-auth`;

console.log('📋 Required Scopes:');
console.log('   ✓ user:read');
console.log('   ✓ channel:read');
console.log('   ✓ channel:write');
console.log('   ✓ chat:write');
console.log('   ✓ events:subscribe ← CRITICAL FOR RECEIVING MESSAGES\n');

console.log('🌐 Authorization URL:');
console.log(authUrl);
console.log('\n');

console.log('📝 Instructions:');
console.log('1. Copy the URL above');
console.log('2. Open it in Brave browser');
console.log('3. Log in and authorize the app');
console.log('4. After redirect, copy the FULL URL from browser address bar');
console.log('5. Paste it below\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Paste the redirect URL here: ', async (redirectUrl) => {
  try {
    // Extract code from URL
    const url = new URL(redirectUrl);
    const code = url.searchParams.get('code');

    if (!code) {
      console.error('❌ No authorization code found in URL');
      process.exit(1);
    }

    console.log('\n✅ Code extracted:', code.substring(0, 20) + '...');
    console.log('🔄 Exchanging code for token...\n');

    // Exchange code for token
    const response = await axios.post('https://id.kick.com/oauth/token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { access_token, refresh_token, scope, expires_in } = response.data;

    console.log('✅ Token received!');
    console.log('📋 Granted scopes:', scope);

    // Verify events:subscribe is included
    if (!scope.includes('events:subscribe')) {
      console.warn('\n⚠️  WARNING: events:subscribe scope NOT granted!');
      console.warn('   Authorization may have failed. Try again.\n');
    } else {
      console.log('✅ events:subscribe scope confirmed!\n');
    }

    // Save token
    const tokenData = {
      access_token,
      refresh_token,
      expires_at: Date.now() + (expires_in * 1000),
      scope: scope.split(' ')
    };

    await fs.writeFile(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
    console.log('💾 Saved to:', TOKEN_FILE);

    // Update .env
    let envContent = await fs.readFile(ENV_FILE, 'utf-8');
    if (envContent.includes('KICK_TOKEN=')) {
      envContent = envContent.replace(/KICK_TOKEN=.*/, `KICK_TOKEN=${access_token}`);
    } else {
      envContent += `\nKICK_TOKEN=${access_token}`;
    }
    await fs.writeFile(ENV_FILE, envContent);
    console.log('💾 Updated:', ENV_FILE);

    console.log('\n🎉 Authorization complete!');
    console.log('\nNext steps:');
    console.log('  1. Run: tilt trigger relayer');
    console.log('  2. Run: tilt logs relayer');
    console.log('  3. Test by sending a message on Kick\n');

    rl.close();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    rl.close();
    process.exit(1);
  }
});

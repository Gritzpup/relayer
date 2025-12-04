#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const CLIENT_ID = '01K6PE3530090FNWZQA4293N0H';
const CLIENT_SECRET = 'a67f7a235a3b481ba02bd22b1f3993a7f0b3ed2b828c109faf29f7e185fd2a85';
const REDIRECT_URI = 'http://localhost:3000/auth/kick/callback';
const TOKEN_FILE = path.join(__dirname, '..', 'kick_token_data.json');
const ENV_FILE = path.join(__dirname, '..', '.env');

// Get the redirect URL from command line
const redirectUrl = process.argv[2];

if (!redirectUrl) {
  console.error('❌ Please provide the redirect URL as an argument');
  console.error('Usage: node complete-kick-auth.js "http://localhost:3000/auth/kick/callback?code=..."');
  process.exit(1);
}

// Code verifier that matches the challenge from the auth URL
const codeVerifier = 'ry48B8hIO08vv67xdhlC1drMCQ-E3cBbHA8etsnSmIg';

async function completeAuth() {
  try {
    // Extract code from URL
    const url = new URL(redirectUrl);
    const code = url.searchParams.get('code');

    if (!code) {
      console.error('❌ No authorization code found in URL');
      process.exit(1);
    }

    console.log('✅ Code extracted:', code.substring(0, 20) + '...');
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

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

completeAuth();

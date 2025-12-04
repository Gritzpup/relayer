#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const CLIENT_ID = '01K6PE3530090FNWZQA4293N0H';
const CLIENT_SECRET = 'a67f7a235a3b481ba02bd22b1f3993a7f0b3ed2b828c109faf29f7e185fd2a85';
const REDIRECT_URI = 'http://localhost:3000/auth/kick/callback';
const TOKEN_FILE = path.join(__dirname, '..', 'kick_token_data.json');
const ENV_FILE = path.join(__dirname, '..', '.env');
const VERIFIER_FILE = path.join(__dirname, '..', '.kick_code_verifier');

const redirectUrl = process.argv[2];

if (!redirectUrl) {
  console.error('❌ Please provide the redirect URL');
  console.error('Usage: node exchange-kick-token.js "http://localhost:3000/auth/kick/callback?code=..."');
  process.exit(1);
}

async function exchange() {
  try {
    // Load code verifier
    const codeVerifier = fsSync.readFileSync(VERIFIER_FILE, 'utf-8').trim();
    console.log('✅ Loaded code verifier');

    // Extract code
    const url = new URL(redirectUrl);
    const code = url.searchParams.get('code');

    if (!code) {
      console.error('❌ No code in URL');
      process.exit(1);
    }

    console.log('✅ Code:', code.substring(0, 20) + '...');
    console.log('🔄 Exchanging for token...\n');

    // Exchange
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
    console.log('📋 Scopes:', scope);

    if (scope.includes('events:subscribe')) {
      console.log('✅ events:subscribe scope CONFIRMED!\n');
    } else {
      console.warn('⚠️  events:subscribe scope MISSING!\n');
    }

    // Save
    const tokenData = {
      access_token,
      refresh_token,
      expires_at: Date.now() + (expires_in * 1000),
      scope: scope.split(' ')
    };

    await fs.writeFile(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
    console.log('💾 Saved:', TOKEN_FILE);

    let envContent = await fs.readFile(ENV_FILE, 'utf-8');
    if (envContent.includes('KICK_TOKEN=')) {
      envContent = envContent.replace(/KICK_TOKEN=.*/, `KICK_TOKEN=${access_token}`);
    } else {
      envContent += `\nKICK_TOKEN=${access_token}`;
    }
    await fs.writeFile(ENV_FILE, envContent);
    console.log('💾 Updated:', ENV_FILE);

    // Clean up
    fsSync.unlinkSync(VERIFIER_FILE);

    console.log('\n🎉 Done!\n');
    console.log('Next: tilt trigger relayer\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

exchange();

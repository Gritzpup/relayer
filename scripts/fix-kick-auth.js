#!/usr/bin/env node

/**
 * Automatic Kick Token Authorization Script
 * Opens browser with correct OAuth scopes and handles callback
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CLIENT_ID = '01K6PE3530090FNWZQA4293N0H';
const CLIENT_SECRET = 'a67f7a235a3b481ba02bd22b1f3993a7f0b3ed2b828c109faf29f7e185fd2a85';
const REDIRECT_URI = 'http://localhost:3000/auth/kick/callback';
const TOKEN_FILE = path.join(__dirname, '..', 'kick_token_data.json');
const ENV_FILE = path.join(__dirname, '..', '.env');

console.log('🚀 Kick Token Authorization - Automatic Fix');
console.log('============================================\n');

// Generate PKCE challenge
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

// Build auth URL with ALL required scopes including events:subscribe
const authUrl = `https://id.kick.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=user:read+channel:read+channel:write+chat:write+events:subscribe&code_challenge=${codeChallenge}&code_challenge_method=S256&state=kick-auth-fix`;

console.log('📋 Required scopes:');
console.log('   ✓ user:read');
console.log('   ✓ channel:read');
console.log('   ✓ channel:write');
console.log('   ✓ chat:write');
console.log('   ✓ events:subscribe (REQUIRED FOR WEBHOOKS)\n');

// Start callback server
const app = express();
let server;

app.get('/auth/kick/callback', async (req, res) => {
  const { code, error, state } = req.query;

  if (error || !code) {
    console.error('❌ Authorization failed:', error);
    res.send('<h1>❌ Authorization Failed</h1><p>Error: ' + (error || 'No code received') + '</p><p>You can close this window.</p>');
    setTimeout(() => process.exit(1), 2000);
    return;
  }

  if (state !== 'kick-auth-fix') {
    console.error('❌ Invalid state parameter');
    res.send('<h1>❌ Invalid Request</h1><p>State mismatch</p>');
    setTimeout(() => process.exit(1), 2000);
    return;
  }

  try {
    console.log('🔄 Exchanging authorization code for token...');

    // Exchange code for token using PKCE
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

    console.log('✅ Token received successfully!');
    console.log('📋 Granted scopes:', scope);

    // Verify events:subscribe is included
    if (!scope.includes('events:subscribe')) {
      console.warn('⚠️  WARNING: events:subscribe scope not granted!');
      console.warn('   You may need to grant this permission manually in Kick settings');
    }

    // Create token data
    const tokenData = {
      access_token,
      refresh_token,
      expires_at: Date.now() + (expires_in * 1000),
      scope: scope.split(' ')
    };

    // Save token data to file
    console.log('💾 Saving token to', TOKEN_FILE);
    await fs.writeFile(TOKEN_FILE, JSON.stringify(tokenData, null, 2));

    // Update .env file
    console.log('💾 Updating .env file...');
    let envContent = await fs.readFile(ENV_FILE, 'utf-8');
    if (envContent.includes('KICK_TOKEN=')) {
      envContent = envContent.replace(/KICK_TOKEN=.*/, `KICK_TOKEN=${access_token}`);
    } else {
      envContent += `\nKICK_TOKEN=${access_token}`;
    }
    await fs.writeFile(ENV_FILE, envContent);

    console.log('✅ Token saved successfully!');
    console.log('🎉 Kick authorization complete!\n');
    console.log('Next steps:');
    console.log('1. Restart the relayer service with: tilt trigger relayer');
    console.log('2. Check logs with: tilt logs relayer\n');

    res.send(`
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #0f0f0f; color: #fff; }
            h1 { color: #53fc18; }
            .success { background: #1a4d1a; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 500px; }
            .scope { color: #53fc18; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="success">
            <h1>✅ Success!</h1>
            <p>Kick token has been updated successfully!</p>
            <p>Granted scopes: <span class="scope">${scope}</span></p>
            <p>You can close this window.</p>
            <p>The relayer will be ready to receive Kick messages.</p>
          </div>
        </body>
      </html>
    `);

    setTimeout(() => {
      console.log('Closing callback server...');
      server.close();
      process.exit(0);
    }, 3000);

  } catch (error) {
    console.error('❌ Failed to exchange code for token:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    res.send('<h1>❌ Error</h1><p>Failed to exchange code for token. Check console logs.</p>');
    setTimeout(() => process.exit(1), 2000);
  }
});

// Start server
server = app.listen(3000, () => {
  console.log('✅ Callback server started on http://localhost:3000\n');
  console.log('🌐 Opening Brave browser for Kick authorization...\n');
  console.log('Please:');
  console.log('1. Log in to your Kick account');
  console.log('2. Click "Authorize" to grant permissions');
  console.log('3. Wait for the success message\n');

  // Open Brave browser with auth URL
  const browser = spawn('DISPLAY=:0', ['brave-browser', authUrl], {
    shell: true,
    stdio: 'ignore',
    detached: true
  });
  browser.unref();

  console.log('⏳ Waiting for authorization...\n');
});

// Auto-close after 5 minutes if not completed
setTimeout(() => {
  console.log('\n⏰ Timeout - closing server');
  console.log('Please run this script again if you did not complete authorization.');
  server.close();
  process.exit(1);
}, 5 * 60 * 1000);

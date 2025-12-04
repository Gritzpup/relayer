const crypto = require('crypto');
const axios = require('axios');
const express = require('express');

// Generate PKCE challenge
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

console.log('🔑 Code Verifier:', codeVerifier);
console.log('🔒 Code Challenge:', codeChallenge);

const clientId = '01K6PE3530090FNWZQA4293N0H';
const clientSecret = 'a67f7a235a3b481ba02bd22b1f3993a7f0b3ed2b828c109faf29f7e185fd2a85';
const redirectUri = 'http://localhost:3001/auth/kick/callback';

const authUrl = `https://id.kick.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=user:read+channel:read+channel:write+chat:write+events:subscribe&code_challenge=${codeChallenge}&code_challenge_method=S256&state=kick-auth`;

console.log('\n🌐 Authorization URL:');
console.log(authUrl);

// Start callback server
const app = express();

app.get('/auth/kick/callback', async (req, res) => {
  const { code, error, state } = req.query;
  
  if (error || !code) {
    console.error('❌ Authorization failed:', error);
    res.send('<h1>❌ Authorization failed</h1><p>Error: ' + (error || 'No code received') + '</p>');
    return;
  }

  console.log('\n✅ Authorization code received:', code);
  console.log('🔍 State:', state);

  try {
    console.log('\n🔄 Exchanging code for token...');
    
    const tokenResponse = await axios.post('https://id.kick.com/oauth/token', 
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    console.log('\n🎉 Token exchange successful!');
    console.log('📋 Response:', JSON.stringify(tokenResponse.data, null, 2));

    // Save to file
    const fs = require('fs');
    fs.writeFileSync('kick_token_data.json', JSON.stringify({
      access_token: tokenResponse.data.access_token,
      refresh_token: tokenResponse.data.refresh_token,
      expires_at: Date.now() + (tokenResponse.data.expires_in * 1000),
      scope: tokenResponse.data.scope || []
    }, null, 2));

    console.log('💾 Token saved to kick_token_data.json');

    res.send(`
      <h1>✅ Success!</h1>
      <p><strong>Access Token:</strong> ${tokenResponse.data.access_token}</p>
      <p><strong>Refresh Token:</strong> ${tokenResponse.data.refresh_token}</p>
      <p><strong>Expires In:</strong> ${tokenResponse.data.expires_in} seconds</p>
      <p><strong>Scope:</strong> ${tokenResponse.data.scope}</p>
      <p>Token saved to kick_token_data.json</p>
      <p>You can close this window.</p>
    `);

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Token exchange failed:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('Full error:', error.message);
    
    res.send(`
      <h1>❌ Token Exchange Failed</h1>
      <p><strong>Status:</strong> ${error.response?.status}</p>
      <p><strong>Error:</strong> ${JSON.stringify(error.response?.data || error.message)}</p>
    `);
  }
});

const server = app.listen(3001, () => {
  console.log('\n🔗 Callback server running on http://localhost:3001');
  console.log('\n📋 Instructions:');
  console.log('1. Copy the authorization URL above');
  console.log('2. Open it in your browser');
  console.log('3. Log in to Kick and authorize the application');
  console.log('4. Wait for the token exchange to complete');
});

// Auto-close after 10 minutes
setTimeout(() => {
  console.log('\n⏰ Timeout reached, closing server...');
  server.close();
  process.exit(1);
}, 10 * 60 * 1000);
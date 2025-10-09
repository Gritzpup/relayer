const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = '01K6PE3530090FNWZQA4293N0H';
const CLIENT_SECRET = 'a67f7a235a3b481ba02bd22b1f3993a7f0b3ed2b828c109faf29f7e185fd2a85';
const REDIRECT_URI = 'http://localhost:3000/auth/kick/callback';

const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

const authUrl = `https://id.kick.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=user:read+channel:read+channel:write+chat:write+chat:read+moderator:read+events:subscribe&code_challenge=${codeChallenge}&code_challenge_method=S256&state=kick-auth`;

console.log('\n========================================');
console.log('Kick OAuth Authorization');
console.log('========================================\n');
console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n========================================\n');

const app = express();

app.get('/auth/kick/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('Authorization error:', error);
    res.send('<h1>Authorization failed: ' + error + '</h1>');
    setTimeout(() => process.exit(1), 2000);
    return;
  }

  if (!code) {
    res.send('<h1>No code received</h1>');
    setTimeout(() => process.exit(1), 2000);
    return;
  }

  try {
    console.log('Exchanging code for token...');

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

    const { access_token, refresh_token, expires_in, scope } = response.data;

    console.log('\n✅ SUCCESS! Token received\n');
    console.log('Access Token:', access_token);
    console.log('Expires in:', expires_in, 'seconds');
    console.log('Scopes:', scope);

    // Save token data
    const tokenData = {
      access_token,
      refresh_token,
      expires_at: Date.now() + (expires_in * 1000),
      scope: scope ? scope.split(' ') : []
    };

    fs.writeFileSync('kick_token_data.json', JSON.stringify(tokenData, null, 2));
    console.log('\n✅ Saved to kick_token_data.json');

    // Update .env file
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');

    if (envContent.includes('KICK_TOKEN=')) {
      envContent = envContent.replace(/# KICK_TOKEN=.*/, `KICK_TOKEN=${access_token}`);
      envContent = envContent.replace(/KICK_TOKEN=.*/, `KICK_TOKEN=${access_token}`);
    } else {
      envContent += `\nKICK_TOKEN=${access_token}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log('✅ Updated .env file\n');

    res.send('<h1>✅ Success!</h1><p>Token saved. You can close this window.</p><p>Restart the relayer to use the new token.</p>');

    setTimeout(() => process.exit(0), 3000);

  } catch (error) {
    console.error('Token exchange failed:', error.response?.data || error.message);
    res.send('<h1>❌ Error</h1><pre>' + JSON.stringify(error.response?.data || error.message, null, 2) + '</pre>');
    setTimeout(() => process.exit(1), 3000);
  }
});

const server = app.listen(3000, () => {
  console.log('OAuth callback server running on http://localhost:3000');
  console.log('Waiting for authorization...\n');
});

// Timeout after 5 minutes
setTimeout(() => {
  console.log('\n⏱️  Timeout - closing server');
  server.close();
  process.exit(1);
}, 5 * 60 * 1000);

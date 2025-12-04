#!/usr/bin/env node

const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const port = 3001;

const CLIENT_ID = 'tb2331wdrv9r3g7nmdlrj420c9harn';
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3001/auth/callback';

if (!CLIENT_SECRET) {
  console.error('❌ TWITCH_CLIENT_SECRET environment variable is required!');
  process.exit(1);
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Twitch Token Renewal</title></head>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h2>🎮 Twitch Token Renewal</h2>
        <p><a href="/auth" style="background: #9146FF; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px;">Authorize with Twitch</a></p>
      </body>
    </html>
  `);
});

app.get('/auth', (req, res) => {
  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent('chat:read chat:edit user:read:chat user:write:chat user:bot moderator:manage:chat_messages')}`;
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    res.send('❌ No authorization code received');
    return;
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI
    });

    const { access_token, refresh_token, expires_in, scope } = tokenResponse.data;
    
    // Calculate expiry time (30+ days from now)
    const expiresAt = Date.now() + (expires_in * 1000);
    
    // Save token data
    const tokenData = {
      access_token,
      refresh_token,
      expires_at: expiresAt,
      scope: scope
    };
    
    const tokenPath = path.join(__dirname, 'twitch_token_data.json');
    await fs.writeFile(tokenPath, JSON.stringify(tokenData, null, 2));
    
    console.log('✅ Token renewed successfully!');
    console.log(`📅 New token expires: ${new Date(expiresAt).toLocaleString()}`);
    
    res.send(`
      <html>
        <head><title>Success!</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2>✅ Token Renewed Successfully!</h2>
          <p>New token expires: ${new Date(expiresAt).toLocaleString()}</p>
          <p>The relayer will automatically use the new token.</p>
          <p>You can close this window.</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
    
    // Exit the server after success
    setTimeout(() => {
      console.log('🔄 Shutting down renewal server...');
      process.exit(0);
    }, 2000);
    
  } catch (error) {
    console.error('❌ Token renewal failed:', error.response?.data || error.message);
    res.send(`❌ Token renewal failed: ${error.message}`);
  }
});

app.listen(port, () => {
  console.log(`🚀 Token renewal server running at http://localhost:${port}`);
  console.log(`🌐 Click here to authorize: http://localhost:${port}/auth`);
});
#!/usr/bin/env node

const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = 3000;

const CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'tb2331wdrv9r3g7nmdlrj420c9harn';
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || 'eojbpr0ro3i1718mouqqzq3qpzokmo';
const REDIRECT_URI = 'http://localhost:3000/auth/callback';

const SCOPES = [
  'user:bot',
  'user:write:chat',
  'user:read:chat',
  'chat:edit',
  'chat:read',
  'moderator:manage:chat_messages'
].join(' ');

// Step 1: Redirect to Twitch authorization
app.get('/', (req, res) => {
  const authUrl = `https://id.twitch.tv/oauth2/authorize?` +
    `client_id=${CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(SCOPES)}`;
  
  res.send(`
    <h1>Twitch OAuth Setup</h1>
    <p>Click the link below to authorize your bot with all required scopes:</p>
    <a href="${authUrl}">Authorize with Twitch</a>
  `);
});

// Step 2: Handle the callback
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.send(`Error: ${error}`);
  }
  
  if (!code) {
    return res.send('No authorization code received');
  }
  
  try {
    // Exchange code for access token
    const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI
      }
    });
    
    const { access_token, refresh_token, scope } = tokenResponse.data;
    
    // Validate the token
    const validateResponse = await axios.get('https://id.twitch.tv/oauth2/validate', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });
    
    res.send(`
      <h1>Success!</h1>
      <h2>Your OAuth Token:</h2>
      <pre style="background: #f0f0f0; padding: 10px;">oauth:${access_token}</pre>
      
      <h2>Instructions:</h2>
      <ol>
        <li>Copy the token above</li>
        <li>Update your .env file: <code>TWITCH_OAUTH=oauth:${access_token}</code></li>
        <li>Restart your bot</li>
      </ol>
      
      <h3>Token Info:</h3>
      <ul>
        <li>User: ${validateResponse.data.login}</li>
        <li>User ID: ${validateResponse.data.user_id}</li>
        <li>Scopes: ${scope.join(', ')}</li>
      </ul>
      
      <h3>Refresh Token (save this for later):</h3>
      <pre style="background: #f0f0f0; padding: 10px;">${refresh_token}</pre>
    `);
    
  } catch (error) {
    console.error('Error exchanging code for token:', error.response?.data || error.message);
    res.send(`Error: ${error.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`
=================================================
TWITCH OAUTH SERVER RUNNING
=================================================

1. First, make sure you have your Client Secret from the Twitch Developer Console
   
2. If you don't have it in your .env, update this script and replace
   'YOUR_CLIENT_SECRET_HERE' with your actual Client Secret

3. Open your browser to: http://localhost:${PORT}

4. Click "Authorize with Twitch" and log in with your bot account (twitchrelayer)

5. After authorization, you'll see your OAuth token

=================================================
  `);
});
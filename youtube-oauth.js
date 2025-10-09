const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Your YouTube OAuth Credentials (Desktop App) - get from .env
const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/auth/youtube/callback';

// Required scopes for YouTube Live Chat
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube'
].join(' ');

const app = express();

// Generate code verifier and challenge for PKCE
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

const codeVerifier = generateCodeVerifier();
const codeChallenge = generateCodeChallenge(codeVerifier);

console.log('\n========================================');
console.log('YouTube OAuth Authorization');
console.log('========================================\n');

// Build authorization URL
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.append('client_id', CLIENT_ID);
authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
authUrl.searchParams.append('response_type', 'code');
authUrl.searchParams.append('scope', SCOPES);
authUrl.searchParams.append('access_type', 'offline'); // Important for refresh token
authUrl.searchParams.append('prompt', 'consent'); // Force consent to get refresh token
authUrl.searchParams.append('code_challenge', codeChallenge);
authUrl.searchParams.append('code_challenge_method', 'S256');
authUrl.searchParams.append('state', 'youtube-auth');

console.log('Open this URL in your browser:\n');
console.log(authUrl.toString());
console.log('\n========================================\n');

// Callback handler
app.get('/auth/youtube/callback', async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    res.send(`<h1>Error: ${error}</h1>`);
    console.error('Authorization error:', error);
    return;
  }

  if (!code) {
    res.send('<h1>No authorization code received</h1>');
    return;
  }

  console.log('Exchanging code for token...');

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier
    });

    const { access_token, refresh_token, expires_in, scope } = tokenResponse.data;

    if (!refresh_token) {
      console.warn('⚠️  No refresh token received. You may need to revoke access and try again.');
      console.warn('Revoke at: https://myaccount.google.com/permissions');
    }

    // Save token data
    const tokenData = {
      access_token,
      refresh_token: refresh_token || 'NO_REFRESH_TOKEN_RECEIVED',
      expires_at: Date.now() + (expires_in * 1000),
      scope: scope || SCOPES
    };

    fs.writeFileSync(
      path.join(__dirname, 'youtube_token_data.json'),
      JSON.stringify(tokenData, null, 2)
    );

    console.log('\n✅ SUCCESS! Token received\n');
    console.log('Access Token:', access_token);
    console.log('Refresh Token:', refresh_token || 'NOT RECEIVED - See warning above');
    console.log('Expires in:', expires_in, 'seconds');
    console.log('Scopes:', scope);

    // Update .env file
    const envPath = path.join(__dirname, '.env');
    let envContent = '';

    try {
      envContent = fs.readFileSync(envPath, 'utf-8');
    } catch (err) {
      console.log('No .env file found, will create one');
    }

    // Update or add YouTube tokens
    const updates = {
      YOUTUBE_ACCESS_TOKEN: access_token,
      YOUTUBE_REFRESH_TOKEN: refresh_token || 'NO_REFRESH_TOKEN'
    };

    for (const [key, value] of Object.entries(updates)) {
      if (envContent.includes(`${key}=`)) {
        envContent = envContent.replace(
          new RegExp(`${key}=.*`),
          `${key}=${value}`
        );
      } else {
        envContent += `\n${key}=${value}`;
      }
    }

    fs.writeFileSync(envPath, envContent);
    console.log('\n✅ Saved to youtube_token_data.json');
    console.log('✅ Updated .env file\n');

    res.send(`
      <h1>✅ Success!</h1>
      <p>YouTube OAuth tokens received and saved!</p>
      <p>Access Token: ${access_token.substring(0, 20)}...</p>
      <p>Refresh Token: ${refresh_token ? refresh_token.substring(0, 20) + '...' : 'NOT RECEIVED'}</p>
      <p>You can close this window.</p>
      ${!refresh_token ? '<p><strong style="color: red;">⚠️ No refresh token received. You may need to revoke access and try again.</strong></p>' : ''}
    `);

    setTimeout(() => process.exit(0), 2000);

  } catch (error) {
    console.error('Failed to exchange code:', error.response?.data || error);
    res.send(`<h1>Error exchanging code</h1><pre>${JSON.stringify(error.response?.data || error.message, null, 2)}</pre>`);
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`OAuth callback server running on http://localhost:${PORT}`);
  console.log('Waiting for authorization...\n');
});

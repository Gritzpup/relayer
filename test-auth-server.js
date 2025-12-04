#!/usr/bin/env node

// Simple test to check if the auth server works standalone
const express = require('express');

console.log('🧪 Testing auth server standalone...');

const app = express();
const port = 3000;

const CLIENT_ID = 'tb2331wdrv9r3g7nmdlrj420c9harn';
const SCOPES = [
  'user:bot',
  'user:write:chat',
  'user:read:chat',
  'chat:edit',
  'chat:read',
  'moderator:manage:chat_messages'
].join(' ');

const REDIRECT_URI = 'http://localhost:3000/auth/callback';

// Step 1: Serve the initial auth page
app.get('/', (req, res) => {
  const authUrl = `https://id.twitch.tv/oauth2/authorize?` +
    `client_id=${CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(SCOPES)}`;
  
  res.send(`
    <html>
      <head>
        <title>Auth Server Test</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
          .btn { display: inline-block; padding: 12px 24px; background: #9146ff; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; }
          .btn:hover { background: #7c3aed; }
          .info { background: #e3f2fd; padding: 15px; border-radius: 4px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <h1>🧪 Auth Server Test</h1>
        <div class="info">
          <p><strong>Testing the auth server independently</strong></p>
        </div>
        <p><a class="btn" href="${authUrl}">🚀 Test Twitch Auth</a></p>
        <p><small>Auth URL: ${authUrl}</small></p>
      </body>
    </html>
  `);
});

// Step 2: Handle callback
app.get('/auth/callback', (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.send(`<h1>Error</h1><p>${error}</p>`);
  }
  
  if (!code) {
    return res.send('<h1>Error</h1><p>No authorization code received</p>');
  }
  
  res.send(`
    <h1>✅ Success!</h1>
    <p>Received authorization code: <code>${code}</code></p>
    <p>The auth server is working correctly!</p>
  `);
});

const server = app.listen(port, () => {
  console.log(`✅ Test auth server started on http://localhost:${port}`);
  console.log('🌐 Open your browser to: http://localhost:3000');
  console.log('Press Ctrl+C to stop');
});

server.on('error', (error) => {
  console.error('❌ Server error:', error.message);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use!`);
  }
});
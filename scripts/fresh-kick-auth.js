#!/usr/bin/env node

const crypto = require('crypto');
const { spawn } = require('child_process');

// Generate fresh PKCE
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

const CLIENT_ID = '01K6PE3530090FNWZQA4293N0H';
const REDIRECT_URI = 'http://localhost:3000/auth/kick/callback';

// Build auth URL with events:subscribe scope
const authUrl = `https://id.kick.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=user:read+channel:read+channel:write+chat:write+events:subscribe&code_challenge=${codeChallenge}&code_challenge_method=S256&state=fresh-auth-${Date.now()}`;

console.log('🔧 Fresh Kick Authorization');
console.log('===========================\n');
console.log('📋 Scopes: user:read channel:read channel:write chat:write events:subscribe\n');
console.log('🔑 Code Verifier (save this!):', codeVerifier);
console.log('\n🌐 Opening browser...\n');
console.log('Authorization URL:');
console.log(authUrl);
console.log('\n');

// Save code verifier to temp file
const fs = require('fs');
const path = require('path');
const tempFile = path.join(__dirname, '..', '.kick_code_verifier');
fs.writeFileSync(tempFile, codeVerifier);
console.log('💾 Code verifier saved to:', tempFile);
console.log('\nAfter authorizing, run:');
console.log('  node scripts/exchange-kick-token.js "<paste_redirect_url_here>"\n');

// Open browser
spawn('DISPLAY=:0', ['brave-browser', authUrl], {
  shell: true,
  stdio: 'ignore',
  detached: true
}).unref();

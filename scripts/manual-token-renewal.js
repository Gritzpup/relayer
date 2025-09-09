#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Load environment variables
require('dotenv').config();

const CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'tb2331wdrv9r3g7nmdlrj420c9harn';

console.log('\n🎮 Manual Twitch Token Renewal');
console.log('===============================\n');
console.log('Since the OAuth server approach isn\'t working, let\'s do this manually.\n');

console.log('📋 Using your existing bot "twitchrelayer":');
console.log('1. Go to: https://dev.twitch.tv/console/apps');
console.log('2. Click on your "twitchrelayer" app (or whatever your bot is called)');
console.log('3. Click "Generate New Secret" if needed');
console.log('4. Use the Client ID and Secret to get a new token');
console.log('');
console.log('OR use the simple token generator:');
console.log('1. Go to: https://twitchtokengenerator.com/');
console.log('2. Paste your Client ID: tb2331wdrv9r3g7nmdlrj420c9harn');
console.log('3. Select the SAME scopes your bot already has');
console.log('4. Generate token and paste it below\n');

// Open Twitch dev console
execAsync('DISPLAY=:0 /opt/brave.com/brave/brave-browser "https://dev.twitch.tv/console/apps" &')
  .then(() => {
    console.log('🌐 Opened Twitch Developer Console in Brave');
    console.log('   Your app should be listed there with Client ID: tb2331wdrv9r3g7nmdlrj420c9harn\n');
  })
  .catch(() => {
    console.log('⚠️  Could not open browser automatically');
    console.log('   Please manually go to: https://dev.twitch.tv/console/apps\n');
  });

// Simple input function
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function saveNewToken(accessToken) {
  try {
    // Read existing token data to preserve the scopes
    let existingScopes = [
      "chat:read",
      "chat:edit", 
      "user:read:chat",
      "user:write:chat",
      "user:bot",
      "moderator:manage:chat_messages"
    ];
    
    try {
      const tokenFilePath = path.join(__dirname, '..', 'twitch_token_data.json');
      const existingData = JSON.parse(await fs.readFile(tokenFilePath, 'utf-8'));
      if (existingData.scope && existingData.scope.length > 0) {
        existingScopes = existingData.scope;
        console.log('✅ Using existing scopes:', existingScopes.join(', '));
      }
    } catch (error) {
      console.log('⚠️  Using default scopes (could not read existing token file)');
    }

    // Create new token data (we'll use a long expiry since we don't know the exact one)
    const tokenData = {
      access_token: accessToken,
      refresh_token: "manual_token_no_refresh", // Placeholder
      expires_at: Date.now() + (60 * 24 * 60 * 60 * 1000), // 60 days from now
      scope: existingScopes
    };

    // Save to token file
    const tokenFilePath = path.join(__dirname, '..', 'twitch_token_data.json');
    await fs.writeFile(tokenFilePath, JSON.stringify(tokenData, null, 2));
    console.log('✅ Token data saved to twitch_token_data.json');

    // Update .env file
    const envPath = path.join(__dirname, '..', '.env');
    let envContent = await fs.readFile(envPath, 'utf-8');
    
    envContent = envContent.replace(
      /TWITCH_OAUTH=.*/,
      `TWITCH_OAUTH=oauth:${accessToken}`
    );
    
    await fs.writeFile(envPath, envContent);
    console.log('✅ Updated .env file with new token');

    // Restart relayer
    console.log('🔄 Restarting chat relayer...');
    await execAsync('tilt trigger relayer');
    console.log('✅ Relayer restart triggered');

    console.log('\n🎉 Token renewal completed successfully!');
    console.log('   Your new token should last ~60 days.');
    console.log('   The chat relayer should be working again shortly.\n');

  } catch (error) {
    console.error('❌ Error saving token:', error);
    throw error;
  }
}

async function main() {
  try {
    console.log('⏳ Waiting for you to get the token from the website...\n');
    
    const token = await askQuestion('🔑 Paste your ACCESS TOKEN here: ');
    
    if (!token || token.length < 10) {
      console.log('❌ Invalid token. Please make sure you copied the ACCESS TOKEN correctly.');
      process.exit(1);
    }

    console.log('\n📝 Saving new token and restarting relayer...\n');
    await saveNewToken(token);
    
  } catch (error) {
    console.error('❌ Error during token renewal:', error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
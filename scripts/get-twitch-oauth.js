#!/usr/bin/env node

/**
 * Script to get a Twitch OAuth token with the required scopes for the relay bot
 * Including the moderator:manage:chat_messages scope for message deletion
 */

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;

if (!TWITCH_CLIENT_ID) {
  console.error('Error: TWITCH_CLIENT_ID environment variable is required');
  console.error('Set it in your .env file');
  process.exit(1);
}

const REQUIRED_SCOPES = [
  'user:bot',
  'user:write:chat',
  'user:read:chat',
  'chat:edit',
  'chat:read',
  'moderator:manage:chat_messages' // Required for deleting messages
];

const authUrl = `https://id.twitch.tv/oauth2/authorize` +
  `?client_id=${TWITCH_CLIENT_ID}` +
  `&redirect_uri=http://localhost:3000/auth/callback` +
  `&response_type=token` +
  `&scope=${REQUIRED_SCOPES.join('+')}`;

console.log('=================================================');
console.log('TWITCH OAUTH TOKEN GENERATOR');
console.log('=================================================');
console.log('');
console.log('This bot needs the following Twitch scopes:');
REQUIRED_SCOPES.forEach(scope => console.log(`  - ${scope}`));
console.log('');
console.log('IMPORTANT: The moderator:manage:chat_messages scope is required for message deletion!');
console.log('');
console.log('To get a new OAuth token with all required scopes:');
console.log('');
console.log('1. Open this URL in your browser:');
console.log('');
console.log(authUrl);
console.log('');
console.log('2. Log in with your bot account (twitchrelayer)');
console.log('');
console.log('3. Authorize the application');
console.log('');
console.log('4. You\'ll be redirected to http://localhost:3000/auth/callback');
console.log('   (The page won\'t load, that\'s OK)');
console.log('');
console.log('5. Copy the access_token from the URL:');
console.log('   Example: http://localhost:3000/auth/callback#access_token=YOUR_TOKEN_HERE&...');
console.log('');
console.log('6. Update your .env file:');
console.log('   TWITCH_OAUTH=oauth:YOUR_TOKEN_HERE');
console.log('');
console.log('7. Make sure your bot (twitchrelayer) is a moderator in the channel!');
console.log('   Type in Twitch chat: /mod twitchrelayer');
console.log('');
console.log('=================================================');
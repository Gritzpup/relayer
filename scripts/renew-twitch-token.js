#!/usr/bin/env node

const express = require('express');
const open = require('open');
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');

// Load environment variables
require('dotenv').config();

const CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'tb2331wdrv9r3g7nmdlrj420c9harn';
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || 'eojbpr0ro3i1718mouqqzq3qpzokmo';
const REDIRECT_URI = 'http://localhost:3000/auth/twitch/callback';
const PORT = 3000;

// Required scopes for the chat relayer
const SCOPES = [
  'chat:read',
  'chat:edit', 
  'user:read:chat',
  'user:write:chat',
  'user:bot',
  'moderator:manage:chat_messages'
];

class TwitchTokenRenewer {
  constructor() {
    this.app = express();
    this.server = null;
    this.tokenData = null;
  }

  async start() {
    console.log('\n🎮 Twitch Token Renewal Tool');
    console.log('============================\n');
    console.log('This will generate a fresh Twitch token that lasts 30+ days.');
    console.log('The old token will be automatically replaced.\n');

    this.setupRoutes();
    await this.startServer();
    await this.openAuthorizationURL();
  }

  setupRoutes() {
    // Serve the callback page
    this.app.get('/auth/twitch/callback', async (req, res) => {
      try {
        const { code, error, error_description } = req.query;

        if (error) {
          console.error(`❌ Authorization error: ${error} - ${error_description}`);
          res.send(`
            <html>
              <head><title>Authorization Failed</title></head>
              <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h2 style="color: red;">❌ Authorization Failed</h2>
                <p>Error: ${error}</p>
                <p>Description: ${error_description}</p>
                <p>Please close this window and try again.</p>
              </body>
            </html>
          `);
          return;
        }

        if (!code) {
          res.send(`
            <html>
              <head><title>Missing Code</title></head>
              <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h2 style="color: red;">❌ Missing Authorization Code</h2>
                <p>No authorization code received from Twitch.</p>
                <p>Please close this window and try again.</p>
              </body>
            </html>
          `);
          return;
        }

        console.log('✅ Authorization code received, exchanging for token...');

        // Exchange code for token
        const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', {
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI
        });

        const { access_token, refresh_token, expires_in, scope } = tokenResponse.data;

        // Validate token
        const validationResponse = await axios.get('https://id.twitch.tv/oauth2/validate', {
          headers: {
            'Authorization': `Bearer ${access_token}`
          }
        });

        const { login, user_id } = validationResponse.data;

        this.tokenData = {
          access_token,
          refresh_token,
          expires_at: Date.now() + (expires_in * 1000),
          scope: scope,
          user_id,
          login
        };

        console.log(`✅ Token obtained for user: ${login} (ID: ${user_id})`);
        console.log(`✅ Token expires in: ${Math.floor(expires_in / (24 * 60 * 60))} days`);
        console.log(`✅ Scopes: ${scope.join(', ')}`);

        // Save token data
        await this.saveTokenData();
        await this.updateEnvFile();

        res.send(`
          <html>
            <head><title>Success!</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px; background: #f0f8ff;">
              <h2 style="color: green;">✅ Token Renewal Successful!</h2>
              <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 600px;">
                <p><strong>User:</strong> ${login} (ID: ${user_id})</p>
                <p><strong>Expires in:</strong> ${Math.floor(expires_in / (24 * 60 * 60))} days</p>
                <p><strong>Scopes:</strong> ${scope.join(', ')}</p>
              </div>
              <p style="color: green; font-weight: bold;">Your chat relayer will automatically restart with the new token!</p>
              <p>You can close this window now.</p>
              <script>
                setTimeout(() => {
                  window.close();
                }, 10000);
              </script>
            </body>
          </html>
        `);

        // Restart the relayer service
        setTimeout(async () => {
          await this.restartRelayer();
          this.stop();
        }, 2000);

      } catch (error) {
        console.error('❌ Error during token exchange:', error.response?.data || error.message);
        res.send(`
          <html>
            <head><title>Token Exchange Failed</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
              <h2 style="color: red;">❌ Token Exchange Failed</h2>
              <p>Error: ${error.message}</p>
              <p>Please close this window and try again.</p>
            </body>
          </html>
        `);
      }
    });

    // Health check endpoint
    this.app.get('/', (req, res) => {
      res.send(`
        <html>
          <head><title>Twitch Token Renewal</title></head>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h2>🎮 Twitch Token Renewal Server</h2>
            <p>Server is running and waiting for authorization callback.</p>
            <p>Please complete the authorization in your browser.</p>
          </body>
        </html>
      `);
    });
  }

  async startServer() {
    return new Promise((resolve) => {
      this.server = this.app.listen(PORT, () => {
        console.log(`🚀 OAuth server started on http://localhost:${PORT}`);
        resolve();
      });
    });
  }

  async openAuthorizationURL() {
    const authURL = `https://id.twitch.tv/oauth2/authorize?` +
      `client_id=${CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(SCOPES.join(' '))}`;

    console.log('🌐 Opening authorization URL in browser...');
    console.log('   If browser doesn\'t open automatically, copy this URL:');
    console.log(`   ${authURL}\n`);

    try {
      await open(authURL);
      console.log('✅ Browser opened successfully');
    } catch (error) {
      console.log('⚠️  Could not open browser automatically');
      console.log('   Please copy and paste the URL above into your browser');
    }

    console.log('\n⏳ Waiting for authorization...');
    console.log('   1. Authorize the application in your browser');
    console.log('   2. You will be redirected back automatically');
    console.log('   3. The new token will be saved and relayer restarted\n');
  }

  async saveTokenData() {
    try {
      const tokenFilePath = path.join(__dirname, '..', 'twitch_token_data.json');
      await fs.writeFile(tokenFilePath, JSON.stringify(this.tokenData, null, 2));
      console.log('✅ Token data saved to twitch_token_data.json');
    } catch (error) {
      console.error('❌ Failed to save token data:', error);
      throw error;
    }
  }

  async updateEnvFile() {
    try {
      const envPath = path.join(__dirname, '..', '.env');
      let envContent = await fs.readFile(envPath, 'utf-8');

      // Update TWITCH_OAUTH line
      envContent = envContent.replace(
        /TWITCH_OAUTH=.*/,
        `TWITCH_OAUTH=oauth:${this.tokenData.access_token}`
      );

      await fs.writeFile(envPath, envContent);
      console.log('✅ Updated .env file with new token');
    } catch (error) {
      console.error('❌ Failed to update .env file:', error);
      throw error;
    }
  }

  async restartRelayer() {
    try {
      console.log('🔄 Restarting chat relayer with new token...');
      
      // Use tilt to restart the relayer
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      await execAsync('tilt trigger relayer');
      console.log('✅ Relayer restart triggered');
    } catch (error) {
      console.error('❌ Failed to restart relayer:', error);
      console.log('⚠️  Please manually restart the relayer service');
    }
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log('\n✅ Token renewal completed successfully!');
      console.log('🎉 Your Twitch token is now fresh and will last 30+ days.');
      console.log('   The chat relayer should be working again shortly.\n');
    }
    process.exit(0);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n⚠️  Token renewal cancelled by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Token renewal terminated');
  process.exit(0);
});

// Start the renewal process
const renewer = new TwitchTokenRenewer();
renewer.start().catch(error => {
  console.error('❌ Fatal error during token renewal:', error);
  process.exit(1);
});
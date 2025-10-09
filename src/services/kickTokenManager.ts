import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { config } from '../config';

interface KickTokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string[];
}

export class KickTokenManager {
  private tokenFile: string;
  private clientId: string;
  private clientSecret: string;
  private tokenData: KickTokenData | null = null;
  private onTokenRefreshCallback?: (accessToken: string) => void;

  constructor() {
    this.tokenFile = path.join(process.cwd(), 'kick_token_data.json');
    this.clientId = config.kick?.clientId || '01K6PE3530090FNWZQA4293N0H';
    this.clientSecret = config.kick?.clientSecret || 'a67f7a235a3b481ba02bd22b1f3993a7f0b3ed2b828c109faf29f7e185fd2a85';
  }

  async initialize(): Promise<void> {
    try {
      // Try to load existing token data
      const data = await fs.readFile(this.tokenFile, 'utf-8');
      this.tokenData = JSON.parse(data);
      logger.info('Loaded existing Kick token data');
      
      // Validate token with Kick API
      const isValid = await this.validateTokenWithKick();
      if (!isValid) {
        logger.warn('Kick token validation failed, attempting to refresh...');
        await this.refreshToken();
        
        // If refresh also fails, prompt for manual refresh
        if (!await this.validateTokenWithKick()) {
          await this.promptForManualRefresh();
          return;
        }
      }
      
      // Check if token is expired or will expire soon
      if (this.isTokenExpired()) {
        logger.info('Kick token is expired, refreshing...');
        await this.refreshToken();
        
        // If refresh fails, prompt for manual refresh
        if (!await this.validateTokenWithKick()) {
          await this.promptForManualRefresh();
          return;
        }
      }
      
      logger.info('✅ Kick token validation successful - no refresh needed');
    } catch (error) {
      logger.warn('No existing Kick token data found, prompting for authorization');
      await this.promptForManualRefresh();
    }
  }

  private isTokenExpired(): boolean {
    if (!this.tokenData) return true;
    // Check if token expires in next 5 minutes
    return Date.now() >= (this.tokenData.expires_at - 5 * 60 * 1000);
  }

  async getAccessToken(): Promise<string> {
    // Check if we need to refresh
    if (this.isTokenExpired()) {
      await this.refreshToken();
    }

    if (!this.tokenData) {
      throw new Error('No valid Kick token available');
    }

    return this.tokenData.access_token;
  }

  private async refreshToken(refreshToken?: string): Promise<void> {
    try {
      const tokenToUse = refreshToken || this.tokenData?.refresh_token;
      if (!tokenToUse) {
        throw new Error('No refresh token available');
      }

      logger.info('Refreshing Kick token...');
      
      const response = await axios.post('https://id.kick.com/oauth/token', 
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenToUse,
          client_id: this.clientId,
          client_secret: this.clientSecret
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );

      const { access_token, refresh_token: new_refresh_token, scope, expires_in } = response.data;

      this.tokenData = {
        access_token,
        refresh_token: new_refresh_token || tokenToUse,
        expires_at: Date.now() + (expires_in * 1000),
        scope: scope || []
      };

      // Save token data to file
      await fs.writeFile(this.tokenFile, JSON.stringify(this.tokenData, null, 2));
      
      // Update .env file with new token
      await this.updateEnvFile(access_token);
      
      // Notify callback if set
      if (this.onTokenRefreshCallback) {
        this.onTokenRefreshCallback(access_token);
      }
      
      logger.info(`Kick token refreshed successfully, expires in ${expires_in} seconds`);
    } catch (error) {
      logger.error('Failed to refresh Kick token:', error);
      logger.warn('Continuing without Kick message sending until token is renewed');
    }
  }

  private async updateEnvFile(accessToken: string): Promise<void> {
    try {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = await fs.readFile(envPath, 'utf-8');
      
      // Update KICK_TOKEN line or add it if it doesn't exist
      if (envContent.includes('KICK_TOKEN=')) {
        envContent = envContent.replace(
          /KICK_TOKEN=.*/,
          `KICK_TOKEN=${accessToken}`
        );
      } else {
        envContent += `\nKICK_TOKEN=${accessToken}`;
      }
      
      await fs.writeFile(envPath, envContent);
      logger.info('Updated .env file with new Kick token');
    } catch (error) {
      logger.error('Failed to update .env file:', error);
    }
  }

  // Set callback for when token is refreshed
  onTokenRefresh(callback: (accessToken: string) => void): void {
    this.onTokenRefreshCallback = callback;
  }

  // Validate token with Kick API
  private async validateTokenWithKick(): Promise<boolean> {
    if (!this.tokenData?.access_token) return false;
    
    try {
      // Try to get user info to validate token
      const response = await axios.get('https://api.kick.com/api/me', {
        headers: {
          'Authorization': `Bearer ${this.tokenData.access_token}`,
        },
        timeout: 10000
      });
      
      const { id, username } = response.data;
      logger.info(`Kick token validated for user: ${username} (ID: ${id})`);
      
      return true;
    } catch (error) {
      if (error.response?.status === 401) {
        logger.error('❌ Kick token validation failed: Token is invalid or expired');
      } else {
        logger.error('❌ Kick token validation failed:', error.message);
      }
      return false;
    }
  }

  // Prompt user for manual refresh with GUI popup
  private async promptForManualRefresh(): Promise<void> {
    logger.error('🔴 KICK TOKEN AUTHORIZATION REQUIRED 🔴');
    logger.error('Showing GUI popup for Kick authorization...');
    console.log('🔴 KICK TOKEN AUTHORIZATION REQUIRED - SHOWING GUI POPUP');
    
    // Show GUI popup that handles everything
    await this.showTokenRefreshGUI();
  }

  // Show GUI popup for token authorization with embedded Kick login
  private async showTokenRefreshGUI(): Promise<void> {
    try {
      console.log('🚀 Starting Kick GUI authorization flow...');
      const { exec, spawn } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      // Generate PKCE challenge for Kick OAuth 2.1
      const crypto = require('crypto');
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      
      const authUrl = `https://id.kick.com/oauth/authorize?client_id=${this.clientId}&redirect_uri=http://localhost:3000/auth/kick/callback&response_type=code&scope=user:read+channel:read+channel:write+chat:write+events:subscribe&code_challenge=${codeChallenge}&code_challenge_method=S256&state=kick-auth`;
      
      console.log('📡 Starting callback server...');
      // Start the callback server first
      await this.startSimpleCallbackServer(codeVerifier);
      console.log('✅ Callback server started');
      
      console.log('💬 Showing zenity dialog...');
      // Show dialog with Kick login button
      const result = await execAsync(`
        DISPLAY=:0 zenity --question --title="🔄 Kick Token Authorization" \\
        --text="Your Kick bot needs authorization to send messages!\\n\\n• Click YES to open Kick login page\\n• Log in with your Kick account\\n• Authorize the application\\n• Token will be automatically saved\\n\\nClick YES to continue or NO to cancel." \\
        --ok-label="🚀 Open Kick Login" --cancel-label="❌ Cancel" \\
        --width=500 --height=200
      `);
      
      if (result.stdout.includes('') || !result.stderr) {
        // User clicked YES, open Kick auth
        logger.info('🌐 Opening Kick auth...');
        
        spawn('chromium', [authUrl], {
          stdio: 'ignore',
          detached: true,
          env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }
        }).unref();
        
        // Show waiting dialog
        execAsync(`
          DISPLAY=:0 zenity --info --title="Waiting for Authorization" \\
          --text="Complete the authorization in your browser.\\n\\nThis dialog will close automatically when done." \\
          --timeout=120
        `).catch(() => {}); // Ignore timeout/close
        
      } else {
        logger.info('❌ Kick token authorization cancelled by user');
      }
      
    } catch (error) {
      logger.error('❌ GUI Kick authorization failed:', error);
    }
  }

  // Simple callback server for GUI auth
  private async startSimpleCallbackServer(codeVerifier: string): Promise<void> {
    const express = require('express');
    const app = express();
    const port = 3000;
    
    app.get('/auth/kick/callback', async (req, res) => {
      const { code, error } = req.query;
      
      if (error || !code) {
        res.send('<h1>❌ Authorization failed</h1><p>You can close this window.</p>');
        return;
      }
      
      try {
        // Exchange code for token using PKCE
        const response = await axios.post('https://id.kick.com/oauth/token', 
          new URLSearchParams({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            code: code as string,
            grant_type: 'authorization_code',
            redirect_uri: 'http://localhost:3000/auth/kick/callback',
            code_verifier: codeVerifier
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
        
        const { access_token, refresh_token, scope, expires_in } = response.data;
        
        // Update token data
        this.tokenData = {
          access_token,
          refresh_token: refresh_token,
          expires_at: Date.now() + (expires_in * 1000),
          scope: scope || []
        };
        
        // Save token data
        await fs.writeFile(this.tokenFile, JSON.stringify(this.tokenData, null, 2));
        await this.updateEnvFile(access_token);
        
        res.send('<h1>✅ Success!</h1><p>Kick token updated successfully!<br>You can close this window.<br>Relayer will restart automatically.</p>');
        
        logger.info('🎉 Kick token updated via GUI auth!');
        
        // Show success notification
        const { exec } = require('child_process');
        exec('DISPLAY=:0 zenity --info --title="Success" --text="Kick token updated successfully!\\nRelayer restarting..." --timeout=2').catch(() => {});
        
        // Restart
        setTimeout(() => process.exit(0), 2000);
        
      } catch (error) {
        logger.error('❌ Failed to exchange Kick code:', error);
        res.send('<h1>❌ Error</h1><p>Failed to update Kick token. Check logs.</p>');
      }
    });
    
    const server = app.listen(port, () => {
      logger.info(`🔗 Kick auth server ready on localhost:${port}`);
    });
    
    // Auto-close after 5 minutes
    setTimeout(() => server.close(), 5 * 60 * 1000);
  }
}

// Export singleton instance
export const kickTokenManager = new KickTokenManager();
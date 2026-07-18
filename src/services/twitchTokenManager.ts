import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { TokenNotificationManager } from '../utils/tokenNotification';

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string[];
}

export class TwitchTokenManager {
  private tokenFile: string;
  private clientId: string;
  private clientSecret: string;
  private tokenData: TokenData | null = null;
  private onTokenRefreshCallback?: (accessToken: string) => void;
  private notificationManager: TokenNotificationManager;

  constructor() {
    this.tokenFile = path.join(process.cwd(), 'twitch_token_data.json');
    this.clientId = process.env.TWITCH_CLIENT_ID || 'tb2331wdrv9r3g7nmdlrj420c9harn';
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET || 'eojbpr0ro3i1718mouqqzq3qpzokmo';
    this.notificationManager = TokenNotificationManager.getInstance();
  }

  async initialize(): Promise<void> {
    try {
      // Try to load existing token data
      const data = await fs.readFile(this.tokenFile, 'utf-8');
      this.tokenData = JSON.parse(data);
      logger.info('Loaded existing Twitch token data');
      
      // Validate token with Twitch API
      const isValid = await this.validateTokenWithTwitch();
      if (!isValid) {
        logger.warn('Token validation failed, attempting to refresh...');
        await this.refreshToken();
        
        // If refresh also fails, prompt for manual refresh
        if (!await this.validateTokenWithTwitch()) {
          await this.promptForManualRefresh();
          return;
        }
      }
      
      // Check if token is expired or will expire soon
      if (this.isTokenExpired()) {
        logger.info('Token is expired, refreshing...');
        await this.refreshToken();
        
        // If refresh fails, prompt for manual refresh
        if (!await this.validateTokenWithTwitch()) {
          await this.promptForManualRefresh();
          return;
        }
      }
      
      logger.info('✅ Twitch token validation successful - no refresh needed');
    } catch (error) {
      logger.warn('No existing token data found, using .env token');
      // Initialize with current .env token and known refresh token
      const refreshToken = '22sur89fvfbpqlb6abk5h7ytbh1zao848zw96zkzhhbflobnen';
      if (refreshToken) {
        await this.refreshToken(refreshToken);
        
        // Validate after refresh
        if (!await this.validateTokenWithTwitch()) {
          await this.promptForManualRefresh();
          return;
        }
      } else {
        await this.promptForManualRefresh();
      }
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
      // Fallback to .env token
      const envToken = process.env.TWITCH_OAUTH;
      if (envToken) {
        return envToken.replace('oauth:', '');
      }
      throw new Error('No valid Twitch token available');
    }

    return this.tokenData.access_token;
  }

  private async refreshToken(refreshToken?: string): Promise<void> {
    try {
      const tokenToUse = refreshToken || this.tokenData?.refresh_token;
      if (!tokenToUse) {
        throw new Error('No refresh token available');
      }

      logger.info('Refreshing Twitch token...');
      
      const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
          grant_type: 'refresh_token',
          refresh_token: tokenToUse,
          client_id: this.clientId,
          client_secret: this.clientSecret
        },
        timeout: 10000  // 10 second timeout
      });

      const { access_token, refresh_token: new_refresh_token, scope, expires_in } = response.data;

      this.tokenData = {
        access_token,
        refresh_token: new_refresh_token,
        expires_at: Date.now() + (expires_in * 1000),
        scope: scope
      };

      // Save token data to file
      await fs.writeFile(this.tokenFile, JSON.stringify(this.tokenData, null, 2));
      
      // Update .env file with new token
      await this.updateEnvFile(access_token);
      
      // Notify callback if set
      if (this.onTokenRefreshCallback) {
        this.onTokenRefreshCallback(access_token);
      }
      
      logger.info(`Token refreshed successfully, expires in ${expires_in} seconds`);
    } catch (error) {
      logger.error('Failed to refresh token:', error);
      
      // If refresh fails and token is expired, just log it
      if (this.isTokenExpired()) {
        logger.info('Token expired and refresh failed. Please renew token manually.');
      }
      
      // Don't throw error, let relayer continue running without Twitch
      logger.warn('Continuing without Twitch connection until token is renewed');
    }
  }

  private async updateEnvFile(accessToken: string): Promise<void> {
    try {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = await fs.readFile(envPath, 'utf-8');
      
      // Update TWITCH_OAUTH line
      envContent = envContent.replace(
        /TWITCH_OAUTH=.*/,
        `TWITCH_OAUTH=oauth:${accessToken}`
      );
      
      await fs.writeFile(envPath, envContent);
      logger.info('Updated .env file with new token');
    } catch (error) {
      logger.error('Failed to update .env file:', error);
    }
  }

  // Set callback for when token is refreshed
  onTokenRefresh(callback: (accessToken: string) => void): void {
    this.onTokenRefreshCallback = callback;
  }

  // Schedule automatic token refresh
  startAutoRefresh(): void {
    logger.info('Starting automatic Twitch token refresh (every 3 hours)');
    
    // Disable notification manager - we handle GUI ourselves now
    // this.notificationManager.startMonitoring(this.tokenFile);
    
    // Immediately refresh if expired
    if (this.isTokenExpired()) {
      this.refreshToken().catch(error => {
        logger.error('Initial token refresh failed:', error);
      });
    }
    
    // Refresh every 3 hours regardless of expiry
    setInterval(async () => {
      try {
        logger.info('Performing scheduled 3-hour token refresh');
        await this.refreshToken();
      } catch (error) {
        logger.error('Scheduled token refresh failed:', error);
      }
    }, 3 * 60 * 60 * 1000); // 3 hours in milliseconds
    
    // Also check every 30 minutes in case token expires early
    setInterval(async () => {
      if (this.isTokenExpired()) {
        try {
          logger.info('Token expired, refreshing now');
          await this.refreshToken();
        } catch (error) {
          logger.error('Emergency token refresh failed:', error);
        }
      }
    }, 30 * 60 * 1000); // 30 minutes
  }

  // Stop monitoring (cleanup)
  stopMonitoring(): void {
    this.notificationManager.stopMonitoring();
  }

  // Manual test method to trigger auth flow
  async testAuthFlow(): Promise<void> {
    logger.info('🧪 Testing auth flow manually...');
    await this.promptForManualRefresh();
  }

  // Validate token with Twitch API
  private async validateTokenWithTwitch(): Promise<boolean> {
    if (!this.tokenData?.access_token) return false;
    
    try {
      const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: {
          'Authorization': `Bearer ${this.tokenData.access_token}`,
        },
        timeout: 10000
      });
      
      const { user_id, login, scopes } = response.data;
      logger.info(`Token validated for user: ${login} (ID: ${user_id})`);
      
      // Check if we have required scopes
      const requiredScopes = ['user:write:chat', 'user:bot', 'user:read:chat', 'chat:edit', 'chat:read'];
      const moderatorScopes = ['moderator:manage:chat_messages'];
      
      const hasRequiredScopes = requiredScopes.some(scope => scopes.includes(scope));
      const hasModeratorScopes = moderatorScopes.some(scope => scopes.includes(scope));
      
      if (hasRequiredScopes) {
        logger.info('✅ Token has required chat scopes');
      } else {
        logger.warn(`⚠️ Missing required scopes. Have: ${scopes.join(', ')}`);
        logger.warn('Token may not work properly for chat operations');
      }
      
      if (hasModeratorScopes) {
        logger.info('✅ Token has moderator scopes for message deletion');
      } else {
        logger.warn('⚠️ Missing moderator scopes - message deletion will not work');
      }
      
      return true;
    } catch (error: unknown) {
      const axiosError = error as { response?: { status?: number }; message?: string };
      if (axiosError.response?.status === 401) {
        logger.error('❌ Token validation failed: Token is invalid or expired');
      } else {
        logger.error('❌ Token validation failed:', axiosError.message);
      }
      return false;
    }
  }

  // Prompt user for manual refresh with GUI popup
  private async promptForManualRefresh(): Promise<void> {
    logger.error('🔴 TWITCH TOKEN REFRESH REQUIRED 🔴');
    logger.error('Showing GUI popup for token refresh...');
    console.log('🔴 TWITCH TOKEN REFRESH REQUIRED - SHOWING GUI POPUP');
    
    // Show GUI popup that handles everything
    await this.showTokenRefreshGUI();
  }

  // Show GUI popup for token refresh with embedded Twitch login
  private async showTokenRefreshGUI(): Promise<void> {
    try {
      console.log('🚀 Starting GUI token refresh flow...');
      const { exec, spawn } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${this.clientId}&redirect_uri=http://localhost:3000/auth/callback&response_type=code&scope=user:bot+user:write:chat+user:read:chat+chat:edit+chat:read+moderator:manage:chat_messages`;
      
      console.log('📡 Starting callback server...');
      // Start the callback server first
      await this.startSimpleCallbackServer();
      console.log('✅ Callback server started');
      
      console.log('💬 Showing zenity dialog...');
      // Show dialog with Twitch login button
      const result = await execAsync(`
        DISPLAY=:0 zenity --question --title="🔄 Twitch Token Renewal" \\
        --text="Your Twitch token has expired and needs renewal!\\n\\n• Click YES to open Twitch login page\\n• Log in with your twitchrelayer account\\n• Authorize the application\\n• Token will be automatically saved\\n\\nClick YES to continue or NO to cancel." \\
        --ok-label="🚀 Open Twitch Login" --cancel-label="❌ Cancel" \\
        --width=500 --height=200
      `);
      
      if (result.stdout.includes('') || !result.stderr) {
        // User clicked YES, open Twitch auth
        logger.info('🌐 Opening Twitch auth...');
        
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
        logger.info('❌ Token refresh cancelled by user');
      }
      
    } catch (error) {
      logger.error('❌ GUI token refresh failed:', error);
      logger.error('Please manually run: node scripts/refresh-twitch-token.js');
    }
  }

  // Simple callback server for GUI auth
  private async startSimpleCallbackServer(): Promise<void> {
    const express = require('express');
    const app = express();
    const port = 3000;
    
    app.get('/auth/callback', async      (req: any, res: any) => {
      const { code, error } = req.query;
      
      if (error || !code) {
        res.send('<h1>❌ Authorization failed</h1><p>You can close this window.</p>');
        return;
      }
      
      try {
        // Exchange code for token
        const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
          params: {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: 'http://localhost:3000/auth/callback'
          }
        });
        
        const { access_token, refresh_token, scope, expires_in } = response.data;
        
        // Update token data
        this.tokenData = {
          access_token,
          refresh_token: refresh_token || '22sur89fvfbpqlb6abk5h7ytbh1zao848zw96zkzhhbflobnen',
          expires_at: Date.now() + (expires_in * 1000),
          scope: scope || []
        };
        
        // Save token data
        await fs.writeFile(this.tokenFile, JSON.stringify(this.tokenData, null, 2));
        await this.updateEnvFile(access_token);
        
        res.send('<h1>✅ Success!</h1><p>Token updated successfully!<br>You can close this window.<br>Relayer will restart automatically.</p>');
        
        logger.info('🎉 Token updated via GUI auth!');
        
        // Show success notification
        const { exec } = require('child_process');
        exec('DISPLAY=:0 zenity --info --title="Success" --text="Token updated successfully!\\nRelayer restarting..." --timeout=2').catch(() => {});
        
        // Restart
        setTimeout(() => process.exit(0), 2000);
        
      } catch (error) {
        logger.error('❌ Failed to exchange code:', error);
        res.send('<h1>❌ Error</h1><p>Failed to update token. Check logs.</p>');
      }
    });
    
    const server = app.listen(port, () => {
      logger.info(`🔗 Auth server ready on localhost:${port}`);
    });
    
    // Auto-close after 5 minutes
    setTimeout(() => server.close(), 5 * 60 * 1000);
  }

}

// Export singleton instance
export const twitchTokenManager = new TwitchTokenManager();
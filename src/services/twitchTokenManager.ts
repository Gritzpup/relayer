import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';

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

  constructor() {
    this.tokenFile = path.join(process.cwd(), 'twitch_token_data.json');
    this.clientId = process.env.TWITCH_CLIENT_ID || 'tb2331wdrv9r3g7nmdlrj420c9harn';
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET || 'eojbpr0ro3i1718mouqqzq3qpzokmo';
  }

  async initialize(): Promise<void> {
    try {
      // Try to load existing token data
      const data = await fs.readFile(this.tokenFile, 'utf-8');
      this.tokenData = JSON.parse(data);
      logger.info('Loaded existing Twitch token data');
      
      // Check if token is expired
      if (this.isTokenExpired()) {
        logger.info('Token is expired, refreshing...');
        await this.refreshToken();
      }
    } catch (error) {
      logger.warn('No existing token data found, using .env token');
      // Initialize with current .env token and known refresh token
      const refreshToken = '22sur89fvfbpqlb6abk5h7ytbh1zao848zw96zkzhhbflobnen';
      if (refreshToken) {
        await this.refreshToken(refreshToken);
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
        }
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
      throw error;
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
}

// Export singleton instance
export const twitchTokenManager = new TwitchTokenManager();
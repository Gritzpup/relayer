import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';

interface YouTubeTokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

export class YouTubeTokenManager {
  private tokenFile: string;
  private clientId: string;
  private clientSecret: string;
  private tokenData: YouTubeTokenData | null = null;
  private onTokenRefreshCallback?: (accessToken: string) => void;

  constructor() {
    this.tokenFile = path.join(process.cwd(), 'youtube_token_data.json');
    this.clientId = process.env.YOUTUBE_CLIENT_ID || '';
    this.clientSecret = process.env.YOUTUBE_CLIENT_SECRET || '';
  }

  async initialize(): Promise<void> {
    try {
      // Try to load existing token data
      const data = await fs.readFile(this.tokenFile, 'utf-8');
      this.tokenData = JSON.parse(data);
      logger.info('Loaded existing YouTube token data');

      // Check if token is expired or will expire soon
      if (this.isTokenExpired()) {
        logger.info('YouTube token is expired, refreshing...');
        await this.refreshToken();
      }

      logger.info('✅ YouTube token initialized successfully');
    } catch (error) {
      logger.warn('No existing YouTube token data found');
      // Use refresh token from .env if available
      const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
      if (refreshToken) {
        await this.refreshToken(refreshToken);
      } else {
        logger.warn('No YouTube refresh token available - YouTube integration disabled');
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
      const envToken = process.env.YOUTUBE_ACCESS_TOKEN;
      if (envToken) {
        return envToken;
      }
      throw new Error('No valid YouTube token available');
    }

    return this.tokenData.access_token;
  }

  private async refreshToken(refreshToken?: string): Promise<void> {
    try {
      const tokenToUse = refreshToken || this.tokenData?.refresh_token;
      if (!tokenToUse) {
        throw new Error('No YouTube refresh token available');
      }

      if (!this.clientId || !this.clientSecret) {
        throw new Error('YouTube client ID and secret not configured');
      }

      logger.info('Refreshing YouTube token...');

      const response = await axios.post('https://oauth2.googleapis.com/token', null, {
        params: {
          grant_type: 'refresh_token',
          refresh_token: tokenToUse,
          client_id: this.clientId,
          client_secret: this.clientSecret
        },
        timeout: 10000
      });

      const { access_token, scope, expires_in } = response.data;
      const refresh_token = response.data.refresh_token || tokenToUse;

      this.tokenData = {
        access_token,
        refresh_token,
        expires_at: Date.now() + (expires_in * 1000),
        scope
      };

      // Save token data to file
      await fs.writeFile(this.tokenFile, JSON.stringify(this.tokenData, null, 2));

      // Update .env file with new token
      await this.updateEnvFile(access_token);

      // Notify callback if set
      if (this.onTokenRefreshCallback) {
        this.onTokenRefreshCallback(access_token);
      }

      logger.info(`YouTube token refreshed successfully, expires in ${expires_in} seconds`);
    } catch (error) {
      logger.error('Failed to refresh YouTube token:', error);
      throw error;
    }
  }

  private async updateEnvFile(accessToken: string): Promise<void> {
    try {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = await fs.readFile(envPath, 'utf-8');

      // Update YOUTUBE_ACCESS_TOKEN line
      if (envContent.includes('YOUTUBE_ACCESS_TOKEN=')) {
        envContent = envContent.replace(
          /YOUTUBE_ACCESS_TOKEN=.*/,
          `YOUTUBE_ACCESS_TOKEN=${accessToken}`
        );
      } else {
        envContent += `\nYOUTUBE_ACCESS_TOKEN=${accessToken}\n`;
      }

      await fs.writeFile(envPath, envContent);
      logger.info('Updated .env file with new YouTube token');
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
    logger.info('Starting automatic YouTube token refresh');

    // Refresh every 30 minutes to keep token fresh (YouTube tokens expire in 1 hour)
    setInterval(async () => {
      if (this.isTokenExpired()) {
        try {
          logger.info('YouTube token expired, refreshing now');
          await this.refreshToken();
        } catch (error) {
          logger.error('Scheduled YouTube token refresh failed:', error);
        }
      }
    }, 30 * 60 * 1000); // 30 minutes
  }
}

// Export singleton instance
export const youtubeTokenManager = new YouTubeTokenManager();

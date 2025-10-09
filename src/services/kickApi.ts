import axios from 'axios';
import { logger } from '../utils/logger';
import { kickTokenManager } from './kickTokenManager';
import { config } from '../config';

export class KickAPI {
  private baseURL = 'https://api.kick.com';

  constructor() {}

  /**
   * Send a message to a Kick chat
   */
  async sendChatMessage(channelId: string, message: string): Promise<string | undefined> {
    try {
      // Always use token manager to get the latest token (handles refresh automatically)
      let accessToken = await kickTokenManager.getAccessToken();

      // Use the official Kick API endpoint
      // broadcaster_user_id is the numeric user ID (77854856 for Gritzpup)
      // Using type:"bot" since broadcaster_user_id is ignored for bot messages
      const requestBody = {
        content: message,
        type: 'bot'
        // broadcaster_user_id not needed for bot type
      };

      logger.info(`[KICK API] Sending message to Kick: "${message}"`);
      logger.debug(`[KICK API] Request body: ${JSON.stringify(requestBody)}`);

      const response = await axios.post(
        `https://api.kick.com/public/v1/chat`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000
        }
      );

      logger.info(`[KICK API] Message sent successfully: "${message}"`);
      logger.info(`[KICK API] Response: ${JSON.stringify(response.data)}`);
      return response.data?.data?.message_id || response.data?.message_id || response.data?.id;
    } catch (error) {
      logger.error('Failed to send Kick message:', error);
      if (axios.isAxiosError(error)) {
        logger.error(`Kick API error: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
        if (error.response?.status === 401) {
          logger.warn('Kick token may be expired, attempting refresh...');
        }
      }
      return undefined;
    }
  }

  /**
   * Get chatroom ID for a channel
   */
  private async getChatroomId(channelSlug: string): Promise<number | null> {
    try {
      // Try the private API first
      const response = await axios.get(`${this.baseURL}/private/v1/channels/${channelSlug}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      const chatroomId = response.data?.data?.account?.channel?.chatroom?.id;
      if (chatroomId) {
        return chatroomId;
      }

      // If that doesn't work, try the old API endpoint
      const fallbackResponse = await axios.get(`${this.baseURL}/api/v2/channels/${channelSlug}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      return fallbackResponse.data?.chatroom?.id || null;
    } catch (error) {
      logger.error(`Failed to get chatroom ID for channel ${channelSlug}:`, error);
      return null;
    }
  }

  /**
   * Get user information
   */
  async getUserInfo(): Promise<any> {
    try {
      let accessToken = await kickTokenManager.getAccessToken();

      // Try multiple possible endpoints
      const endpoints = [
        `${this.baseURL}/public/v1/user`,
        `${this.baseURL}/public/v1/users/me`,
        `${this.baseURL}/api/v1/user`,
        `${this.baseURL}/api/me`
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(endpoint, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json',
            },
            timeout: 10000
          });

          if (response.data) {
            logger.info(`Kick user info endpoint found: ${endpoint}`);
            return response.data;
          }
        } catch (err) {
          // Try next endpoint
          continue;
        }
      }

      throw new Error('No working user info endpoint found');
    } catch (error) {
      logger.error('Failed to get Kick user info:', error);
      return null;
    }
  }

  /**
   * Check if the API token has required scopes
   */
  async checkScopes(): Promise<boolean> {
    try {
      const userInfo = await this.getUserInfo();
      if (userInfo) {
        logger.info(`Kick API authenticated as: ${userInfo.username}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Failed to check Kick API scopes:', error);
      return false;
    }
  }

  /**
   * Subscribe to Kick events via webhooks
   */
  async subscribeToEvents(webhookUrl: string, broadcasterUserId: string | number, events: Array<{name: string, version: number}>): Promise<any> {
    try {
      let accessToken = await kickTokenManager.getAccessToken();

      // broadcaster_user_id seems to be determined from the access token
      // Omit it from the request body - including it causes "Invalid request" errors
      const requestBody = {
        events,
        method: 'webhook'
        // Note: broadcaster_user_id is determined from the access token
        // Note: webhook_url is configured in Kick dashboard, not in request body
      };

      logger.debug(`Kick subscription request body: ${JSON.stringify(requestBody)}`);

      const response = await axios.post(
        `${this.baseURL}/public/v1/events/subscriptions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000
        }
      );

      logger.info(`Kick event subscription successful:`, response.data);
      return response.data;
    } catch (error) {
      logger.error('Failed to subscribe to Kick events:', error);
      if (axios.isAxiosError(error)) {
        logger.error(`Kick API error: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
      }
      return null;
    }
  }

  /**
   * Get existing event subscriptions
   */
  async getEventSubscriptions(): Promise<any> {
    try {
      let accessToken = await kickTokenManager.getAccessToken();

      const response = await axios.get(
        `${this.baseURL}/public/v1/events/subscriptions`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
          timeout: 10000
        }
      );

      logger.info(`Kick event subscriptions retrieved:`, response.data);
      return response.data;
    } catch (error) {
      logger.error('Failed to get Kick event subscriptions:', error);
      if (axios.isAxiosError(error)) {
        logger.error(`Kick API error: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
      }
      return null;
    }
  }

  /**
   * Unsubscribe from an event
   */
  async unsubscribeFromEvent(subscriptionIds: string[]): Promise<boolean> {
    try {
      let accessToken = await kickTokenManager.getAccessToken();

      await axios.delete(
        `${this.baseURL}/public/v1/events/subscriptions`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          data: {
            subscription_ids: subscriptionIds
          },
          timeout: 10000
        }
      );

      logger.info(`Kick event subscriptions deleted: ${subscriptionIds.join(', ')}`);
      return true;
    } catch (error) {
      logger.error('Failed to unsubscribe from Kick event:', error);
      return false;
    }
  }
}
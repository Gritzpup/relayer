import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
}

interface SendMessageResponse {
  data: [{
    message_id: string;
    is_sent: boolean;
  }];
}

export class TwitchAPI {
  private api: AxiosInstance;
  private accessToken: string;
  private userId?: string;
  private broadcasterId?: string;

  constructor(accessToken: string, clientId: string) {
    this.accessToken = accessToken;
    
    this.api = axios.create({
      baseURL: 'https://api.twitch.tv/helix',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Client-Id': clientId,
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for error handling
    this.api.interceptors.response.use(
      response => response,
      error => {
        if (error.response) {
          logger.error(`Twitch API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else {
          logger.error(`Twitch API network error: ${error.message}`);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Validate the access token and get user info
   */
  async validateToken(): Promise<boolean> {
    try {
      const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });
      
      logger.info(`Twitch token validated for user: ${response.data.login}`);
      this.userId = response.data.user_id;
      return true;
    } catch (error) {
      logger.error('Failed to validate Twitch token');
      return false;
    }
  }

  /**
   * Get user information by login name
   */
  async getUser(login: string): Promise<TwitchUser | null> {
    try {
      const response = await this.api.get('/users', {
        params: { login },
      });
      
      if (response.data.data && response.data.data.length > 0) {
        return response.data.data[0];
      }
      return null;
    } catch (error) {
      logger.error(`Failed to get user info for ${login}`);
      return null;
    }
  }

  /**
   * Get broadcaster (channel) information
   */
  async getBroadcaster(channelName: string): Promise<string | null> {
    const user = await this.getUser(channelName);
    if (user) {
      this.broadcasterId = user.id;
      return user.id;
    }
    return null;
  }

  /**
   * Send a chat message using the Twitch API
   */
  async sendChatMessage(channelName: string, message: string): Promise<string | undefined> {
    // Ensure we have broadcaster ID
    if (!this.broadcasterId) {
      const broadcasterId = await this.getBroadcaster(channelName);
      if (!broadcasterId) {
        logger.error(`Failed to get broadcaster ID for channel: ${channelName}`);
        return undefined;
      }
    }

    // Ensure we have user ID
    if (!this.userId) {
      const valid = await this.validateToken();
      if (!valid) {
        logger.error('Failed to validate token for sending message');
        return undefined;
      }
    }

    try {
      const response = await this.api.post<SendMessageResponse>('/chat/messages', {
        broadcaster_id: this.broadcasterId,
        sender_id: this.userId,
        message: message,
      });

      if (response.data.data[0]?.is_sent) {
        const messageId = response.data.data[0].message_id;
        logger.debug(`Sent Twitch message via API with ID: ${messageId}`);
        return messageId;
      } else {
        logger.warn('Twitch API reported message was not sent');
        return undefined;
      }
    } catch (error: any) {
      // Check for specific error codes
      if (error.response?.status === 429) {
        logger.warn('Twitch API rate limit reached');
      } else if (error.response?.status === 403) {
        logger.error('Forbidden: Check if bot has permission to send messages');
      } else {
        logger.error(`Failed to send message via Twitch API: ${error.message}`);
      }
      throw error; // Re-throw to allow fallback to TMI.js
    }
  }

  /**
   * Delete a chat message using the Twitch API
   * Requires moderator:manage:chat_messages scope
   */
  async deleteChatMessage(channelName: string, messageId: string): Promise<boolean> {
    // Ensure we have broadcaster ID
    if (!this.broadcasterId) {
      const broadcasterId = await this.getBroadcaster(channelName);
      if (!broadcasterId) {
        logger.error(`Failed to get broadcaster ID for channel: ${channelName}`);
        return false;
      }
    }

    // Ensure we have user ID (moderator ID)
    if (!this.userId) {
      const valid = await this.validateToken();
      if (!valid) {
        logger.error('Failed to validate token for deleting message');
        return false;
      }
    }

    try {
      // DELETE /helix/moderation/chat
      await this.api.delete('/moderation/chat', {
        params: {
          broadcaster_id: this.broadcasterId,
          moderator_id: this.userId,
          message_id: messageId,
        },
      });

      logger.info(`Successfully deleted Twitch message ${messageId} via API`);
      return true;
    } catch (error: any) {
      if (error.response?.status === 403) {
        logger.error('Forbidden: Bot needs moderator permissions or moderator:manage:chat_messages scope');
      } else if (error.response?.status === 404) {
        logger.warn('Message not found or already deleted');
      } else if (error.response?.status === 400) {
        logger.warn('Cannot delete message - might be from broadcaster or another moderator, or older than 6 hours');
      } else {
        logger.error(`Failed to delete message via Twitch API: ${error.message}`);
      }
      return false;
    }
  }

  /**
   * Check if we have the required scopes for API chat
   */
  async hasRequiredScopes(): Promise<boolean> {
    try {
      const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });
      
      const scopes = response.data.scopes || [];
      const requiredScopes = ['user:write:chat', 'user:bot'];
      const moderationScopes = ['moderator:manage:chat_messages'];
      
      const hasAllScopes = requiredScopes.every(scope => scopes.includes(scope));
      const hasModScopes = moderationScopes.some(scope => scopes.includes(scope));
      
      if (hasAllScopes) {
        logger.info('Twitch token has required scopes for Chat API');
      } else {
        logger.warn(`Missing required scopes. Have: ${scopes.join(', ')}`);
      }
      
      if (hasModScopes) {
        logger.info('Twitch token has moderator:manage:chat_messages scope for message deletion');
      } else {
        logger.warn('Missing moderator:manage:chat_messages scope - message deletion will not work');
      }
      
      return hasAllScopes;
    } catch (error) {
      logger.error('Failed to check Twitch token scopes');
      return false;
    }
  }
}
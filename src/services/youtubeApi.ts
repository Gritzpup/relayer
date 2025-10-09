import axios from 'axios';
import { logger } from '../utils/logger';
import { youtubeTokenManager } from './youtubeTokenManager';
import { config } from '../config';

interface LiveChatMessage {
  kind: string;
  etag: string;
  id: string;
  snippet: {
    type: string;
    liveChatId: string;
    authorChannelId: string;
    publishedAt: string;
    hasDisplayContent: boolean;
    displayMessage: string;
    textMessageDetails?: {
      messageText: string;
    };
  };
  authorDetails: {
    channelId: string;
    channelUrl: string;
    displayName: string;
    profileImageUrl: string;
    isVerified: boolean;
    isChatOwner: boolean;
    isChatSponsor: boolean;
    isChatModerator: boolean;
  };
}

export class YouTubeAPI {
  private baseURL = 'https://www.googleapis.com/youtube/v3';
  private accessToken?: string;
  private quotaExceeded: boolean = false;
  private quotaExceededUntil?: Date;

  constructor(accessToken?: string) {
    this.accessToken = accessToken;
  }

  /**
   * Update the access token
   */
  updateToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

  /**
   * Get the active live chat ID for a broadcast
   */
  async getActiveLiveChatId(broadcastId?: string): Promise<string | null> {
    try {
      let accessToken = this.accessToken;
      if (!accessToken) {
        accessToken = await youtubeTokenManager.getAccessToken();
      }

      // If broadcast ID is not provided, get the currently active broadcast
      if (!broadcastId) {
        const broadcasts = await axios.get(`${this.baseURL}/liveBroadcasts`, {
          params: {
            part: 'snippet',
            broadcastStatus: 'active',
            maxResults: 1
          },
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
          timeout: 10000
        });

        if (!broadcasts.data.items || broadcasts.data.items.length === 0) {
          logger.warn('No active YouTube live broadcasts found');
          return null;
        }

        broadcastId = broadcasts.data.items[0].id;
      }

      // Get the broadcast details to find the liveChatId
      const response = await axios.get(`${this.baseURL}/videos`, {
        params: {
          part: 'liveStreamingDetails',
          id: broadcastId
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
        timeout: 10000
      });

      const liveChatId = response.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (liveChatId) {
        logger.info(`Found active live chat ID: ${liveChatId}`);
        return liveChatId;
      }

      logger.warn('No active live chat found for broadcast');
      return null;
    } catch (error) {
      logger.error('Failed to get live chat ID:', error);
      return null;
    }
  }

  /**
   * Send a message to YouTube live chat
   */
  async sendChatMessage(liveChatId: string, message: string): Promise<string | undefined> {
    // Check if quota is exceeded
    if (this.quotaExceeded && this.quotaExceededUntil && new Date() < this.quotaExceededUntil) {
      logger.warn('[YOUTUBE API] Quota exceeded, skipping message send until quota resets');
      return undefined;
    }

    try {
      let accessToken = this.accessToken;
      if (!accessToken) {
        accessToken = await youtubeTokenManager.getAccessToken();
      }

      logger.info(`[YOUTUBE API] Sending message to YouTube: "${message}"`);

      const response = await axios.post(
        `${this.baseURL}/liveChat/messages`,
        {
          snippet: {
            liveChatId: liveChatId,
            type: 'textMessageEvent',
            textMessageDetails: {
              messageText: message
            }
          }
        },
        {
          params: {
            part: 'snippet'
          },
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000
        }
      );

      logger.info(`[YOUTUBE API] Message sent successfully: "${message}"`);
      // Reset quota exceeded flag on successful send
      this.quotaExceeded = false;
      this.quotaExceededUntil = undefined;
      return response.data?.id;
    } catch (error) {
      logger.error('Failed to send YouTube message:', error);
      if (axios.isAxiosError(error)) {
        logger.error(`YouTube API error: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
        if (error.response?.status === 401) {
          logger.warn('YouTube token may be expired, attempting refresh...');
        } else if (error.response?.status === 403 &&
                   error.response?.data?.error?.errors?.[0]?.reason === 'quotaExceeded') {
          // Set quota exceeded flag - YouTube quotas reset at midnight Pacific Time
          this.quotaExceeded = true;
          const now = new Date();
          const midnightPT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
          midnightPT.setHours(24, 0, 0, 0);
          this.quotaExceededUntil = midnightPT;
          logger.warn(`[YOUTUBE API] ⚠️  YouTube API quota exceeded! Message sending disabled until ${midnightPT.toISOString()}`);
          logger.warn(`[YOUTUBE API] YouTube will still receive messages from other platforms, but won't send to YouTube until quota resets.`);
        }
      }
      return undefined;
    }
  }

  /**
   * List live chat messages (for polling)
   */
  async listChatMessages(liveChatId: string, pageToken?: string): Promise<{
    messages: LiveChatMessage[];
    nextPageToken?: string;
    pollingIntervalMillis?: number;
  }> {
    // Check if quota is exceeded
    if (this.quotaExceeded && this.quotaExceededUntil && new Date() < this.quotaExceededUntil) {
      // Return empty messages but with a longer interval to reduce log spam
      return {
        messages: [],
        pollingIntervalMillis: 60000 // Poll every 60 seconds when quota exceeded
      };
    }

    try {
      let accessToken = this.accessToken;
      if (!accessToken) {
        accessToken = await youtubeTokenManager.getAccessToken();
      }

      const params: any = {
        liveChatId,
        part: 'snippet,authorDetails',
        maxResults: 200
      };

      if (pageToken) {
        params.pageToken = pageToken;
      }

      const response = await axios.get(`${this.baseURL}/liveChat/messages`, {
        params,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
        timeout: 10000
      });

      // Reset quota exceeded flag on successful poll
      if (this.quotaExceeded) {
        this.quotaExceeded = false;
        this.quotaExceededUntil = undefined;
        logger.info('[YOUTUBE API] ✅ YouTube API quota restored! Resuming normal operation.');
      }

      return {
        messages: response.data.items || [],
        nextPageToken: response.data.nextPageToken,
        pollingIntervalMillis: response.data.pollingIntervalMillis || 5000
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403 &&
          error.response?.data?.error?.errors?.[0]?.reason === 'quotaExceeded') {
        // Set quota exceeded flag
        if (!this.quotaExceeded) {
          this.quotaExceeded = true;
          const now = new Date();
          const midnightPT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
          midnightPT.setHours(24, 0, 0, 0);
          this.quotaExceededUntil = midnightPT;
          logger.warn(`[YOUTUBE API] ⚠️  YouTube API quota exceeded! Both sending and receiving disabled until ${midnightPT.toISOString()}`);
          logger.warn(`[YOUTUBE API] YouTube integration will automatically resume when quota resets.`);
        }
      } else {
        logger.error('Failed to list YouTube chat messages:', error);
      }
      return {
        messages: [],
        pollingIntervalMillis: 60000 // Use longer interval on error
      };
    }
  }

  /**
   * Delete a message from YouTube live chat
   */
  async deleteChatMessage(messageId: string): Promise<boolean> {
    try {
      let accessToken = this.accessToken;
      if (!accessToken) {
        accessToken = await youtubeTokenManager.getAccessToken();
      }

      await axios.delete(`${this.baseURL}/liveChat/messages`, {
        params: {
          id: messageId
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        timeout: 10000
      });

      logger.info(`Deleted YouTube message: ${messageId}`);
      return true;
    } catch (error) {
      logger.error('Failed to delete YouTube message:', error);
      return false;
    }
  }
}

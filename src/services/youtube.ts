import { config } from '../config';
import { Platform, RelayMessage, MessageHandler, DeleteHandler, PlatformService, ServiceStatus, Attachment } from '../types';
import { logger, logPlatformMessage, logError } from '../utils/logger';
import { ReconnectManager } from '../utils/reconnect';
import { youtubeTokenManager } from './youtubeTokenManager';
import { YouTubeAPI } from './youtubeApi';

export class YouTubeService implements PlatformService {
  platform = Platform.YouTube;
  private messageHandler?: MessageHandler;
  private deleteHandler?: DeleteHandler;
  private reconnectManager: ReconnectManager;
  private isConnecting: boolean = false;
  private api: YouTubeAPI;
  private liveChatId: string | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private nextPageToken?: string;
  private processedMessageIds: Set<string> = new Set();
  private lastStreamState: string | null = null;
  private chatActivationCheckCount: number = 0;
  private failedDetectionAttempts: number = 0;
  private lastDetectionAttempt: number = 0;
  private status: ServiceStatus = {
    platform: Platform.YouTube,
    connected: false,
    messagesSent: 0,
    messagesReceived: 0,
  };

  constructor() {
    this.api = new YouTubeAPI();
    this.reconnectManager = new ReconnectManager(
      'YouTube',
      () => this.connectInternal(),
      {
        initialDelay: 2000,
        maxDelay: 30000,
        factor: 2,
      }
    );
  }

  async connect(): Promise<void> {
    if (this.isConnecting) {
      logger.debug('YouTube connection already in progress');
      return;
    }

    this.isConnecting = true;
    logger.info('Connecting to YouTube...');

    try {
      // Initialize token manager for API authentication
      // Always initialize to ensure tokens are fresh and can be refreshed
      await youtubeTokenManager.initialize();
      youtubeTokenManager.startAutoRefresh();

      await this.connectInternal();
    } catch (error) {
      this.isConnecting = false;
      this.status.connected = false;
      this.status.lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to connect to YouTube - service will continue without YouTube', error);
      logger.warn('YouTube authentication failed - relayer will continue without YouTube integration');
      // Don't schedule reconnect for auth failures, don't throw - just continue
      // this.reconnectManager.scheduleReconnect();
      // throw error;
    }
  }

  private async connectInternal(): Promise<void> {
    try {
      // Get or use configured live chat ID
      this.liveChatId = config.youtube?.liveChatId || null;

      if (!this.liveChatId) {
        // Try to get the active live chat ID automatically
        this.liveChatId = await this.api.getActiveLiveChatId();
      }

      if (!this.liveChatId) {
        logger.warn('No active YouTube live chat found - YouTube integration disabled');
        logger.warn('To receive YouTube messages, either start a live broadcast or set YOUTUBE_LIVE_CHAT_ID in .env');
        this.status.connected = false;
        this.isConnecting = false;
        return;
      }

      logger.info(`Connected to YouTube live chat: ${this.liveChatId}`);

      // Start polling for messages
      this.startPolling();

      this.status.connected = true;
      this.isConnecting = false;
      logger.info('Successfully connected to YouTube');

    } catch (error) {
      this.status.connected = false;
      this.isConnecting = false;
      this.status.lastError = error instanceof Error ? error.message : 'Connection failed';
      throw error;
    }
  }

  private startPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    let isFirstPoll = true; // Track if this is the first poll to skip old messages

    const poll = async () => {
      if (!this.liveChatId) return;

      try {
        const { messages, nextPageToken, pollingIntervalMillis, chatIdInvalid } = await this.api.listChatMessages(
          this.liveChatId,
          this.nextPageToken
        );

        // Check if chat ID is invalid (stream ended or new stream started)
        if (chatIdInvalid) {
          // Implement exponential backoff to avoid burning API quota
          const now = Date.now();
          const backoffMinutes = Math.min(Math.pow(2, this.failedDetectionAttempts), 60); // Max 60 min
          const backoffMs = backoffMinutes * 60 * 1000;

          if (now - this.lastDetectionAttempt < backoffMs) {
            // Skip this attempt, we're in backoff period
            return;
          }

          this.lastDetectionAttempt = now;
          logger.warn(`YouTube live chat ID is invalid - attempting to fetch new chat ID (attempt ${this.failedDetectionAttempts + 1})...`);

          const newChatId = await this.fetchLiveChatIdFromPage();
          if (newChatId && newChatId !== this.liveChatId) {
            logger.info(`Found new live chat ID: ${newChatId}`);
            this.liveChatId = newChatId;
            await this.updateEnvFile(newChatId);
            this.nextPageToken = undefined; // Reset page token for new chat
            this.processedMessageIds.clear(); // Clear processed messages
            isFirstPoll = true; // Reset first poll flag for new chat
            this.failedDetectionAttempts = 0; // Reset backoff counter
            logger.info('✅ Successfully updated to new YouTube live chat!');
          } else {
            this.failedDetectionAttempts++;
            const nextRetryMinutes = Math.min(Math.pow(2, this.failedDetectionAttempts), 60);
            logger.warn(`Could not find new chat ID. Will retry in ${nextRetryMinutes} minutes.`);
            logger.warn('Could not fetch new live chat ID - will retry on next poll');
          }
          return;
        }

        this.nextPageToken = nextPageToken;

        // On first poll, only mark messages as processed without relaying them
        if (isFirstPoll) {
          logger.info(`Skipping ${messages.length} old YouTube messages on startup`);
          for (const message of messages) {
            this.processedMessageIds.add(message.id);
          }
          isFirstPoll = false;
          return;
        }

        for (const message of messages) {
          // Skip if we've already processed this message
          if (this.processedMessageIds.has(message.id)) {
            continue;
          }

          this.processedMessageIds.add(message.id);

          // Cleanup old message IDs to prevent memory leak (keep last 1000)
          if (this.processedMessageIds.size > 1000) {
            const idsArray = Array.from(this.processedMessageIds);
            this.processedMessageIds = new Set(idsArray.slice(-1000));
          }

          await this.handleMessage(message);
        }

        // Update polling interval if provided
        if (pollingIntervalMillis && this.pollingInterval) {
          clearInterval(this.pollingInterval);
          this.pollingInterval = setInterval(poll, pollingIntervalMillis);
        }
      } catch (error) {
        logError(error as Error, 'Error polling YouTube messages');
      }
    };

    // Start polling with configured interval (default 30 seconds)
    const pollingIntervalMs = config.youtube?.pollingInterval || 30000;
    this.pollingInterval = setInterval(poll, pollingIntervalMs);
    logger.info(`Started polling YouTube live chat messages every ${pollingIntervalMs/1000} seconds`);
  }

  /**
   * Fetch live chat ID by scraping the channel's live page and using the API
   */
  private async fetchLiveChatIdFromPage(): Promise<string | null> {
    try {
      const channelId = config.youtube?.channelId;
      if (!channelId) {
        logger.error('No YouTube channel ID configured');
        return null;
      }

      const axios = require('axios');

      // Step 1: Use YouTube Search API to find live streams on the channel
      logger.debug('Searching for live streams on channel...');
      const accessToken = await youtubeTokenManager.getAccessToken();

      const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          part: 'snippet',
          channelId: channelId,
          eventType: 'live',
          type: 'video',
          maxResults: 1
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 10000
      });

      if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
        logger.warn('No live streams found via search API');
        return null;
      }

      const videoId = searchResponse.data.items[0].id.videoId;
      logger.info(`✅ Found live stream video ID: ${videoId}`);

      // Get the video details to extract the live chat ID
      logger.debug(`Fetching live chat ID for video ${videoId}...`);

      const apiResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'liveStreamingDetails,snippet,status',
          id: videoId
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 10000
      });

      const videoData = apiResponse.data.items?.[0];
      if (!videoData) {
        logger.warn(`Video ${videoId} not found in API response`);
        return null;
      }

      const liveStreamingDetails = videoData.liveStreamingDetails;
      const snippet = videoData.snippet;
      const status = videoData.status;
      const broadcastContent = snippet?.liveBroadcastContent;

      // Create a state key to track if stream state has changed
      const currentState = `${videoId}:${broadcastContent}:${!!liveStreamingDetails?.actualStartTime}:${!!liveStreamingDetails?.activeLiveChatId}`;
      const isStateChanged = this.lastStreamState !== currentState;
      this.lastStreamState = currentState;
      this.chatActivationCheckCount++;

      // Log detailed stream status only when state changes or every 10 checks (to reduce log spam)
      if (isStateChanged || this.chatActivationCheckCount % 10 === 0) {
        logger.info(`📹 YouTube Stream Status for video ${videoId}:`);
        logger.info(`   Title: ${snippet?.title || 'Unknown'}`);
        logger.info(`   Live Status: ${snippet?.liveBroadcastContent || 'unknown'}`);
        logger.info(`   Privacy: ${status?.privacyStatus || 'unknown'}`);

        if (liveStreamingDetails) {
          const scheduledStart = liveStreamingDetails.scheduledStartTime;
          const actualStart = liveStreamingDetails.actualStartTime;
          const actualEnd = liveStreamingDetails.actualEndTime;
          const concurrentViewers = liveStreamingDetails.concurrentViewers;

          if (scheduledStart) {
            logger.info(`   Scheduled Start: ${scheduledStart}`);
          }
          if (actualStart) {
            logger.info(`   ✅ Actually Started: ${actualStart}`);
          }
          if (actualEnd) {
            logger.info(`   Ended: ${actualEnd}`);
          }
          if (concurrentViewers) {
            logger.info(`   👥 Current Viewers: ${concurrentViewers}`);
          }
        }
      }

      const liveChatId = liveStreamingDetails?.activeLiveChatId;
      if (liveChatId) {
        logger.info(`✅ Found active live chat ID: ${liveChatId}`);
        logger.info(`🎉 YouTube chat is ready! Messages will now be relayed.`);
        this.chatActivationCheckCount = 0; // Reset counter
        return liveChatId;
      }

      // Provide helpful diagnostic messages only when state changes or periodically
      if (isStateChanged || this.chatActivationCheckCount % 10 === 0) {
        if (broadcastContent === 'upcoming') {
          logger.warn('⏰ Stream is scheduled but not live yet - waiting for broadcast to start...');
          logger.warn('   The stream needs to transition from "Starting Soon" to fully live before chat becomes active.');
        } else if (broadcastContent === 'none') {
          logger.warn('❌ No live broadcast detected for this video - it may have ended or not be a live stream');
        } else if (!liveStreamingDetails?.actualStartTime) {
          logger.warn('⏳ Stream exists but hasn\'t actually started broadcasting yet');
          logger.warn('   Please ensure you\'ve clicked "Go Live" in YouTube Studio and the stream is broadcasting.');
        } else {
          logger.warn('⚠️  Stream is live but chat is not active yet');
          logger.warn('   This can happen if:');
          logger.warn('   1. Live chat is disabled in stream settings');
          logger.warn('   2. Stream just went live and chat is still initializing (wait 1-2 minutes)');
          logger.warn('   3. Stream is in "test" mode rather than public/unlisted');
        }

        logger.warn('💡 Relayer will keep checking and automatically connect when chat becomes active.');
      }

      return null;
    } catch (error: any) {
      logger.error('Failed to fetch live chat ID:', error);
      if (error.response?.data) {
        logger.error('YouTube API error details:', JSON.stringify(error.response.data, null, 2));
      }
      return null;
    }
  }

  /**
   * Update .env file with new live chat ID
   */
  private async updateEnvFile(newChatId: string): Promise<void> {
    try {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(process.cwd(), '.env');

      let envContent = fs.readFileSync(envPath, 'utf8');

      // Update YOUTUBE_LIVE_CHAT_ID line
      if (envContent.includes('YOUTUBE_LIVE_CHAT_ID=')) {
        envContent = envContent.replace(
          /YOUTUBE_LIVE_CHAT_ID=.*/,
          `YOUTUBE_LIVE_CHAT_ID=${newChatId}`
        );
      } else {
        // Add it if it doesn't exist
        envContent += `\nYOUTUBE_LIVE_CHAT_ID=${newChatId}\n`;
      }

      fs.writeFileSync(envPath, envContent, 'utf8');
      logger.info('Updated .env file with new YouTube live chat ID');
    } catch (error) {
      logger.error('Failed to update .env file:', error);
    }
  }

  private async handleMessage(messageData: any): Promise<void> {
    try {
      const messageText = messageData.snippet?.textMessageDetails?.messageText ||
                         messageData.snippet?.displayMessage || '';
      const author = messageData.authorDetails?.displayName || 'Unknown';

      // Check if this is a relayed message - messages that START with platform prefix
      // This prevents the bot from seeing its own relayed messages and echoing them back
      const isRelayedMessage = /^\[?(Telegram|Discord|Twitch|Kick|YouTube|𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦|𝐃𝐢𝐬𝐜𝐨𝐫𝐝|𝐓𝐰𝐢𝐭𝐜𝐡|𝐊𝐢𝐜𝐤|𝐘𝐨𝐮𝐓𝐮𝐛𝐞)\]/.test(messageText) ||
        /^(🔵|🟣|🔴|🟢|✈️|🎮|💬)/.test(messageText);

      if (isRelayedMessage) {
        logger.debug(`YouTube: Skipping relayed message: "${messageText.substring(0, 50)}..."`);
        return;
      }

      // Note: We don't filter messages from channel owner here because the relayed message check above
      // already handles filtering the bot's own relayed messages (which have platform tags)

      this.status.messagesReceived++;
      logPlatformMessage('YouTube', 'in', messageText, author);

      if (this.messageHandler) {
        const relayMessage: RelayMessage = {
          id: messageData.id,
          platform: Platform.YouTube,
          author,
          content: messageText,
          timestamp: new Date(messageData.snippet.publishedAt),
          channelName: 'general',
          raw: messageData,
        };

        await this.messageHandler(relayMessage);
      }

    } catch (error) {
      logError(error as Error, 'Error handling YouTube message');
    }
  }

  async disconnect(): Promise<void> {
    logger.info('Disconnecting from YouTube...');

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.status.connected = false;
    this.isConnecting = false;
    this.processedMessageIds.clear();
  }

  async sendMessage(
    content: string,
    attachments?: Attachment[],
    replyToMessageId?: string,
    targetChannelId?: string,
    originalMessage?: RelayMessage
  ): Promise<string | undefined> {

    if (!this.status.connected || !this.liveChatId) {
      logger.warn('Cannot send YouTube message: Not connected or no live chat ID');
      return;
    }

    try {
      // YouTube live chat has a 200 character limit
      let messageContent = content;
      if (messageContent.length > 200) {
        messageContent = messageContent.substring(0, 197) + '...';
      }

      // Add attachment URLs if present
      if (attachments && attachments.length > 0) {
        const attachmentUrls = attachments
          .filter(att => att.url)
          .map(att => att.url)
          .join(' ');

        if (attachmentUrls) {
          const combined = `${messageContent} ${attachmentUrls}`;
          messageContent = combined.length > 200 ? combined.substring(0, 197) + '...' : combined;
        }
      }

      const messageId = await this.api.sendChatMessage(this.liveChatId, messageContent);

      if (messageId) {
        this.status.messagesSent++;
        this.processedMessageIds.add(messageId); // Add to processed to avoid echoing
        logPlatformMessage('YouTube', 'out', messageContent, 'bot');
        return messageId;
      }

      return undefined;

    } catch (error) {
      logError(error as Error, 'Failed to send message to YouTube');
      return;
    }
  }

  async editMessage(messageId: string, newContent: string): Promise<boolean> {
    // YouTube doesn't support message editing
    logger.debug('YouTube does not support message editing');
    return false;
  }

  async deleteMessage(messageId: string, channelId?: string): Promise<boolean> {
    try {
      return await this.api.deleteChatMessage(messageId);
    } catch (error) {
      logError(error as Error, 'Failed to delete YouTube message');
      return false;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onDelete(handler: DeleteHandler): void {
    this.deleteHandler = handler;
  }

  getStatus(): ServiceStatus {
    return this.status;
  }
}

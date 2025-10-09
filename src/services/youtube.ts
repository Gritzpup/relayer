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
      if (!config.youtube?.accessToken) {
        await youtubeTokenManager.initialize();
        youtubeTokenManager.startAutoRefresh();
      }

      await this.connectInternal();
    } catch (error) {
      this.isConnecting = false;
      this.status.lastError = error instanceof Error ? error.message : 'Unknown error';
      logError(error as Error, 'Failed to connect to YouTube');
      this.reconnectManager.scheduleReconnect();
      throw error;
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

    const poll = async () => {
      if (!this.liveChatId) return;

      try {
        const { messages, nextPageToken, pollingIntervalMillis } = await this.api.listChatMessages(
          this.liveChatId,
          this.nextPageToken
        );

        this.nextPageToken = nextPageToken;

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

    // Start polling every 5 seconds initially
    this.pollingInterval = setInterval(poll, 5000);
    logger.info('Started polling YouTube live chat messages');
  }

  private async handleMessage(messageData: any): Promise<void> {
    try {
      const messageText = messageData.snippet?.textMessageDetails?.messageText ||
                         messageData.snippet?.displayMessage || '';
      const author = messageData.authorDetails?.displayName || 'Unknown';

      // Skip bot's own messages (check if author is the channel owner)
      if (messageData.authorDetails?.isChatOwner && config.youtube?.channelId) {
        logger.debug('Skipping message from bot account');
        return;
      }

      // Check if this is a relayed message - ANY message with platform prefix
      // This prevents the bot from seeing its own relayed messages and echoing them back
      const isRelayedMessage = messageText.includes('[') && messageText.includes(']') && (
        messageText.includes('Telegram') ||
        messageText.includes('Discord') ||
        messageText.includes('Twitch') ||
        messageText.includes('Kick') ||
        messageText.includes('𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦') ||
        messageText.includes('𝐃𝐢𝐬𝐜𝐨𝐫𝐝') ||
        messageText.includes('𝐓𝐰𝐢𝐭𝐜𝐡') ||
        messageText.includes('𝐊𝐢𝐜𝐤')
      );

      if (isRelayedMessage) {
        logger.debug(`YouTube: Skipping relayed message: "${messageText.substring(0, 50)}..."`);
        return;
      }

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

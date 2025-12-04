import { config } from '../config';
import { Platform, RelayMessage, MessageHandler, DeleteHandler, PlatformService, ServiceStatus, Attachment } from '../types';
import { logger, logPlatformMessage, logError } from '../utils/logger';
import { ReconnectManager } from '../utils/reconnect';
import axios from 'axios';

interface RumbleChatMessage {
  username: string;
  badges: string[];
  text: string;
  created_on: string;
}

interface RumbleApiResponse {
  livestreams?: Array<{
    id: string;
    title: string;
    is_live: boolean;
    chat?: {
      latest_message?: RumbleChatMessage;
      recent_messages?: RumbleChatMessage[];
    };
  }>;
}

export class RumbleService implements PlatformService {
  platform = Platform.Rumble;
  private messageHandler?: MessageHandler;
  private deleteHandler?: DeleteHandler;
  private reconnectManager: ReconnectManager;
  private isConnecting: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private processedMessageIds: Set<string> = new Set();
  private apiKey: string;
  private apiUrl: string;
  private status: ServiceStatus = {
    platform: Platform.Rumble,
    connected: false,
    messagesSent: 0,
    messagesReceived: 0,
  };

  constructor() {
    this.apiKey = config.rumble?.apiKey || '';
    this.apiUrl = `https://rumble.com/-livestream-api/get-data?key=${this.apiKey}`;

    this.reconnectManager = new ReconnectManager(
      'Rumble',
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
      logger.debug('Rumble connection already in progress');
      return;
    }

    if (!this.apiKey) {
      logger.error('Rumble API key not configured - Rumble integration disabled');
      logger.error('Set RUMBLE_API_KEY in .env to enable Rumble chat relay');
      return;
    }

    this.isConnecting = true;
    logger.info('Connecting to Rumble...');

    try {
      await this.connectInternal();
    } catch (error) {
      this.isConnecting = false;
      this.status.connected = false;
      this.status.lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to connect to Rumble - service will continue without Rumble', error);
      logger.warn('Rumble connection failed - relayer will continue without Rumble integration');
    }
  }

  private async connectInternal(): Promise<void> {
    try {
      // Test the API connection
      const response = await axios.get<RumbleApiResponse>(this.apiUrl, {
        timeout: 10000
      });

      if (!response.data) {
        throw new Error('No data received from Rumble API');
      }

      logger.info('Successfully connected to Rumble API');

      // Check if there's a live stream
      const liveStream = response.data.livestreams?.find(stream => stream.is_live);
      if (liveStream) {
        logger.info(`Found active Rumble stream: ${liveStream.title}`);
      } else {
        logger.warn('No active Rumble stream found - will connect when stream goes live');
      }

      // Start polling for messages
      this.startPolling();

      this.status.connected = true;
      this.isConnecting = false;
      logger.info('Successfully connected to Rumble');

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
      try {
        const response = await axios.get<RumbleApiResponse>(this.apiUrl, {
          timeout: 10000
        });

        const liveStream = response.data.livestreams?.find(stream => stream.is_live);

        if (!liveStream) {
          // No live stream - clear processed messages when stream ends
          if (this.processedMessageIds.size > 0) {
            logger.debug('Rumble stream ended - clearing processed messages');
            this.processedMessageIds.clear();
            isFirstPoll = true; // Reset for next stream
          }
          return;
        }

        const messages = liveStream.chat?.recent_messages || [];

        // On first poll, only mark messages as processed without relaying them
        if (isFirstPoll) {
          logger.info(`Skipping ${messages.length} old Rumble messages on startup`);
          for (const message of messages) {
            const messageId = this.generateMessageId(message);
            this.processedMessageIds.add(messageId);
          }
          isFirstPoll = false;
          return;
        }

        for (const message of messages) {
          const messageId = this.generateMessageId(message);

          // Skip if we've already processed this message
          if (this.processedMessageIds.has(messageId)) {
            continue;
          }

          this.processedMessageIds.add(messageId);

          // Cleanup old message IDs to prevent memory leak (keep last 1000)
          if (this.processedMessageIds.size > 1000) {
            const idsArray = Array.from(this.processedMessageIds);
            this.processedMessageIds = new Set(idsArray.slice(-1000));
          }

          await this.handleMessage(message);
        }

      } catch (error) {
        logError(error as Error, 'Error polling Rumble messages');
      }
    };

    // Poll every 5 seconds (Rumble updates in real-time, so we want frequent polling)
    const pollingIntervalMs = config.rumble?.pollingInterval || 5000;
    this.pollingInterval = setInterval(poll, pollingIntervalMs);
    logger.info(`Started polling Rumble chat messages every ${pollingIntervalMs/1000} seconds`);
  }

  private generateMessageId(message: RumbleChatMessage): string {
    // Create a unique ID from username + timestamp + text
    // This is needed because Rumble API doesn't provide message IDs
    return `${message.username}-${message.created_on}-${message.text.substring(0, 20)}`;
  }

  private async handleMessage(messageData: RumbleChatMessage): Promise<void> {
    try {
      const messageText = messageData.text || '';
      const author = messageData.username || 'Unknown';

      // Check if this is a relayed message - messages that START with platform prefix
      // This prevents the bot from seeing its own relayed messages and echoing them back
      const isRelayedMessage = /^\[?(Telegram|Discord|Twitch|Kick|YouTube|Rumble|𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦|𝐃𝐢𝐬𝐜𝐨𝐫𝐝|𝐓𝐰𝐢𝐭𝐜𝐡|𝐊𝐢𝐜𝐤|𝐘𝐨𝐮𝐓𝐮𝐛𝐞|𝐑𝐮𝐦𝐛𝐥𝐞)\]/.test(messageText) ||
        /^(🔵|🟣|🔴|🟢|✈️|🎮|💬|🎬)/.test(messageText);

      if (isRelayedMessage) {
        logger.debug(`Rumble: Skipping relayed message: "${messageText.substring(0, 50)}..."`);
        return;
      }

      this.status.messagesReceived++;
      logPlatformMessage('Rumble', 'in', messageText, author);

      if (this.messageHandler) {
        const relayMessage: RelayMessage = {
          id: this.generateMessageId(messageData),
          platform: Platform.Rumble,
          author,
          content: messageText,
          timestamp: new Date(messageData.created_on),
          channelName: 'general',
          raw: messageData,
        };

        await this.messageHandler(relayMessage);
      }

    } catch (error) {
      logError(error as Error, 'Error handling Rumble message');
    }
  }

  async disconnect(): Promise<void> {
    logger.info('Disconnecting from Rumble...');

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

    // Rumble API v1.1 does not support sending messages (read-only)
    logger.debug('Rumble API does not support sending messages (read-only API)');
    return undefined;
  }

  async editMessage(messageId: string, newContent: string): Promise<boolean> {
    // Rumble doesn't support message editing
    logger.debug('Rumble does not support message editing');
    return false;
  }

  async deleteMessage(messageId: string, channelId?: string): Promise<boolean> {
    // Rumble doesn't support message deletion via API
    logger.debug('Rumble does not support message deletion via API');
    return false;
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

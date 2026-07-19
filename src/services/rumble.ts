import { config } from '../config';
import { Platform, RelayMessage, MessageHandler, DeleteHandler, PlatformService, ServiceStatus, Attachment } from '../types';
import { logger, logPlatformMessage, logError } from '../utils/logger';

import { rumbleCookieManager } from './rumbleCookieManager';
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

  private isConnecting: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private processedMessageIds: Set<string> = new Set();
  private currentStreamId: string | null = null; // Track to detect stream transitions
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
      // Initialize cookie manager for authentication (for sending messages)
      await rumbleCookieManager.initialize();

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

      // Initialize browser-based chat for sending messages (awaited to prevent race)
      if (liveStream?.id) {
        this.currentStreamId = liveStream.id;
        await rumbleCookieManager.setChatId(liveStream.id);
        logger.info('Initializing Rumble chat browser for outgoing messages...');
        const browserReady = await rumbleCookieManager.initializeChatBrowser(liveStream.id);
        if (browserReady) {
          logger.info('✅ Rumble chat browser ready for outgoing messages');
        } else {
          logger.warn('⚠️ Rumble chat browser init failed - outgoing messages may not work');
        }
      }

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
          // No live stream - clear processed messages when stream ends.
          // Do NOT reset isFirstPoll — only the very first connection ever
          // should skip recent messages; stream transitions should relay them.
          if (this.processedMessageIds.size > 0) {
            logger.debug('Rumble stream ended - clearing processed messages');
            this.processedMessageIds.clear();
          }
          this.currentStreamId = null;
          return;
        }

        // Detect stream transition (new stream started or stream ID changed)
        if (liveStream.id !== this.currentStreamId) {
          logger.info(`🔄 Rumble stream transition: ${this.currentStreamId || 'none'} → ${liveStream.id} ("${liveStream.title}")`);
          this.currentStreamId = liveStream.id;
          await rumbleCookieManager.setChatId(liveStream.id);

          // Close the old browser and reinitialize on the new stream
          await rumbleCookieManager.closeChatBrowser();
          logger.info('Reinitializing chat browser for new stream...');
          const browserReady = await rumbleCookieManager.initializeChatBrowser(liveStream.id);
          if (browserReady) {
            logger.info('✅ Chat browser ready for new stream');
          } else {
            logger.warn('⚠️ Chat browser init failed for new stream — will retry on next message');
          }

          // Reset processed messages for the new stream.
          // Do NOT set isFirstPoll = true here — that would mark all current
          // recent_messages as "already processed" and silently drop any chat
          // messages sent right when the new stream starts. Only initial
          // startup should skip; transitions should relay the fresh chat.
          this.processedMessageIds.clear();
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

      // Check if this is a relayed message - messages that contain platform prefix tags.
      // Puppeteer keyboard.type() may strip emoji characters, leaving a leading space
      // from the formatter's "🟣 [Telegram]" → " [Telegram]". trimStart() handles this.
      const stripped = messageText.trimStart().replace(/^\[EDITED\][\s\u00A0]*/, "");
      const isRelayedMessage = /^\[(Telegram|Discord|Twitch|Kick|YouTube|Rumble|𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦|𝐃𝐢𝐬𝐜𝐨𝐫𝐝|𝐓𝐰𝐢𝐭𝐜𝐡|𝐊𝐢𝐜𝐤|𝐘𝐨𝐮𝐓𝐮𝐛𝐞|𝐑𝐮𝐦𝐛𝐥𝐞)\]/.test(stripped) ||
        /^(🔵|🟣|🔴|🟢|✈️|🎮|💬|🎬)/.test(stripped);

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

    // Close the chat browser
    await rumbleCookieManager.closeChatBrowser();

    this.status.connected = false;
    this.isConnecting = false;
    this.processedMessageIds.clear();
  }

  async sendMessage(
    content: string,
    attachments?: Attachment[],
    _replyToMessageId?: string,
    _targetChannelId?: string,
    _originalMessage?: RelayMessage
  ): Promise<string | undefined> {

    if (!this.status.connected) {
      logger.warn('Cannot send Rumble message: Not connected');
      return undefined;
    }

    try {
      // Get the live stream ID for browser navigation
      let streamId = await rumbleCookieManager.getChatId();

      if (!streamId) {
        const response = await axios.get<RumbleApiResponse>(this.apiUrl, {
          timeout: 10000
        });

        const liveStream = response.data.livestreams?.find(stream => stream.is_live);
        if (liveStream?.id) {
          streamId = liveStream.id;
          await rumbleCookieManager.setChatId(streamId);
        } else {
          logger.warn('No active Rumble stream found - cannot send message');
          return undefined;
        }
      }

      // Prepare message content
      let messageContent = content;

      // Add attachment URLs if present
      if (attachments && attachments.length > 0) {
        const attachmentUrls = attachments
          .filter(att => att.url)
          .map(att => att.url)
          .join(' ');

        if (attachmentUrls) {
          messageContent = `${messageContent} ${attachmentUrls}`;
        }
      }

      const chatId = config.rumble?.chatId;

      // Try authenticated API first if chatId is configured
      let sentMessageId: string | undefined;
      if (chatId) {
        logger.info(`[RUMBLE] Sending message via authenticated API: "${messageContent.substring(0, 50)}..."`);
        sentMessageId = await rumbleCookieManager.sendMessageViaApi(messageContent, chatId, streamId);
        if (sentMessageId) {
          this.status.messagesSent++;
          logPlatformMessage('Rumble', 'out', messageContent, 'bot');
          logger.info('[RUMBLE] Message sent successfully via API');
          return sentMessageId;
        }
        // API failed — fall back to browser
        logger.warn('[RUMBLE] API send failed, falling back to browser automation...');
      }

      // Browser fallback (or primary if no chatId configured)
      logger.info(`[RUMBLE] Sending message via browser automation: "${messageContent.substring(0, 50)}..."`);
      const browserOk = await rumbleCookieManager.sendMessageViaBrowser(messageContent, streamId);
      if (browserOk) {
        this.status.messagesSent++;
        logPlatformMessage('Rumble', 'out', messageContent, 'bot');
        logger.info('[RUMBLE] Message sent successfully via browser');
        return `rumble-${Date.now()}`;
      }

      logger.warn('[RUMBLE] Send failed');
      return undefined;

    } catch (error: any) {
      logError(error as Error, 'Failed to send message to Rumble');
      return undefined;
    }
  }

  async editMessage(_messageId: string, _newContent: string): Promise<boolean> {
    // Rumble doesn't support message editing
    logger.debug('Rumble does not support message editing');
    return false;
  }

  async deleteMessage(messageId: string, _channelId?: string): Promise<boolean> {
    const chatId = config.rumble?.chatId;
    if (!chatId || !/^\d+$/.test(messageId)) {
      logger.warn(`[RUMBLE DELETE] Cannot delete without numeric chat/message IDs (message: ${messageId})`);
      return false;
    }
    return rumbleCookieManager.deleteMessageViaBrowser(messageId, chatId);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onDelete(_handler: DeleteHandler): void {
    // stored for future use
  }

  getStatus(): ServiceStatus {
    return this.status;
  }
}

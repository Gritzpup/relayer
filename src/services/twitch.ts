import * as tmi from 'tmi.js';
import { config } from '../config';
import { Platform, RelayMessage, MessageHandler, PlatformService, ServiceStatus, Attachment } from '../types';
import { logger, logPlatformMessage, logError } from '../utils/logger';
import { ReconnectManager } from '../utils/reconnect';
import { TwitchAPI } from './twitchApi';

interface RecentMessage {
  id: string;
  author: string;
  content: string;
  timestamp: Date;
}

export class TwitchService implements PlatformService {
  platform = Platform.Twitch;
  private client: tmi.Client;
  private messageHandler?: MessageHandler;
  private reconnectManager: ReconnectManager;
  private isConnecting: boolean = false;
  private recentMessages: Map<string, RecentMessage> = new Map(); // Key: author (lowercase)
  private api?: TwitchAPI;
  private useApi: boolean = false;
  private status: ServiceStatus = {
    platform: Platform.Twitch,
    connected: false,
    messagesSent: 0,
    messagesReceived: 0,
  };

  constructor() {
    this.client = new tmi.Client({
      options: { debug: false },
      connection: {
        reconnect: false,  // Disable tmi.js built-in reconnection - we handle it manually
        secure: true,
      },
      identity: {
        username: config.twitch.username,
        password: config.twitch.oauth,
      },
      channels: [config.twitch.channel],
    });

    this.reconnectManager = new ReconnectManager(
      'Twitch',
      () => this.connectInternal(),
      {
        initialDelay: 2000,
        maxDelay: 30000,
        factor: 2,
      }
    );

    // Initialize Twitch API if client ID is provided
    if (config.twitch.clientId && config.twitch.useApiForChat) {
      // Extract access token from oauth string
      const accessToken = config.twitch.oauth.startsWith('oauth:') 
        ? config.twitch.oauth.substring(6) 
        : config.twitch.oauth;
        
      this.api = new TwitchAPI(accessToken, config.twitch.clientId);
      logger.info('Twitch API client initialized');
    }

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connected', async (addr: string, port: number) => {
      logger.info(`Twitch connected to ${addr}:${port}`);
      this.status.connected = true;
      this.isConnecting = false;  // Reset connecting flag on successful connection
      
      // Check if we can use the Twitch API
      if (this.api) {
        try {
          const hasScopes = await this.api.hasRequiredScopes();
          if (hasScopes) {
            // Validate and get broadcaster ID
            const broadcasterId = await this.api.getBroadcaster(config.twitch.channel);
            if (broadcasterId) {
              this.useApi = true;
              logger.info('Twitch Chat API enabled - messages will be sent via API');
            } else {
              logger.warn('Failed to get broadcaster ID - falling back to TMI.js');
            }
          } else {
            logger.warn('Missing required scopes for Chat API - falling back to TMI.js');
          }
        } catch (error) {
          logger.error('Failed to initialize Twitch API - falling back to TMI.js:', error);
        }
      }
    });

    this.client.on('message', async (channel: string, tags: tmi.ChatUserstate, message: string, self: boolean) => {
      logger.debug(`Twitch raw message received - Channel: ${channel}, User: ${tags.username}, Self: ${self}, Message: "${message}"`);
      
      if (self) {
        logger.debug('Skipping self message');
        return;
      }
      
      // Skip messages from the bot account (backup check)
      if (tags.username === config.twitch.username) {
        logger.debug('Skipping message from bot account');
        return;
      }
      
      if (channel !== `#${config.twitch.channel}`) {
        logger.debug(`Skipping message from wrong channel: ${channel} (expected #${config.twitch.channel})`);
        return;
      }
      
      // Check if this is a relayed message (has platform prefix with or without emoji)
      // Pattern: [emoji] [Platform] username: message or just [Platform] username: message
      const relayPattern = /^(?:[^\[]*)?(?:\[(Discord|Telegram)\]\s+)([^:]+):\s*(.*)$/;
      const relayMatch = message.match(relayPattern);
      
      if (relayMatch) {
        logger.debug('Processing relayed message for reply tracking');
        const platform = relayMatch[1];
        const originalAuthor = relayMatch[2].trim();
        const originalContent = relayMatch[3];
        const timestamp = new Date();
        
        // Store with the original author's name for reply detection
        this.storeRecentMessage(
          `${platform}-${Date.now()}`, // Synthetic ID
          originalAuthor,
          originalContent,
          timestamp
        );
        logger.debug(`Stored relayed message from ${originalAuthor} for reply tracking`);
        return; // Skip relaying it back
      }

      this.status.messagesReceived++;
      const username = tags.username || 'Unknown';
      logPlatformMessage('Twitch', 'in', message, username);

      if (this.messageHandler) {
        logger.debug('Calling message handler for Twitch message');
        const relayMessage = this.convertMessage(tags, message);
        try {
          await this.messageHandler(relayMessage);
        } catch (error) {
          logError(error as Error, 'Twitch message handler');
        }
      } else {
        logger.warn('No message handler set for Twitch');
      }
    });

    this.client.on('disconnected', (reason: string) => {
      logger.warn(`Twitch disconnected: ${reason}`);
      this.status.connected = false;
      this.isConnecting = false;  // Reset connecting flag on disconnect
      this.status.lastError = reason;
      // Only schedule reconnect if not already handling it
      if (reason && reason !== 'Connection closed.') {
        this.reconnectManager.scheduleReconnect();
      }
    });

    this.client.on('notice', (_channel: string, msgid: string, message: string) => {
      logger.warn(`Twitch notice [${msgid}]: ${message}`);
    });

    this.client.on('join', (channel: string, username: string, self: boolean) => {
      if (self) {
        logger.info(`Twitch bot successfully joined channel: ${channel}`);
      } else {
        logger.debug(`User ${username} joined ${channel}`);
      }
    });

    this.client.on('part', (channel: string, _username: string, self: boolean) => {
      if (self) {
        logger.warn(`Twitch bot left channel: ${channel}`);
      }
    });

    // Note: tmi.js doesn't expose a general error event - errors are handled through disconnected event
  }

  private async connectInternal(): Promise<void> {
    // Prevent duplicate connection attempts
    if (this.isConnecting || this.status.connected) {
      logger.debug('Twitch: Already connecting or connected, skipping connection attempt');
      return;
    }
    
    this.isConnecting = true;
    
    try {
      // Disconnect any existing connection first
      if (this.client.readyState() === 'OPEN' || this.client.readyState() === 'CONNECTING') {
        try {
          await this.client.disconnect();
        } catch (err) {
          // Ignore disconnect errors during cleanup
        }
      }
      
      await this.client.connect();
    } catch (error) {
      this.isConnecting = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Twitch connection error: ${errorMessage}`);
      throw error;
    }
  }

  async connect(): Promise<void> {
    await this.reconnectManager.connect();
  }

  async disconnect(): Promise<void> {
    this.reconnectManager.stop();
    this.isConnecting = false;
    
    try {
      if (this.client.readyState() === 'OPEN') {
        await this.client.disconnect();
      }
    } catch (error) {
      // Log but don't throw - we're disconnecting anyway
      logger.debug('Error during Twitch disconnect (ignored):', error);
    }
    
    // Clear recent messages on disconnect
    this.recentMessages.clear();
    
    this.status.connected = false;
    logger.info('Twitch disconnected');
  }

  async sendMessage(content: string, attachments?: Attachment[], _replyToMessageId?: string): Promise<string | undefined> {
    const channel = `#${config.twitch.channel}`;
    
    let messageContent = content;
    
    if (attachments && attachments.length > 0) {
      const attachmentInfo = attachments.map(att => {
        if (att.url) {
          return att.url;
        } else {
          return `[${att.type}]`;
        }
      }).join(' ');
      
      messageContent = `${content} ${attachmentInfo}`.trim();
    }

    // Note: Twitch doesn't support replies, so replyToMessageId is ignored
    // Reply formatting is handled by the formatter which adds @mentions

    let messageId: string | undefined;
    
    // Try to use the API if available
    if (this.useApi && this.api) {
      try {
        messageId = await this.api.sendChatMessage(config.twitch.channel, messageContent);
        if (messageId) {
          logger.debug(`Sent message via Twitch API with ID: ${messageId}`);
        }
      } catch (error) {
        logger.warn('Failed to send via API, falling back to TMI.js:', error);
        // Fall back to TMI.js
        await this.client.say(channel, messageContent);
      }
    } else {
      // Use TMI.js
      await this.client.say(channel, messageContent);
    }
    
    this.status.messagesSent++;
    logPlatformMessage('Twitch', 'out', messageContent);
    
    return messageId;
  }

  async editMessage(_messageId: string, _newContent: string): Promise<boolean> {
    // Twitch doesn't support message editing
    // We could send a new message with "(edited)" prefix, but that would create noise
    logger.debug('Twitch doesn\'t support message editing');
    return false;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  getStatus(): ServiceStatus {
    return { ...this.status };
  }

  private convertMessage(tags: tmi.ChatUserstate, message: string): RelayMessage {
    const id = tags.id || Date.now().toString();
    const author = tags.username || 'Unknown';
    const timestamp = new Date(parseInt(tags['tmi-sent-ts'] || Date.now().toString()));
    
    // Store this message in recent messages for future reply detection
    this.storeRecentMessage(id, author, message, timestamp);
    
    // Check if this message is a reply (starts with @username)
    let replyTo: RelayMessage['replyTo'] | undefined;
    let actualContent = message;
    
    const mentionMatch = message.match(/^@(\w+):?\s*(.*)$/);
    if (mentionMatch) {
      const mentionedUser = mentionMatch[1].toLowerCase();
      actualContent = mentionMatch[2] || message;
      
      // Look for recent message from mentioned user
      const recentMessage = this.recentMessages.get(mentionedUser);
      if (recentMessage) {
        // Check if message is recent enough (within 5 minutes)
        const timeDiff = timestamp.getTime() - recentMessage.timestamp.getTime();
        if (timeDiff < 5 * 60 * 1000) { // 5 minutes
          replyTo = {
            messageId: recentMessage.id,
            author: recentMessage.author,
            content: recentMessage.content,
          };
          logger.debug(`Detected Twitch reply from ${author} to ${recentMessage.author}`);
        }
      }
    }
    
    return {
      id,
      platform: Platform.Twitch,
      author,
      content: actualContent,
      timestamp,
      replyTo,
      raw: { tags, message },
    };
  }
  
  private storeRecentMessage(id: string, author: string, content: string, timestamp: Date): void {
    const authorKey = author.toLowerCase();
    this.recentMessages.set(authorKey, { id, author, content, timestamp });
    
    // Clean up old messages (older than 10 minutes)
    const cutoffTime = timestamp.getTime() - 10 * 60 * 1000;
    for (const [key, msg] of this.recentMessages.entries()) {
      if (msg.timestamp.getTime() < cutoffTime) {
        this.recentMessages.delete(key);
      }
    }
  }
}
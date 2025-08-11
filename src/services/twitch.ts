import * as tmi from 'tmi.js';
import { config } from '../config';
import { Platform, RelayMessage, MessageHandler, DeleteHandler, PlatformService, ServiceStatus, Attachment } from '../types';
import { logger, logPlatformMessage, logError } from '../utils/logger';
import { ReconnectManager } from '../utils/reconnect';
import { TwitchAPI } from './twitchApi';
import { twitchTokenManager } from './twitchTokenManager';

interface RecentMessage {
  id: string;
  author: string;
  content: string;
  timestamp: Date;
  platform?: Platform; // Track which platform this message came from
  mappingId?: string; // Store the MessageMapper ID if available
}

export class TwitchService implements PlatformService {
  platform = Platform.Twitch;
  private client: tmi.Client;
  private messageHandler?: MessageHandler;
  private deleteHandler?: DeleteHandler;
  private reconnectManager: ReconnectManager;
  private isConnecting: boolean = false;
  private recentMessages: Map<string, RecentMessage> = new Map(); // Key: author (lowercase)
  private continuedMessages: Map<string, string[]> = new Map(); // Track continued message IDs for deletion
  private api?: TwitchAPI;
  private useApi: boolean = false;
  private status: ServiceStatus = {
    platform: Platform.Twitch,
    connected: false,
    messagesSent: 0,
    messagesReceived: 0,
  };

  constructor() {
    // Initialize with config values first - will be updated when token manager initializes
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
      logger.info(`TWITCH MSG: Channel: ${channel}, User: ${tags.username}, Self: ${self}, Message: "${message.substring(0, 50)}..."`);
      logger.info(`TWITCH MSG: Current stored messages: ${this.recentMessages.size}`);
      
      if (channel !== `#${config.twitch.channel}`) {
        logger.debug(`Skipping message from wrong channel: ${channel} (expected #${config.twitch.channel})`);
        return;
      }
      
      // Check if this is a relayed message (has platform prefix with or without emoji)
      // Pattern handles Unicode bold formatting used by the bot
      // Example: "🔵 [𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗺] 𝗚𝗿𝗶𝘁𝘇𝗽𝘂𝗽: test"
      const relayPattern = /^[🟦🔵💙🟢💚🔴❤️]\s*\[([^\]]+)\]\s*([^:]+):\s*(.*)$/;
      const relayMatch = message.match(relayPattern);
      
      logger.info(`RELAY CHECK: Testing message: "${message}"`);
      logger.info(`RELAY CHECK: Match result: ${relayMatch ? 'YES' : 'NO'}`);
      
      if (relayMatch) {
        // Extract platform name (in Unicode bold), author (in Unicode bold), and content
        const boldPlatformStr = relayMatch[1];
        const boldAuthor = relayMatch[2].trim();
        const originalContent = relayMatch[3];
        
        // Convert Unicode bold back to regular text for platform detection
        const platformStr = this.fromUnicodeBold(boldPlatformStr);
        const originalAuthor = this.fromUnicodeBold(boldAuthor);
        
        logger.info(`RELAY CHECK: Platform=${platformStr}, Author=${originalAuthor}, Content=${originalContent}`);
        const timestamp = new Date();
        
        // Store with the original author's name for reply detection
        const messageId = `${platformStr}-${Date.now()}`;
        // Convert platform string to enum
        const sourcePlatform = platformStr as Platform;
        this.storeRecentMessage(
          messageId,
          originalAuthor,
          originalContent,
          timestamp,
          sourcePlatform
        );
        logger.info(`RELAY TRACKING: Stored message from ${originalAuthor} with content: "${originalContent.substring(0, 30)}..."`);
        logger.info(`RELAY TRACKING: Recent messages now has ${this.recentMessages.size} entries`);
        return; // Skip relaying it back
      }
      
      // Skip self messages (but only after checking for relayed messages)
      if (self) {
        logger.debug('Skipping self message');
        return;
      }
      
      // Skip messages from the bot account (backup check) - but only after checking for relayed messages
      if (tags.username === config.twitch.username) {
        logger.debug('Skipping message from bot account');
        return;
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
      
      // Get fresh token from token manager
      try {
        const accessToken = await twitchTokenManager.getAccessToken();
        const oauthToken = `oauth:${accessToken}`;
        
        // Recreate client with new token
        this.client = new tmi.Client({
          options: { debug: false },
          connection: {
            reconnect: false,
            secure: true,
          },
          identity: {
            username: config.twitch.username,
            password: oauthToken,
          },
          channels: [config.twitch.channel],
        });
        
        // Re-setup event handlers for new client instance
        this.setupEventHandlers();
        
        // Update API client if it exists
        if (this.api) {
          this.api.updateToken(accessToken);
        }
      } catch (tokenError) {
        logger.error('Failed to get Twitch access token:', tokenError);
        throw tokenError;
      }
      
      await this.client.connect();
    } catch (error) {
      this.isConnecting = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Twitch connection error: ${errorMessage}`);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    // Initialize token manager
    try {
      await twitchTokenManager.initialize();
      
      // Set up callback to update API token when refreshed
      twitchTokenManager.onTokenRefresh((accessToken: string) => {
        if (this.api) {
          this.api.updateToken(accessToken);
          logger.info('Twitch API token updated after refresh');
        }
      });
      
      twitchTokenManager.startAutoRefresh();
      logger.info('Twitch token manager initialized');
    } catch (error) {
      logger.error('Failed to initialize Twitch token manager:', error);
      // Continue with existing token from .env
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
    this.continuedMessages.clear();
    
    this.status.connected = false;
    logger.info('Twitch disconnected');
  }

  async sendMessage(content: string, attachments?: Attachment[], _replyToMessageId?: string, _channelId?: string, originalMessage?: RelayMessage): Promise<string | undefined> {
    const channel = `#${config.twitch.channel}`;
    const MAX_TWITCH_LENGTH = 500;
    
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

    // Split long messages into multiple parts
    const messageParts: string[] = [];
    
    if (messageContent.length <= MAX_TWITCH_LENGTH) {
      messageParts.push(messageContent);
    } else {
      // Calculate how much space we need for suffixes/prefixes
      const continuedPrefix = '(continued) ';
      
      // First part - just cut at max length, no suffix needed since we're sending the rest
      messageParts.push(messageContent.substring(0, MAX_TWITCH_LENGTH));
      
      // Subsequent parts
      let remainingContent = messageContent.substring(MAX_TWITCH_LENGTH);
      while (remainingContent.length > 0) {
        const continuedMaxLength = MAX_TWITCH_LENGTH - continuedPrefix.length;
        const part = continuedPrefix + remainingContent.substring(0, continuedMaxLength);
        messageParts.push(part);
        remainingContent = remainingContent.substring(continuedMaxLength);
      }
    }

    let firstMessageId: string | undefined;
    const allMessageIds: string[] = [];
    
    // Send all message parts
    for (let i = 0; i < messageParts.length; i++) {
      const part = messageParts[i];
      let messageId: string | undefined;
      
      // Try to use the API if available
      if (this.useApi && this.api) {
        try {
          messageId = await this.api.sendChatMessage(config.twitch.channel, part);
          if (messageId) {
            logger.debug(`Sent message part ${i + 1}/${messageParts.length} via Twitch API with ID: ${messageId}`);
          }
        } catch (error) {
          logger.warn('Failed to send via API, falling back to TMI.js:', error);
          // Fall back to TMI.js
          await this.client.say(channel, part);
        }
      } else {
        // Use TMI.js
        await this.client.say(channel, part);
      }
      
      // Collect all message IDs
      if (messageId) {
        allMessageIds.push(messageId);
      }
      
      // Store the first message ID to return
      if (i === 0 && messageId) {
        firstMessageId = messageId;
        
        // If this is a relayed message from another platform, store the original author info
        if (originalMessage && originalMessage.platform !== Platform.Twitch) {
          logger.info(`TWITCH SEND: Storing relayed message from ${originalMessage.author} (${originalMessage.platform}) with ID ${messageId}`);
          
          // Store with the original author's name for reply detection
          this.storeRecentMessage(
            messageId,
            originalMessage.author,
            originalMessage.content,
            new Date(),
            originalMessage.platform
          );
        }
      }
      
      this.status.messagesSent++;
      logPlatformMessage('Twitch', 'out', part);
      
      // Add a small delay between messages to avoid rate limiting
      if (i < messageParts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // If we sent multiple parts, track the continued message IDs for deletion
    if (firstMessageId && allMessageIds.length > 1) {
      const continuedIds = allMessageIds.slice(1); // All IDs except the first
      this.continuedMessages.set(firstMessageId, continuedIds);
      logger.info(`TWITCH SPLIT: Tracked ${continuedIds.length} continued messages for parent ${firstMessageId}`);
    }
    
    return firstMessageId;
  }

  async editMessage(_messageId: string, _newContent: string): Promise<boolean> {
    // Twitch doesn't support message editing
    // We could send a new message with "(edited)" prefix, but that would create noise
    logger.debug('Twitch doesn\'t support message editing');
    return false;
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    const channel = config.twitch.channel;
    
    // Check if this message has continued parts
    const continuedIds = this.continuedMessages.get(messageId);
    
    // Try to use the API if available (requires moderator:manage:chat_messages scope)
    if (this.useApi && this.api) {
      try {
        // Delete the main message
        const success = await this.api.deleteChatMessage(channel, messageId);
        if (!success) {
          logger.warn(`Failed to delete message ${messageId} via API`);
          return false;
        }
        
        // Delete all continued messages if any
        if (continuedIds && continuedIds.length > 0) {
          logger.info(`TWITCH DELETE: Deleting ${continuedIds.length} continued messages for ${messageId}`);
          for (const continuedId of continuedIds) {
            try {
              await this.api.deleteChatMessage(channel, continuedId);
              logger.debug(`Deleted continued message ${continuedId}`);
            } catch (error) {
              logger.error(`Failed to delete continued message ${continuedId}: ${error}`);
            }
          }
          // Clean up the tracking
          this.continuedMessages.delete(messageId);
        }
        
        return true;
      } catch (error) {
        logger.error(`Error deleting message via API: ${error}`);
        return false;
      }
    }
    
    // TMI.js delete functionality is deprecated as of February 2023
    // Twitch removed support for IRC-based moderation commands
    logger.warn(`Cannot delete Twitch message ${messageId}: TMI.js delete is deprecated. Use Twitch API with moderator:manage:chat_messages scope instead.`);
    return false;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onDelete(handler: DeleteHandler): void {
    this.deleteHandler = handler;
  }

  getStatus(): ServiceStatus {
    return { ...this.status };
  }

  private convertMessage(tags: tmi.ChatUserstate, message: string): RelayMessage {
    const id = tags.id || Date.now().toString();
    const author = tags.username || 'Unknown';
    const timestamp = new Date(parseInt(tags['tmi-sent-ts'] || Date.now().toString()));
    
    logger.info(`CONVERT MSG: Processing message from ${author}: "${message.substring(0, 30)}..."`);
    
    // Store this message in recent messages for future reply detection
    this.storeRecentMessage(id, author, message, timestamp);
    
    // Check if this message is a reply (starts with @username)
    let replyTo: RelayMessage['replyTo'] | undefined;
    let actualContent = message;
    
    const mentionMatch = message.match(/^@(\w+):?\s*(.*)$/);
    if (mentionMatch) {
      const mentionedUser = mentionMatch[1].toLowerCase();
      actualContent = mentionMatch[2] || ''; // Remove the @mention from the content
      
      // If the content is empty after removing mention, use the full message
      if (!actualContent.trim()) {
        actualContent = message;
      }
      
      logger.info(`REPLY DETECTION: Looking for messages from @${mentionedUser}`);
      logger.info(`REPLY DETECTION: Current message keys: [${Array.from(this.recentMessages.keys()).join(', ')}]`);
      logger.info(`REPLY DETECTION: Total messages stored: ${this.recentMessages.size}`);
      
      // Debug: Show all stored messages
      for (const [key, msg] of this.recentMessages.entries()) {
        logger.info(`  - Key: "${key}", Author: "${msg.author}", Content: "${msg.content.substring(0, 30)}..."`);
      }
      
      // Look for the message being replied to
      let recentMessage: RecentMessage | undefined;
      
      // Check if user is replying to the bot itself
      if (mentionedUser === config.twitch.username.toLowerCase()) {
        logger.info(`REPLY DETECTION: User is replying to the bot, finding most recent relayed message`);
        
        // Find the most recent message from another platform
        let mostRecentRelayed: RecentMessage | undefined;
        const currentTime = timestamp.getTime();
        
        for (const [key, msg] of this.recentMessages.entries()) {
          // Skip if it's too old
          const timeDiff = currentTime - msg.timestamp.getTime();
          if (timeDiff > 5 * 60 * 1000) {
            logger.info(`Skipping old message from ${msg.author} (${timeDiff/1000}s old)`);
            continue;
          }
          
          // Check if this message is from another platform
          logger.info(`REPLY CHECK: Checking message: id=${msg.id}, platform=${msg.platform}, author=${msg.author}, hasValidPlatform=${!!msg.platform}`);
          if (msg.platform && msg.platform !== Platform.Twitch) {
            // Update most recent if this is newer
            if (!mostRecentRelayed || msg.timestamp > mostRecentRelayed.timestamp) {
              mostRecentRelayed = msg;
              logger.info(`REPLY CHECK: Found relayed message from ${msg.author} (${msg.platform})`);
            }
          } else {
            logger.info(`REPLY CHECK: Skipping - platform=${msg.platform}, isTwitch=${msg.platform === Platform.Twitch}`);
          }
        }
        
        if (mostRecentRelayed) {
          recentMessage = mostRecentRelayed;
          logger.info(`Found most recent relayed message from ${mostRecentRelayed.author}`);
        } else {
          logger.debug(`No recent relayed messages found for bot reply`);
        }
      } else {
        // Look for recent message from mentioned user
        recentMessage = this.recentMessages.get(mentionedUser);
        
        if (recentMessage) {
          logger.info(`Found direct message from ${mentionedUser}`);
        } else {
          // If not found directly, search all messages case-insensitively
          logger.debug(`No direct message found from ${mentionedUser}, searching all messages`);
          
          // Search through all recent messages
          for (const [key, msg] of this.recentMessages.entries()) {
            // Skip if it's too old
            const timeDiff = timestamp.getTime() - msg.timestamp.getTime();
            if (timeDiff > 5 * 60 * 1000) continue; // Skip messages older than 5 minutes
            
            // Check if this message author matches (case insensitive)
            logger.info(`DIRECT REPLY CHECK: Comparing author "${msg.author.toLowerCase()}" with mentioned "${mentionedUser}"`);
            if (msg.author.toLowerCase() === mentionedUser) {
              recentMessage = msg;
              logger.info(`DIRECT REPLY: Found message from ${msg.author} (matched ${mentionedUser}) with key ${key}, platform=${msg.platform || 'Twitch'}`);
              break;
            }
          }
        }
      }
      
      if (recentMessage) {
        // Check if message is recent enough (within 5 minutes)
        const timeDiff = timestamp.getTime() - recentMessage.timestamp.getTime();
        if (timeDiff < 5 * 60 * 1000) { // 5 minutes
          replyTo = {
            messageId: recentMessage.id,
            author: recentMessage.author,
            content: recentMessage.content,
            platform: recentMessage.platform, // Include the platform information
          };
          logger.info(`TWITCH REPLY DETECTED: ${author} is replying to ${recentMessage.author}${recentMessage.platform ? ` (from ${recentMessage.platform})` : ''}`);
          logger.info(`TWITCH REPLY CONTENT: Original: "${recentMessage.content.substring(0, 50)}..." Reply: "${actualContent.substring(0, 50)}..."`);
        }
      } else {
        logger.info(`TWITCH REPLY: No recent message found from @${mentionedUser} for reply detection`);
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
      channelName: 'general', // Twitch messages go to general channel
    };
  }
  
  private fromUnicodeBold(text: string): string {
    const boldMap: { [key: string]: string } = {
      '𝐀': 'A', '𝐁': 'B', '𝐂': 'C', '𝐃': 'D', '𝐄': 'E', '𝐅': 'F', '𝐆': 'G', '𝐇': 'H', '𝐈': 'I',
      '𝐉': 'J', '𝐊': 'K', '𝐋': 'L', '𝐌': 'M', '𝐍': 'N', '𝐎': 'O', '𝐏': 'P', '𝐐': 'Q', '𝐑': 'R',
      '𝐒': 'S', '𝐓': 'T', '𝐔': 'U', '𝐕': 'V', '𝐖': 'W', '𝐗': 'X', '𝐘': 'Y', '𝐙': 'Z',
      '𝐚': 'a', '𝐛': 'b', '𝐜': 'c', '𝐝': 'd', '𝐞': 'e', '𝐟': 'f', '𝐠': 'g', '𝐡': 'h', '𝐢': 'i',
      '𝐣': 'j', '𝐤': 'k', '𝐥': 'l', '𝐦': 'm', '𝐧': 'n', '𝐨': 'o', '𝐩': 'p', '𝐪': 'q', '𝐫': 'r',
      '𝐬': 's', '𝐭': 't', '𝐮': 'u', '𝐯': 'v', '𝐰': 'w', '𝐱': 'x', '𝐲': 'y', '𝐳': 'z',
      '𝟎': '0', '𝟏': '1', '𝟐': '2', '𝟑': '3', '𝟒': '4', '𝟓': '5', '𝟔': '6', '𝟕': '7', '𝟖': '8', '𝟗': '9'
    };
    
    return text.split('').map(char => boldMap[char] || char).join('');
  }

  private storeRecentMessage(id: string, author: string, content: string, timestamp: Date, platform?: Platform, mappingId?: string): void {
    const authorKey = author.toLowerCase();
    logger.info(`STORE MESSAGE: Storing with key="${authorKey}" author="${author}" content="${content.substring(0, 50)}..."${platform ? ` from platform=${platform}` : ''}`);
    this.recentMessages.set(authorKey, { id, author, content, timestamp, platform, mappingId });
    logger.info(`STORE MESSAGE: Map size after store: ${this.recentMessages.size}`);
    
    // Clean up old messages (older than 10 minutes)
    const cutoffTime = timestamp.getTime() - 10 * 60 * 1000;
    let deletedCount = 0;
    for (const [key, msg] of this.recentMessages.entries()) {
      if (msg.timestamp.getTime() < cutoffTime) {
        this.recentMessages.delete(key);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      logger.info(`STORE MESSAGE: Cleaned up ${deletedCount} old messages`);
    }
  }
}
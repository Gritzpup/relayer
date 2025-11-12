import axios from 'axios';
import { WebSocket } from 'ws';
import { config } from '../config';
import { Platform, RelayMessage, MessageHandler, DeleteHandler, PlatformService, ServiceStatus, Attachment } from '../types';
import { logger, logPlatformMessage, logError } from '../utils/logger';
import { ReconnectManager } from '../utils/reconnect';
import { kickTokenManager } from './kickTokenManager';
import { KickAPI } from './kickApi';

interface KickUser {
  id: number;
  username: string;
  identity?: {
    color?: string;
    badges?: any[];
  };
}

interface KickChatMessage {
  id: string;
  chatroom_id: number;
  content: string;
  type: string;
  created_at: string;
  sender: KickUser;
}

interface KickChannelInfo {
  id: number;
  user_id: number;
  slug: string;
  chatroom?: {
    id: number;
    chatable_type: string;
    channel_id: number;
    settings?: any;
  };
}

export class KickService implements PlatformService {
  platform = Platform.Kick;
  private messageHandler?: MessageHandler;
  private deleteHandler?: DeleteHandler;
  private reconnectManager: ReconnectManager;
  private isConnecting: boolean = false;
  private ws: WebSocket | null = null;
  private channelInfo: KickChannelInfo | null = null;
  private chatroomId: number | null = null;
  private channelId: string | null = null;
  private api: KickAPI;
  private status: ServiceStatus = {
    platform: Platform.Kick,
    connected: false,
    messagesSent: 0,
    messagesReceived: 0,
  };

  constructor() {
    this.api = new KickAPI();
    this.reconnectManager = new ReconnectManager(
      'Kick',
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
      logger.debug('Kick connection already in progress');
      return;
    }

    this.isConnecting = true;
    logger.info('Connecting to Kick...');

    try {
      // Always initialize token manager to load latest token from file
      // This ensures we get refreshed tokens even if .env is cached
      await kickTokenManager.initialize();

      await this.connectInternal();
    } catch (error) {
      this.isConnecting = false;
      this.status.connected = false;
      this.status.lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to connect to Kick - relayer will continue without Kick', error);
      logger.warn('Kick authentication/connection failed - relayer will continue without Kick integration');
      // Don't throw - just continue without Kick
    }
  }

  private async connectInternal(): Promise<void> {
    try {
      // Get channel information first
      await this.getChannelInfo();

      if (!this.channelId && !this.chatroomId) {
        throw new Error('Could not get channel or chatroom ID for Kick channel');
      }

      // Get broadcaster user ID from channel info
      const broadcasterUserId = this.channelInfo?.user_id;
      if (!broadcasterUserId) {
        throw new Error('Failed to get broadcaster user_id from channel info');
      }

      logger.info(`Kick broadcaster user ID: ${broadcasterUserId}`);

      // Subscribe to Kick events via webhooks
      // The webhook URL must be publicly accessible
      const webhookUrl = config.kick?.webhookUrl || process.env.KICK_WEBHOOK_URL;

      if (webhookUrl) {
        logger.info(`Subscribing to Kick events with webhook URL: ${webhookUrl}`);

        // Subscribe to chat.message.sent event
        const subscription = await this.api.subscribeToEvents(
          webhookUrl,
          broadcasterUserId,
          [{ name: 'chat.message.sent', version: 1 }]
        );

        if (subscription) {
          logger.info('Kick event subscription successful:', subscription);
        } else {
          logger.warn('Kick event subscription may have failed - check logs');
        }
      } else {
        logger.warn('No KICK_WEBHOOK_URL configured - will not receive Kick messages');
        logger.warn('To receive Kick messages, set KICK_WEBHOOK_URL to your public webhook endpoint');
      }

      // Optional: Connect to WebSocket for real-time status (not required for chat messages)
      // await this.connectWebSocket();

      this.status.connected = true;
      this.isConnecting = false;
      logger.info('Successfully connected to Kick');

    } catch (error) {
      this.status.connected = false;
      this.isConnecting = false;
      this.status.lastError = error instanceof Error ? error.message : 'Connection failed';
      throw error;
    }
  }

  private async getChannelInfo(): Promise<void> {
    try {
      const channelSlug = config.kick?.channel || 'gritzpup'; // Use your channel
      logger.info(`Getting Kick channel info for: ${channelSlug}`);

      const response = await axios.get(`https://api.kick.com/private/v1/channels/${channelSlug}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
        },
        timeout: 10000,
      });

      // Store the channel data from response - user_id is at account.user.id
      const accountData = response.data?.data?.account;

      // Debug: Log the full user object to find numeric ID
      logger.debug(`Kick account.user object:`, JSON.stringify(accountData?.user, null, 2));

      this.channelInfo = {
        id: accountData?.channel?.id,
        user_id: accountData?.user?.id,  // user_id is at account.user.id
        slug: accountData?.channel?.slug,
        chatroom: accountData?.channel?.chatroom
      };

      logger.info(`Kick broadcaster user ID: ${this.channelInfo.user_id}`);

      // Extract channel ID from response - this is the full channel ID like "channel_01K4Q26GP9CEGRZXCB3P6BF4CT"
      const fullChannelId = accountData?.channel?.id || null;

      // For chatroom subscriptions, we need just the ID part without "channel_" prefix
      if (fullChannelId && fullChannelId.startsWith('channel_')) {
        this.channelId = fullChannelId.replace('channel_', '');
        logger.info(`Extracted chatroom ID for Pusher: ${this.channelId}`);
      } else {
        this.channelId = fullChannelId;
      }

      logger.info(`Kick channel info - Will subscribe to chatrooms.${this.channelId}.v2`);

    } catch (error) {
      logger.error('Failed to get Kick channel info:', error);
      throw new Error(`Failed to get channel info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Kick uses Pusher WebSocket for real-time chat - updated app key
        const wsUrl = `wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false`;
        
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', async () => {
          logger.info('Kick WebSocket connected');

          // Get access token for authenticated subscriptions
          let accessToken = config.kick?.token;
          const socketId = await new Promise<string>((resolveSocketId) => {
            const connectionHandler = (data: Buffer) => {
              const msg = JSON.parse(data.toString());
              if (msg.event === 'pusher:connection_established') {
                const connData = JSON.parse(msg.data);
                resolveSocketId(connData.socket_id);
              }
            };
            this.ws?.once('message', connectionHandler);
          });

          logger.info(`Got Pusher socket ID: ${socketId}`);

          // Subscribe to the chatroom channel
          // channelId at this point should be the alphanumeric ID without "channel_" prefix
          if (this.channelId) {
            // Try authenticated channel subscription if we have a token
            const chatroomChannel = `chatrooms.${this.channelId}.v2`;

            if (accessToken) {
              // Create auth signature for private channel
              const authString = `${socketId}:${chatroomChannel}`;
              const authSignature = `${accessToken}:${authString}`; // Simplified - Kick might need HMAC

              const chatroomSubscribeMessage = {
                event: 'pusher:subscribe',
                data: {
                  auth: authSignature,
                  channel: chatroomChannel
                }
              };
              this.ws?.send(JSON.stringify(chatroomSubscribeMessage));
              logger.info(`Subscribed to Kick chatroom with auth: ${chatroomChannel}`);
            } else {
              // Try without auth
              const chatroomSubscribeMessage = {
                event: 'pusher:subscribe',
                data: {
                  channel: chatroomChannel
                }
              };
              this.ws?.send(JSON.stringify(chatroomSubscribeMessage));
              logger.info(`Subscribed to Kick chatroom (no auth): ${chatroomChannel}`);
            }
          } else {
            logger.error('No channel ID available for Kick subscription');
          }

          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleWebSocketMessage(data.toString());
        });

        this.ws.on('close', (code, reason) => {
          logger.warn(`Kick WebSocket closed: ${code} - ${reason}`);
          this.status.connected = false;
          this.reconnectManager.scheduleReconnect();
        });

        this.ws.on('error', (error) => {
          logger.error('Kick WebSocket error:', error);
          this.status.lastError = error.message;
          reject(error);
        });

        // Timeout for connection
        setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  private handleWebSocketMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Debug log all incoming WebSocket messages
      logger.info(`[KICK WS] Received event: ${message.event} on channel: ${message.channel || 'N/A'}`);
      logger.debug(`[KICK WS] Full message: ${JSON.stringify(message)}`);

      // Handle Pusher protocol messages
      if (message.event === 'pusher:connection_established') {
        logger.info('Kick Pusher connection established');
        return;
      }

      if (message.event === 'pusher:subscription_succeeded' || message.event === 'pusher_internal:subscription_succeeded') {
        logger.info(`Kick subscription successful for channel: ${message.channel}`);
        return;
      }

      if (message.event === 'pusher:subscription_error' || message.event === 'pusher:error') {
        logger.error(`Kick error for channel: ${message.channel}, data: ${JSON.stringify(message.data)}`);
        return;
      }

      // Handle chat messages - try different event patterns
      if (message.event === 'App\\Events\\ChatMessageSentEvent' ||
          message.event === 'ChatMessageSentEvent' ||
          message.event.includes('ChatMessage') ||
          message.event.includes('Message')) {
        logger.info(`Kick chat message event received: ${message.event}`);
        this.handleChatMessage(message.data);
      } else {
        logger.warn(`[KICK WS] Unhandled event type: ${message.event}`);
      }

    } catch (error) {
      logger.error('Error parsing Kick WebSocket message:', error);
    }
  }

  private async handleChatMessage(data: string): Promise<void> {
    try {
      const messageData: KickChatMessage = JSON.parse(data);
      
      // Skip bot's own messages
      if (messageData.sender.username === config.kick?.username) {
        return;
      }

      this.status.messagesReceived++;
      logPlatformMessage('Kick', 'in', messageData.content, messageData.sender.username);

      if (this.messageHandler) {
        const relayMessage: RelayMessage = {
          id: messageData.id,
          platform: Platform.Kick,
          author: messageData.sender.username,
          content: messageData.content,
          timestamp: new Date(messageData.created_at),
          channelName: 'general', // Kick streams have one main chat
          raw: messageData,
        };

        await this.messageHandler(relayMessage);
      }

    } catch (error) {
      logError(error as Error, 'Error handling Kick chat message');
    }
  }

  async disconnect(): Promise<void> {
    logger.info('Disconnecting from Kick...');
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.status.connected = false;
    this.isConnecting = false;
  }

  async sendMessage(
    content: string, 
    attachments?: Attachment[], 
    replyToMessageId?: string,
    targetChannelId?: string,
    originalMessage?: RelayMessage
  ): Promise<string | undefined> {
    
    if (!this.status.connected) {
      logger.warn('Cannot send Kick message: Not connected');
      return;
    }

    try {
      const channelSlug = config.kick?.channel || 'gritzpup';
      const messageId = await this.api.sendChatMessage(channelSlug, content);
      
      if (messageId) {
        this.status.messagesSent++;
        logPlatformMessage('Kick', 'out', content, 'bot');
        return messageId;
      }
      
      return undefined;
      
    } catch (error) {
      logError(error as Error, 'Failed to send message to Kick');
      return;
    }
  }

  async editMessage(messageId: string, newContent: string): Promise<boolean> {
    // Kick doesn't support message editing for regular users
    logger.debug('Kick does not support message editing');
    return false;
  }

  async deleteMessage(messageId: string, channelId?: string): Promise<boolean> {
    // Kick message deletion would require moderator permissions and proper API auth
    logger.debug('Kick message deletion not implemented');
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
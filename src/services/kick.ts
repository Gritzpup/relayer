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
  user_id?: number;
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

      // Get broadcaster user ID from channel info (may be undefined if API format changed)
      const broadcasterUserId = this.channelInfo?.user_id;
      if (broadcasterUserId) {
        logger.info(`Kick broadcaster user ID (numeric): ${broadcasterUserId}`);
      } else {
        logger.warn('No numeric broadcaster user ID available - will subscribe without channel scope');
      }

      // Subscribe to Kick events via webhooks
      // The webhook URL must be publicly accessible
      const webhookUrl = config.kick?.webhookUrl || process.env.KICK_WEBHOOK_URL;

      if (webhookUrl) {
        logger.info(`Subscribing to Kick events with webhook URL: ${webhookUrl}`);

        // First, delete any existing subscriptions to avoid stale cached subscriptions
        // Kick's API may return the same cached subscription if we don't clean up first.
        // Handle multiple response formats: {data: [...]}, [...] direct array, or null.
        try {
          const existing = await this.api.getEventSubscriptions();
          let subscriptionIds: string[] = [];
          if (Array.isArray(existing)) {
            subscriptionIds = existing.map((s: any) => s.subscription_id).filter(Boolean);
          } else if (existing?.data && Array.isArray(existing.data)) {
            subscriptionIds = existing.data.map((s: any) => s.subscription_id).filter(Boolean);
          }
          // If we didn't find any via the response, try deleting the known stale ID directly
          if (subscriptionIds.length === 0) {
            // This subscription ID was created without broadcaster_user_id - delete it
            const knownId = '01KY0QPYV8BFPGCGQF5YK2HY5K';
            logger.info(`No subscriptions found in API response, attempting to delete known stale subscription: ${knownId}`);
            subscriptionIds = [knownId];
          }
          if (subscriptionIds.length > 0) {
            logger.info(`Deleting ${subscriptionIds.length} Kick subscription(s): ${subscriptionIds.join(', ')}`);
            await this.api.unsubscribeFromEvent(subscriptionIds);
          }
        } catch (cleanupError) {
          logger.warn('Error cleaning up old Kick subscriptions:', cleanupError);
        }

        // Subscribe to chat.message.sent event (include broadcaster_user_id if available)
        const subscription = await this.api.subscribeToEvents(
          webhookUrl,
          broadcasterUserId || undefined,
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

      // Connect WebSocket for real-time chat message reception
      // Using PUBLIC channel chatrooms.{id}.v2 - no Pusher auth needed!
      // This is more reliable than webhooks for receiving Kick messages
      try {
        await this.connectWebSocket();
      } catch (wsError) {
        logger.warn('Kick WebSocket connection failed - will rely on webhooks only:', wsError);
      }

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

      // Store the channel data from response
      const accountData = response.data?.data?.account;

      this.channelInfo = {
        id: accountData?.channel?.id,
        slug: accountData?.channel?.slug,
        chatroom: accountData?.channel?.chatroom
      };

      // Kick's private API now returns string IDs like "user_01K4Q..." not numeric IDs.
      // The subscription API needs the numeric user ID (e.g. 77854856 for Gritzpup).
      // Log the full account data to find where the numeric ID lives, then try
      // common paths: account.id, account.user_id, account.channel.user_id
      logger.info(`Kick account data: ${JSON.stringify(accountData, null, 2)}`);

      let numericUserId = Number(accountData?.channel?.user_id) ||
                           Number(accountData?.user?.numeric_id) ||
                           Number(accountData?.id);

      // If none of the private API fields work (Kick now uses string IDs), try extracting
      // the numeric user ID from the profile_picture URL which contains it (e.g. "/users/77854856/")
      if (!numericUserId) {
        const profilePic = accountData?.user?.profile_picture || accountData?.channel?.profile_picture || '';
        const picMatch = profilePic.match(/\/users\/(\d+)\//);
        if (picMatch) {
          numericUserId = parseInt(picMatch[1], 10);
          logger.info(`Extracted numeric user ID from profile picture: ${numericUserId}`);
        }
      }

      // If still no luck, try the public API user info
      if (!numericUserId) {
        try {
          const userInfo = await this.api.getUserInfo();
          logger.info(`Kick userInfo response: ${JSON.stringify(userInfo)}`);
          numericUserId = Number(userInfo?.id) || Number(userInfo?.data?.id) || Number(userInfo?.user?.id);
        } catch (userInfoError) {
          logger.warn('Failed to get user info from public API:', userInfoError);
        }
      }

      // Final fallback: known numeric ID for Gritzpup's channel (77854856)
      // Kick's API now returns string IDs everywhere, but the subscription API
      // still requires the numeric format for broadcaster_user_id
      if (!numericUserId) {
        const knownId = Number(process.env.KICK_BROADCASTER_USER_ID) || 77854856;
        logger.info(`Using fallback broadcaster user ID: ${knownId}`);
        numericUserId = knownId;
      }

      if (numericUserId) {
        this.channelInfo!.user_id = numericUserId;
        logger.info(`Kick broadcaster user ID (numeric): ${this.channelInfo?.user_id}`);
      } else {
        logger.warn('Could not determine numeric user ID - subscription may not be channel-specific');
      }

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
    return new Promise<void>((resolve, reject) => {
      try {
        // Kick uses Pusher WebSocket for real-time chat
        // Using PUBLIC channel (chatrooms.{id}.v2) - no auth needed!
        const wsUrl = `wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false`;
        
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
          logger.info('Kick WebSocket connected to Pusher');

          // Wait for connection established to get socket ID
          const waitForConnection = new Promise<string>((resolveSocketId) => {
            const handler = (data: Buffer) => {
              try {
                const msg = JSON.parse(data.toString());
                if (msg.event === 'pusher:connection_established') {
                  const connData = JSON.parse(msg.data);
                  resolveSocketId(connData.socket_id);
                }
              } catch {
                // Ignore parse errors during connection setup
              }
            };
            this.ws?.once('message', handler);
            // Timeout fallback
            setTimeout(() => resolveSocketId(''), 5000);
          });

          waitForConnection.then((socketId) => {
            if (socketId) {
              logger.info(`Got Pusher socket ID: ${socketId}`);
            }

            // Subscribe to the PUBLIC chatroom channel - NO AUTH NEEDED!
            if (this.channelId) {
              const chatroomChannel = `chatrooms.${this.channelId}.v2`;
              logger.info(`Subscribing to Kick public chatroom: ${chatroomChannel}`);

              const subscribeMessage = {
                event: 'pusher:subscribe',
                data: {
                  channel: chatroomChannel
                }
              };
              this.ws?.send(JSON.stringify(subscribeMessage));
              logger.info(`Successfully subscribed to Kick chatroom: ${chatroomChannel}`);
            } else {
              logger.error('No channel ID available for Kick subscription');
            }

            resolve();
          });
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

      // Log ALL non-protocol events for debugging
      if (!message.event.startsWith('pusher:') && !message.event.startsWith('pusher_internal:')) {
        logger.info(`[KICK WS] Non-protocol event received: ${message.event}`);
        logger.info(`[KICK WS] Event data: ${JSON.stringify(message.data)}`);
      }

      // Handle chat messages - try different event patterns
      if (message.event === 'App\\Events\\ChatMessageSentEvent' ||
          message.event === 'ChatMessageSentEvent' ||
          message.event.includes('ChatMessage') ||
          message.event.includes('Message')) {
        logger.info(`Kick chat message event received: ${message.event}`);
        this.handleChatMessage(message.data);
      } else if (!message.event.startsWith('pusher:') && !message.event.startsWith('pusher_internal:')) {
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
    _attachments?: Attachment[], 
    _replyToMessageId?: string,
    _targetChannelId?: string,
    _originalMessage?: RelayMessage
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

  async editMessage(_messageId: string, _newContent: string): Promise<boolean> {
    // Kick doesn't support native message editing
    // Follow Twitch pattern: delete old message, then send new one
    // The relay manager handles the delete+resend flow via handleEdit
    logger.debug('Kick editMessage called - relay manager will handle delete+resend');
    return false;
  }

  async deleteMessage(messageId: string, _channelId?: string): Promise<boolean> {
    if (!this.status.connected) {
      logger.warn('Cannot delete Kick message: Not connected');
      return false;
    }

    try {
      const success = await this.api.deleteChatMessage(messageId);
      if (success) {
        logger.info(`Successfully deleted Kick message: ${messageId}`);
        return true;
      }
      logger.warn(`Failed to delete Kick message: ${messageId}`);
      return false;
    } catch (error) {
      logError(error as Error, 'Failed to delete message from Kick');
      return false;
    }
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
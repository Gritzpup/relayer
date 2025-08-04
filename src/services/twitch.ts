import * as tmi from 'tmi.js';
import { config } from '../config';
import { Platform, RelayMessage, MessageHandler, PlatformService, ServiceStatus, Attachment } from '../types';
import { logger, logPlatformMessage, logError } from '../utils/logger';
import { ReconnectManager } from '../utils/reconnect';

export class TwitchService implements PlatformService {
  platform = Platform.Twitch;
  private client: tmi.Client;
  private messageHandler?: MessageHandler;
  private reconnectManager: ReconnectManager;
  private isConnecting: boolean = false;
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

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connected', (addr: string, port: number) => {
      logger.info(`Twitch connected to ${addr}:${port}`);
      this.status.connected = true;
      this.isConnecting = false;  // Reset connecting flag on successful connection
    });

    this.client.on('message', async (channel: string, tags: tmi.ChatUserstate, message: string, self: boolean) => {
      logger.debug(`Twitch raw message received - Channel: ${channel}, User: ${tags.username}, Self: ${self}, Message: "${message}"`);
      
      if (self) {
        logger.debug('Skipping self message');
        return;
      }
      if (channel !== `#${config.twitch.channel}`) {
        logger.debug(`Skipping message from wrong channel: ${channel} (expected #${config.twitch.channel})`);
        return;
      }
      
      // Skip messages that are already relayed (have platform prefix)
      if (message.startsWith('[Discord]') || message.startsWith('[Telegram]')) {
        logger.debug('Skipping already relayed message with platform prefix');
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
    
    this.status.connected = false;
    logger.info('Twitch disconnected');
  }

  async sendMessage(content: string, attachments?: Attachment[]): Promise<void> {
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

    await this.client.say(channel, messageContent);
    this.status.messagesSent++;
    logPlatformMessage('Twitch', 'out', messageContent);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  getStatus(): ServiceStatus {
    return { ...this.status };
  }

  private convertMessage(tags: tmi.ChatUserstate, message: string): RelayMessage {
    return {
      id: tags.id || Date.now().toString(),
      platform: Platform.Twitch,
      author: tags.username || 'Unknown',
      content: message,
      timestamp: new Date(parseInt(tags['tmi-sent-ts'] || Date.now().toString())),
      raw: { tags, message },
    };
  }
}
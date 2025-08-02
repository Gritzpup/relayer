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
        reconnect: true,
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
    });

    this.client.on('message', async (channel: string, tags: tmi.ChatUserstate, message: string, self: boolean) => {
      if (self) return;
      if (channel !== `#${config.twitch.channel}`) return;
      // Also check if message is from our bot username
      if (tags.username === config.twitch.username.toLowerCase()) return;
      
      // Skip messages that are already relayed (have platform prefix)
      if (message.startsWith('[Discord]') || message.startsWith('[Telegram]')) return;

      this.status.messagesReceived++;
      const username = tags.username || 'Unknown';
      logPlatformMessage('Twitch', 'in', message, username);

      if (this.messageHandler) {
        const relayMessage = this.convertMessage(tags, message);
        try {
          await this.messageHandler(relayMessage);
        } catch (error) {
          logError(error as Error, 'Twitch message handler');
        }
      }
    });

    this.client.on('disconnected', (reason: string) => {
      logger.warn(`Twitch disconnected: ${reason}`);
      this.status.connected = false;
      this.status.lastError = reason;
      this.reconnectManager.scheduleReconnect();
    });

    this.client.on('notice', (_channel: string, msgid: string, message: string) => {
      logger.warn(`Twitch notice [${msgid}]: ${message}`);
    });
  }

  private async connectInternal(): Promise<void> {
    await this.client.connect();
  }

  async connect(): Promise<void> {
    await this.reconnectManager.connect();
  }

  async disconnect(): Promise<void> {
    this.reconnectManager.stop();
    await this.client.disconnect();
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
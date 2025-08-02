import { Client, GatewayIntentBits, TextChannel, Message, AttachmentBuilder } from 'discord.js';
import { config } from '../config';
import { Platform, RelayMessage, MessageHandler, PlatformService, ServiceStatus, Attachment } from '../types';
import { logger, logPlatformMessage, logError } from '../utils/logger';
import { ReconnectManager } from '../utils/reconnect';

export class DiscordService implements PlatformService {
  platform = Platform.Discord;
  private client: Client;
  private channel?: TextChannel;
  private messageHandler?: MessageHandler;
  private reconnectManager: ReconnectManager;
  private status: ServiceStatus = {
    platform: Platform.Discord,
    connected: false,
    messagesSent: 0,
    messagesReceived: 0,
  };

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.reconnectManager = new ReconnectManager(
      'Discord',
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
    this.client.on('ready', () => {
      logger.info(`Discord bot logged in as ${this.client.user?.tag}`);
      this.status.connected = true;
      this.initializeChannel();
    });

    this.client.on('messageCreate', async (message: Message) => {
      if (message.author.bot) return;
      if (message.channel.id !== config.discord.channelId) return;

      this.status.messagesReceived++;
      logPlatformMessage('Discord', 'in', message.content, message.author.username);

      if (this.messageHandler) {
        const relayMessage = this.convertMessage(message);
        try {
          await this.messageHandler(relayMessage);
        } catch (error) {
          logError(error as Error, 'Discord message handler');
        }
      }
    });

    this.client.on('error', (error: Error) => {
      logError(error, 'Discord client error');
      this.status.lastError = error.message;
    });

    this.client.on('disconnect', () => {
      logger.warn('Discord disconnected');
      this.status.connected = false;
      this.reconnectManager.scheduleReconnect();
    });
  }

  private async connectInternal(): Promise<void> {
    await this.client.login(config.discord.token);
  }

  async connect(): Promise<void> {
    await this.reconnectManager.connect();
  }

  async disconnect(): Promise<void> {
    this.reconnectManager.stop();
    await this.client.destroy();
    this.status.connected = false;
    logger.info('Discord disconnected');
  }

  private initializeChannel(): void {
    const channel = this.client.channels.cache.get(config.discord.channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Discord channel ${config.discord.channelId} not found or not text-based`);
    }
    this.channel = channel as TextChannel;
  }

  async sendMessage(content: string, attachments?: Attachment[]): Promise<void> {
    if (!this.channel) {
      throw new Error('Discord channel not initialized');
    }

    const messageOptions: any = { content };

    if (attachments && attachments.length > 0) {
      const files = attachments.map(att => {
        if (att.url) {
          return att.url;
        } else if (att.data) {
          return new AttachmentBuilder(att.data, { name: att.filename || 'attachment' });
        }
        return null;
      }).filter(Boolean);

      if (files.length > 0) {
        messageOptions.files = files;
      }
    }

    await this.channel.send(messageOptions);
    this.status.messagesSent++;
    logPlatformMessage('Discord', 'out', content);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  getStatus(): ServiceStatus {
    return { ...this.status };
  }

  private convertMessage(message: Message): RelayMessage {
    const attachments: Attachment[] = message.attachments.map(att => ({
      type: this.getAttachmentType(att.contentType),
      url: att.url,
      filename: att.name || undefined,
      mimeType: att.contentType || undefined,
    }));

    return {
      id: message.id,
      platform: Platform.Discord,
      author: message.author.username,
      content: message.content,
      timestamp: message.createdAt,
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: message,
    };
  }

  private getAttachmentType(contentType?: string | null): 'image' | 'video' | 'file' | 'gif' {
    if (!contentType) return 'file';
    if (contentType.startsWith('image/gif')) return 'gif';
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'video';
    return 'file';
  }
}
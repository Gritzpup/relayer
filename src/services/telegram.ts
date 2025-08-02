import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { Platform, RelayMessage, MessageHandler, PlatformService, ServiceStatus, Attachment } from '../types';
import { logger, logPlatformMessage, logError } from '../utils/logger';
import { ReconnectManager } from '../utils/reconnect';

export class TelegramService implements PlatformService {
  platform = Platform.Telegram;
  private bot: TelegramBot;
  private messageHandler?: MessageHandler;
  private reconnectManager: ReconnectManager;
  private isConnected: boolean = false;
  private status: ServiceStatus = {
    platform: Platform.Telegram,
    connected: false,
    messagesSent: 0,
    messagesReceived: 0,
  };

  constructor() {
    this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
    
    this.reconnectManager = new ReconnectManager(
      'Telegram',
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
    this.bot.on('message', async (msg: TelegramBot.Message) => {
      if (msg.chat.id.toString() !== config.telegram.groupId) return;
      if (msg.from?.is_bot) return;

      this.status.messagesReceived++;
      const username = msg.from?.username || msg.from?.first_name || 'Unknown';
      logPlatformMessage('Telegram', 'in', msg.text || '[Media]', username);

      if (this.messageHandler) {
        const relayMessage = await this.convertMessage(msg);
        try {
          await this.messageHandler(relayMessage);
        } catch (error) {
          logError(error as Error, 'Telegram message handler');
        }
      }
    });

    this.bot.on('polling_error', (error: Error) => {
      logError(error, 'Telegram polling error');
      this.status.lastError = error.message;
      this.status.connected = false;
      this.reconnectManager.scheduleReconnect();
    });

    this.bot.on('error', (error: Error) => {
      logError(error, 'Telegram error');
      this.status.lastError = error.message;
    });
  }

  private async connectInternal(): Promise<void> {
    if (this.isConnected) {
      await this.bot.stopPolling();
    }
    
    await this.bot.startPolling({ polling: { interval: 300, autoStart: true } });
    this.isConnected = true;
    this.status.connected = true;
    
    const me = await this.bot.getMe();
    logger.info(`Telegram bot connected as @${me.username}`);
  }

  async connect(): Promise<void> {
    await this.reconnectManager.connect();
  }

  async disconnect(): Promise<void> {
    this.reconnectManager.stop();
    await this.bot.stopPolling();
    this.isConnected = false;
    this.status.connected = false;
    logger.info('Telegram disconnected');
  }

  async sendMessage(content: string, attachments?: Attachment[]): Promise<void> {
    const chatId = config.telegram.groupId;

    try {
      if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          if (attachment.type === 'image' || attachment.type === 'gif') {
            if (attachment.url) {
              await this.bot.sendPhoto(chatId, attachment.url, { caption: content });
            } else if (attachment.data) {
              await this.bot.sendPhoto(chatId, attachment.data, { caption: content });
            }
          } else if (attachment.type === 'video') {
            if (attachment.url) {
              await this.bot.sendVideo(chatId, attachment.url, { caption: content });
            } else if (attachment.data) {
              await this.bot.sendVideo(chatId, attachment.data, { caption: content });
            }
          } else {
            if (attachment.url) {
              await this.bot.sendDocument(chatId, attachment.url, { caption: content });
            } else if (attachment.data) {
              await this.bot.sendDocument(chatId, attachment.data, { caption: content });
            }
          }
        }
      } else {
        await this.bot.sendMessage(chatId, content);
      }
      
      this.status.messagesSent++;
      logPlatformMessage('Telegram', 'out', content);
    } catch (error) {
      logError(error as Error, 'Telegram send message');
      throw error;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  getStatus(): ServiceStatus {
    return { ...this.status };
  }

  private async convertMessage(msg: TelegramBot.Message): Promise<RelayMessage> {
    const attachments: Attachment[] = [];

    if (msg.photo) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      const fileLink = await this.bot.getFileLink(largestPhoto.file_id);
      attachments.push({
        type: 'image',
        url: fileLink,
      });
    }

    if (msg.video) {
      const fileLink = await this.bot.getFileLink(msg.video.file_id);
      attachments.push({
        type: 'video',
        url: fileLink,
      });
    }

    if (msg.document) {
      const fileLink = await this.bot.getFileLink(msg.document.file_id);
      attachments.push({
        type: 'file',
        url: fileLink,
        filename: msg.document.file_name,
        mimeType: msg.document.mime_type,
      });
    }

    if (msg.sticker) {
      const fileLink = await this.bot.getFileLink(msg.sticker.file_id);
      attachments.push({
        type: 'sticker',
        url: fileLink,
        filename: 'sticker.webp',
        mimeType: 'image/webp',
        // Store emoji for Twitch display
        data: msg.sticker.emoji ? Buffer.from(msg.sticker.emoji) : undefined,
      });
    }

    const username = msg.from?.username || msg.from?.first_name || 'Unknown';
    
    return {
      id: msg.message_id.toString(),
      platform: Platform.Telegram,
      author: username,
      content: msg.text || msg.caption || '',
      timestamp: new Date(msg.date * 1000),
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: msg,
    };
  }
}
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
      
      // Debug logging for stickers and custom emojis
      if (msg.sticker) {
        logger.debug(`Sticker received - text: "${msg.text}", caption: "${msg.caption}", emoji: "${msg.sticker.emoji}"`);
      }
      
      // Check for custom emoji entities
      if (msg.entities) {
        logger.info(`Telegram message entities:`, JSON.stringify(msg.entities));
      }
      
      // Log the full message structure for debugging
      logger.debug(`Full Telegram message:`, JSON.stringify({
        text: msg.text,
        entities: msg.entities,
        sticker: msg.sticker ? { emoji: msg.sticker.emoji, custom_emoji_id: msg.sticker.custom_emoji_id } : null,
      }));
      
      logPlatformMessage('Telegram', 'in', msg.text || msg.caption || '[Media]', username);

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

  async sendMessage(content: string, attachments?: Attachment[]): Promise<string | undefined> {
    const chatId = config.telegram.groupId;
    let messageId: string | undefined;

    try {
      if (attachments && attachments.length > 0) {
        // Separate custom emojis from other attachments
        const customEmojis = attachments.filter(a => a.type === 'custom-emoji');
        const otherAttachments = attachments.filter(a => a.type !== 'custom-emoji');
        
        // Send custom emojis as a single message with multiple photos if possible
        if (customEmojis.length > 0) {
          // For multiple custom emojis, send them as an album (small, grouped)
          if (customEmojis.length > 1) {
            const media = customEmojis.map((emoji, index) => ({
              type: 'photo' as const,
              media: emoji.url!,
              caption: index === 0 ? content : undefined,
            }));
            const messages = await this.bot.sendMediaGroup(chatId, media);
            messageId = messages[0].message_id.toString();
          } else {
            // Single custom emoji - send as small photo
            const msg = await this.bot.sendPhoto(chatId, customEmojis[0].url!, { 
              caption: content,
              disable_notification: true, // Less intrusive for emojis
            });
            messageId = msg.message_id.toString();
          }
        }
        
        // Handle other attachments normally
        for (const attachment of otherAttachments) {
          let msg: TelegramBot.Message;
          if (attachment.type === 'image' || attachment.type === 'gif') {
            if (attachment.url) {
              msg = await this.bot.sendPhoto(chatId, attachment.url, { caption: content });
            } else if (attachment.data) {
              msg = await this.bot.sendPhoto(chatId, attachment.data, { caption: content });
            }
          } else if (attachment.type === 'video') {
            if (attachment.url) {
              msg = await this.bot.sendVideo(chatId, attachment.url, { caption: content });
            } else if (attachment.data) {
              msg = await this.bot.sendVideo(chatId, attachment.data, { caption: content });
            }
          } else {
            if (attachment.url) {
              msg = await this.bot.sendDocument(chatId, attachment.url, { caption: content });
            } else if (attachment.data) {
              msg = await this.bot.sendDocument(chatId, attachment.data, { caption: content });
            }
          }
          if (msg! && !messageId) {
            messageId = msg!.message_id.toString();
          }
        }
        
        // If only custom emojis and no other attachments, and content wasn't sent with emojis
        if (customEmojis.length > 0 && otherAttachments.length === 0 && content && customEmojis.length === 1) {
          // Content was already sent with the emoji
        } else if (otherAttachments.length === 0 && content && customEmojis.length === 0) {
          // No attachments, just send text
          const msg = await this.bot.sendMessage(chatId, content);
          messageId = msg.message_id.toString();
        }
      } else {
        const msg = await this.bot.sendMessage(chatId, content);
        messageId = msg.message_id.toString();
      }
      
      this.status.messagesSent++;
      logPlatformMessage('Telegram', 'out', content);
      
      return messageId;
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

    // Handle custom emoji entities
    if (msg.entities && msg.text) {
      for (const entity of msg.entities) {
        if (entity.type === 'custom_emoji' && (entity as any).custom_emoji_id) {
          try {
            const customEmojiId = (entity as any).custom_emoji_id;
            // Get the sticker data for this custom emoji
            const stickerSet = await this.bot.getCustomEmojiStickers([customEmojiId]);
            if (stickerSet && stickerSet.length > 0) {
              const sticker = stickerSet[0];
              const fileLink = await this.bot.getFileLink(sticker.file_id);
              
              // Extract the emoji text from the message
              // const emojiText = msg.text.substring(entity.offset, entity.offset + entity.length);
              
              attachments.push({
                type: 'custom-emoji',
                url: fileLink,
                filename: 'custom_emoji.webp',
                mimeType: 'image/webp',
              });
            }
          } catch (error) {
            logger.error('Failed to get custom emoji sticker:', error);
          }
        }
      }
    }

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
    
    // For sticker-only messages, don't include the emoji in content (it's handled by formatter)
    let content = msg.text || msg.caption || '';
    if (msg.sticker && !msg.text && !msg.caption) {
      content = '';
    }
    
    // Remove custom emojis from text content since they're sent as images
    if (msg.entities && msg.text && content) {
      // Process entities in reverse order to maintain correct offsets
      const customEmojiEntities = (msg.entities || [])
        .filter(e => e.type === 'custom_emoji')
        .sort((a, b) => b.offset - a.offset);
      
      for (const entity of customEmojiEntities) {
        content = content.substring(0, entity.offset) + 
                  content.substring(entity.offset + entity.length);
      }
      
      // Trim any extra whitespace
      content = content.trim();
    }
    
    return {
      id: msg.message_id.toString(),
      platform: Platform.Telegram,
      author: username,
      content: content,
      timestamp: new Date(msg.date * 1000),
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: msg,
    };
  }
}
import { Client, GatewayIntentBits, TextChannel, Message, PartialMessage, AttachmentBuilder, EmbedBuilder, Partials } from 'discord.js';
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
      partials: [Partials.Message, Partials.Channel],
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
      logger.info(`Discord raw message content: "${message.content}"`);
      logPlatformMessage('Discord', 'in', message.content, message.author.username);

      if (this.messageHandler) {
        const relayMessage = await this.convertMessage(message);
        
        // Debug logging for custom emojis
        if (relayMessage.attachments) {
          const customEmojis = relayMessage.attachments.filter(a => a.type === 'custom-emoji');
          if (customEmojis.length > 0) {
            logger.info(`Custom emojis detected: ${customEmojis.map(e => e.filename).join(', ')}`);
          }
        }
        
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

    this.client.on('messageUpdate', async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
      // Fetch full messages if they're partial
      if (oldMessage.partial) oldMessage = await oldMessage.fetch();
      if (newMessage.partial) newMessage = await newMessage.fetch();
      
      // Skip if not in our channel or from a bot
      if (newMessage.author?.bot) return;
      if (newMessage.channel.id !== config.discord.channelId) return;
      
      // Skip if content hasn't changed (could be embed update, etc.)
      if (oldMessage.content === newMessage.content) return;
      
      logger.info(`Discord message edited: ${oldMessage.id} - Old: "${oldMessage.content}" New: "${newMessage.content}"`);
      
      if (this.messageHandler && newMessage instanceof Message) {
        const relayMessage = await this.convertMessage(newMessage);
        relayMessage.isEdit = true;
        relayMessage.originalMessageId = newMessage.id;
        
        try {
          await this.messageHandler(relayMessage);
        } catch (error) {
          logError(error as Error, 'Discord edit handler');
        }
      }
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

  async sendMessage(content: string, attachments?: Attachment[], replyToMessageId?: string): Promise<string | undefined> {
    if (!this.channel) {
      throw new Error('Discord channel not initialized');
    }

    const messageOptions: any = { content };
    const embeds: EmbedBuilder[] = [];

    // Add reply reference if provided
    if (replyToMessageId) {
      messageOptions.reply = { 
        messageReference: replyToMessageId,
        failIfNotExists: false  // Don't fail if the message was deleted
      };
    }

    if (attachments && attachments.length > 0) {
      const regularAttachments: any[] = [];
      
      for (const att of attachments) {
        if ((att.type === 'sticker' || att.type === 'custom-emoji') && att.url) {
          // Handle stickers and custom emojis as embeds with thumbnail for smaller size
          const embed = new EmbedBuilder()
            .setThumbnail(att.url)
            .setColor(0x36393f); // Discord dark theme background color to blend in
          embeds.push(embed);
        } else {
          // Handle other attachments normally
          if (att.url) {
            regularAttachments.push(att.url);
          } else if (att.data) {
            regularAttachments.push(new AttachmentBuilder(att.data, { name: att.filename || 'attachment' }));
          }
        }
      }

      if (regularAttachments.length > 0) {
        messageOptions.files = regularAttachments;
      }
      
      if (embeds.length > 0) {
        messageOptions.embeds = embeds;
      }
    }

    const sentMessage = await this.channel.send(messageOptions);
    this.status.messagesSent++;
    logPlatformMessage('Discord', 'out', content);
    
    return sentMessage.id;
  }

  async editMessage(messageId: string, newContent: string): Promise<boolean> {
    if (!this.channel) {
      logger.error('Discord channel not initialized for edit');
      return false;
    }

    try {
      const message = await this.channel.messages.fetch(messageId);
      await message.edit(newContent);
      logger.info(`Discord message ${messageId} edited successfully`);
      return true;
    } catch (error) {
      logger.error(`Failed to edit Discord message ${messageId}: ${error}`);
      return false;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  getStatus(): ServiceStatus {
    return { ...this.status };
  }

  private async convertMessage(message: Message): Promise<RelayMessage> {
    const attachments: Attachment[] = message.attachments.map(att => ({
      type: this.getAttachmentType(att.contentType),
      url: att.url,
      filename: att.name || undefined,
      mimeType: att.contentType || undefined,
    }));

    // Extract custom emojis from message content
    const customEmojis = this.extractCustomEmojis(message.content);
    if (customEmojis.length > 0) {
      customEmojis.forEach(emoji => {
        attachments.push({
          type: 'custom-emoji' as any,
          url: emoji.url,
          filename: `${emoji.name}.${emoji.animated ? 'gif' : 'png'}`,
          mimeType: emoji.animated ? 'image/gif' : 'image/png',
        });
      });
    }

    // Check if this is a reply
    let replyTo: RelayMessage['replyTo'] | undefined;
    if (message.reference && message.reference.messageId) {
      try {
        const referencedMessage = await message.fetchReference();
        if (referencedMessage) {
          replyTo = {
            messageId: referencedMessage.id,
            author: referencedMessage.author.username,
            content: referencedMessage.content || '[No content]',
          };
          logger.debug(`Discord message ${message.id} is a reply to ${referencedMessage.id}`);
        }
      } catch (error) {
        logger.debug(`Failed to fetch reference message: ${error}`);
      }
    }

    return {
      id: message.id,
      platform: Platform.Discord,
      author: message.author.username,
      content: message.content,
      timestamp: message.createdAt,
      attachments: attachments.length > 0 ? attachments : undefined,
      replyTo,
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

  private extractCustomEmojis(content: string): Array<{name: string, id: string, animated: boolean, url: string}> {
    const emojis: Array<{name: string, id: string, animated: boolean, url: string}> = [];
    
    logger.info(`Checking for custom emojis in: "${content}"`);
    
    // Match static custom emojis <:name:id>
    const staticEmojiRegex = /<:(\w+):(\d+)>/g;
    let match;
    while ((match = staticEmojiRegex.exec(content)) !== null) {
      logger.info(`Found static emoji: ${match[0]} - name: ${match[1]}, id: ${match[2]}`);
      emojis.push({
        name: match[1],
        id: match[2],
        animated: false,
        url: `https://cdn.discordapp.com/emojis/${match[2]}.png?size=48`, // size=48 for small emoji
      });
    }
    
    // Match animated custom emojis <a:name:id>
    const animatedEmojiRegex = /<a:(\w+):(\d+)>/g;
    while ((match = animatedEmojiRegex.exec(content)) !== null) {
      logger.info(`Found animated emoji: ${match[0]} - name: ${match[1]}, id: ${match[2]}`);
      emojis.push({
        name: match[1],
        id: match[2],
        animated: true,
        url: `https://cdn.discordapp.com/emojis/${match[2]}.gif?size=48`, // size=48 for small emoji
      });
    }
    
    logger.info(`Total custom emojis found: ${emojis.length}`);
    return emojis;
  }
}
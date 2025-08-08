import { Client, GatewayIntentBits, TextChannel, Message, PartialMessage, AttachmentBuilder, EmbedBuilder, Partials } from 'discord.js';
import { config, channelMappings } from '../config';
import { Platform, RelayMessage, MessageHandler, DeleteHandler, PlatformService, ServiceStatus, Attachment } from '../types';
import { logger, logPlatformMessage, logError } from '../utils/logger';
import { ReconnectManager } from '../utils/reconnect';

export class DiscordService implements PlatformService {
  platform = Platform.Discord;
  private client: Client;
  private messageHandler?: MessageHandler;
  private deleteHandler?: DeleteHandler;
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
    });

    this.client.on('messageCreate', async (message: Message) => {
      // Debug logging to see ALL messages
      logger.debug(`[DEBUG] Discord message received: author="${message.author.username}" (bot=${message.author.bot}, id=${message.author.id}) channel=${message.channel.id} content="${message.content?.substring(0, 50)}..."`);
      
      if (message.author.bot) {
        logger.debug(`[DEBUG] Skipping bot message from ${message.author.username}`);
        return;
      }
      
      // Check if this channel is in our mapping
      const channelName = Object.keys(channelMappings).find(name => 
        channelMappings[name].discord === message.channel.id
      );
      if (!channelName) {
        logger.debug(`[DEBUG] Skipping message from unmapped channel ${message.channel.id}`);
        return; // Not a mapped channel
      }

      this.status.messagesReceived++;
      logger.info(`Discord message in #${channelName}: "${message.content}"`);
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
      
      // Skip if from a bot
      if (newMessage.author?.bot) return;
      
      // Check if this channel is in our mapping
      const channelName = Object.keys(channelMappings).find(name => 
        channelMappings[name].discord === newMessage.channel.id
      );
      if (!channelName) return; // Not a mapped channel
      
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

    // Handle message deletions
    this.client.on('messageDelete', async (message: Message | PartialMessage) => {
      // Fetch full message if partial
      if (message.partial) {
        try {
          message = await message.fetch();
        } catch (error) {
          // Message data not available anymore
          logger.debug('Could not fetch partial deleted message');
          return;
        }
      }
      
      // Skip if from a bot
      if (message.author?.bot) return;
      
      // Check if this channel is in our mapping
      const channelName = Object.keys(channelMappings).find(name => 
        channelMappings[name].discord === message.channel.id
      );
      if (!channelName) return; // Not a mapped channel
      
      logger.info(`Discord message deleted: ${message.id} by ${message.author?.username}`);
      
      if (this.deleteHandler) {
        try {
          await this.deleteHandler(Platform.Discord, message.id);
        } catch (error) {
          logError(error as Error, 'Discord delete handler');
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

  async sendMessage(content: string, attachments?: Attachment[], replyToMessageId?: string, targetChannelId?: string): Promise<string | undefined> {
    // Use targetChannelId if provided, otherwise fall back to default channel
    const channelId = targetChannelId || config.discord.channelId;
    const channel = this.client.channels.cache.get(channelId);
    
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Discord channel ${channelId} not found or not text-based`);
    }

    const messageOptions: any = { content };
    const embeds: EmbedBuilder[] = [];

    // Add reply reference if provided
    if (replyToMessageId) {
      logger.info(`DISCORD: Setting reply to message ${replyToMessageId}`);
      messageOptions.reply = { 
        messageReference: replyToMessageId,
        failIfNotExists: false  // Don't fail if the message was deleted
      };
    } else {
      logger.info(`DISCORD: No replyToMessageId provided`);
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

    const sentMessage = await (channel as TextChannel).send(messageOptions);
    this.status.messagesSent++;
    logPlatformMessage('Discord', 'out', content);
    
    return sentMessage.id;
  }

  async editMessage(messageId: string, newContent: string): Promise<boolean> {
    try {
      // Try to find the message in any of the mapped channels
      for (const [channelName, mapping] of Object.entries(channelMappings)) {
        const channel = this.client.channels.cache.get(mapping.discord);
        if (!channel || !channel.isTextBased()) continue;
        
        try {
          const message = await (channel as TextChannel).messages.fetch(messageId);
          await message.edit(newContent);
          logger.info(`Discord message ${messageId} edited successfully in #${channelName}`);
          return true;
        } catch (error) {
          // Message not in this channel, try next
          continue;
        }
      }
      
      logger.error(`Failed to find Discord message ${messageId} in any mapped channel`);
      return false;
    } catch (error) {
      logger.error(`Failed to edit Discord message ${messageId}: ${error}`);
      return false;
    }
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    try {
      // Try to find the message in any of the mapped channels
      for (const [channelName, mapping] of Object.entries(channelMappings)) {
        const channel = this.client.channels.cache.get(mapping.discord);
        if (!channel || !channel.isTextBased()) continue;
        
        try {
          const message = await (channel as TextChannel).messages.fetch(messageId);
          await message.delete();
          logger.info(`Discord message ${messageId} deleted successfully from #${channelName}`);
          return true;
        } catch (error) {
          // Message not in this channel, try next
          continue;
        }
      }
      
      logger.error(`Failed to find Discord message ${messageId} in any mapped channel`);
      return false;
    } catch (error) {
      logger.error(`Failed to delete Discord message ${messageId}: ${error}`);
      return false;
    }
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
          let author = referencedMessage.author.username;
          let content = referencedMessage.content || '[No content]';
          
          // If replying to a bot message, extract the original author from the message content
          let replyPlatform: Platform | undefined;
          if (referencedMessage.author.bot && content) {
            // Pattern: [emoji] [Platform] username: message
            // First try to extract platform (with optional emoji prefix)
            const platformMatch = content.match(/(?:.*?)?\[(Telegram|Twitch)\]\s+([^:]+):\s*(.*)/);
            if (platformMatch) {
              replyPlatform = platformMatch[1] as Platform;
              author = platformMatch[2].trim();
              content = platformMatch[3] || content;
            } else {
              // Fallback to original pattern without platform extraction
              const authorMatch = content.match(/(?:^[^\[]*)?(?:\[[\w]+\]\s+)?([^:]+):\s*(.*)/);
              if (authorMatch) {
                author = authorMatch[1].trim();
                content = authorMatch[2] || content;
              }
            }
          }
          
          replyTo = {
            messageId: referencedMessage.id,
            author: author,
            content: content,
            platform: replyPlatform,
          };
          logger.info(`Discord message ${message.id} is a reply to ${referencedMessage.id} (author: ${author}${replyPlatform ? `, platform: ${replyPlatform}` : ''})`);
        }
      } catch (error) {
        logger.debug(`Failed to fetch reference message: ${error}`);
      }
    }

    // Get channel name from mapping
    const channelName = Object.keys(channelMappings).find(name => 
      channelMappings[name].discord === message.channel.id
    );
    
    return {
      id: message.id,
      platform: Platform.Discord,
      author: message.author.username,
      content: message.content,
      timestamp: message.createdAt,
      attachments: attachments.length > 0 ? attachments : undefined,
      replyTo,
      raw: message,
      channelId: message.channel.id,
      channelName: channelName,
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
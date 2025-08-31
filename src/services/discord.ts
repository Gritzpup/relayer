import { Client, GatewayIntentBits, TextChannel, Message, PartialMessage, AttachmentBuilder, EmbedBuilder, Partials, ChannelType } from 'discord.js';
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
  private adminUserIds: Set<string> = new Set();
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
        GatewayIntentBits.GuildModeration,
      ],
      partials: [Partials.Message, Partials.Channel],
    });
    
    // Add your Discord user ID here as admin
    // You can find your ID by enabling Developer Mode in Discord and right-clicking your username
    this.adminUserIds.add('746386717'); // Add your Discord user ID here

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
    // logger.info('[DISCORD] Setting up event handlers...');
    // console.log('[DISCORD] Initializing Discord event handlers');
    
    this.client.on('ready', () => {
      // logger.info(`[DISCORD] ✅ Connected successfully as ${this.client.user?.tag}`);
      console.log(`[DISCORD] Ready event fired - bot is connected as ${this.client.user?.tag}`);
      console.log(`[DISCORD] Bot ID: ${this.client.user?.id}`);
      console.log(`[DISCORD] Watching channels:`, Object.entries(channelMappings).map(([name, map]) => `${name}: ${map.discord}`));
      this.status.connected = true;
    });

    this.client.on('messageCreate', async (message: Message) => {
      // Debug logging to see ALL messages
      // console.log(`[DISCORD MESSAGE] Received from ${message.author.username} (bot=${message.author.bot}) in channel ${message.channel.id}`);
      // logger.debug(`[DEBUG] Discord message received: author="${message.author.username}" (bot=${message.author.bot}, id=${message.author.id}) channel=${message.channel.id} content="${message.content?.substring(0, 50)}..."`);
      
      if (message.author.bot) {
        // logger.debug(`[DEBUG] Skipping bot message from ${message.author.username}`);
        return;
      }
      
      // Check if this channel is in our mapping
      const channelName = Object.keys(channelMappings).find(name => 
        channelMappings[name].discord === message.channel.id
      );
      if (!channelName) {
        // logger.debug(`[DEBUG] Skipping message from unmapped channel ${message.channel.id}`);
        return; // Not a mapped channel
      }

      this.status.messagesReceived++;
      // logger.info(`Discord message in #${channelName}: "${message.content}"`);
      logPlatformMessage('Discord', 'in', message.content, message.author.username);

      if (this.messageHandler) {
        const relayMessage = await this.convertMessage(message);
        
        // Debug logging for custom emojis
        if (relayMessage.attachments) {
          const customEmojis = relayMessage.attachments.filter(a => a.type === 'custom-emoji');
          if (customEmojis.length > 0) {
            // logger.info(`Custom emojis detected: ${customEmojis.map(e => e.filename).join(', ')}`);
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
      console.error('[DISCORD ERROR]', error.message);
      logError(error, 'Discord client error');
      this.status.lastError = error.message;
    });

    this.client.on('disconnect', () => {
      console.warn('[DISCORD] Disconnected from Discord');
      logger.warn('Discord disconnected');
      this.status.connected = false;
      this.reconnectManager.scheduleReconnect();
    });
    
    // Add debug event
    this.client.on('debug', (info: string) => {
      if (info.includes('Heartbeat') || info.includes('heartbeat')) return; // Skip heartbeat spam
      logger.debug(`[DISCORD DEBUG] ${info}`);
    });
    
    // Add warn event
    this.client.on('warn', (info: string) => {
      console.warn('[DISCORD WARN]', info);
      logger.warn(`[DISCORD WARN] ${info}`);
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
          // Even if we can't fetch the message, check audit logs for admin deletion
          await this.checkAdminDeletion(message);
          return;
        }
      }
      
      // Check if this channel is in our mapping
      const channelName = Object.keys(channelMappings).find(name => 
        channelMappings[name].discord === message.channel.id
      );
      if (!channelName) return; // Not a mapped channel
      
      // Check who deleted the message via audit logs
      const isAdminDeletion = await this.checkAdminDeletion(message);
      
      // Skip bot messages unless it's an admin deletion
      if (message.author?.bot && !isAdminDeletion) return;
      
      logger.info(`Discord message deleted: ${message.id} by ${message.author?.username} (admin deletion: ${isAdminDeletion})`);
      
      if (this.deleteHandler) {
        try {
          // Pass admin deletion flag to handler
          await this.deleteHandler(Platform.Discord, message.id, isAdminDeletion);
        } catch (error) {
          logError(error as Error, 'Discord delete handler');
        }
      }
    });
  }

  private async connectInternal(): Promise<void> {
    logger.info('[DISCORD] Starting connection attempt...');
    console.log('[DISCORD] Attempting to connect with token:', config.discord.token.substring(0, 20) + '...');
    
    try {
      await this.client.login(config.discord.token);
      logger.info('[DISCORD] Login method completed, waiting for ready event...');
    } catch (error) {
      logger.error('[DISCORD] Failed to login:', error);
      console.error('[DISCORD] Connection failed:', error);
      throw error;
    }
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

  async sendMessage(content: string, attachments?: Attachment[], replyToMessageId?: string, targetChannelId?: string, _originalMessage?: RelayMessage): Promise<string | undefined> {
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
      // logger.info(`DISCORD: Setting reply to message ${replyToMessageId}`);
      messageOptions.reply = { 
        messageReference: replyToMessageId,
        failIfNotExists: false  // Don't fail if the message was deleted
      };
    } else {
      // logger.info(`DISCORD: No replyToMessageId provided`);
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

  async deleteMessage(messageId: string, channelId?: string): Promise<boolean> {
    try {
      // If channel ID is provided, try that first (more efficient)
      if (channelId) {
        logger.info(`Attempting to delete Discord message ${messageId} from provided channel ${channelId}`);
        const channel = this.client.channels.cache.get(channelId);
        if (channel && channel.isTextBased()) {
          try {
            const message = await (channel as TextChannel).messages.fetch(messageId);
            await message.delete();
            logger.info(`Discord message ${messageId} deleted successfully from channel ${channelId}`);
            return true;
          } catch (error: any) {
            // Check for permission error specifically
            if (error.code === 50013) {
              logger.error(`❌ PERMISSION ERROR: Bot lacks "Manage Messages" permission to delete Discord messages!`);
              logger.error(`Please grant the bot "Manage Messages" permission in your Discord server settings.`);
              logger.error(`See DISCORD_PERMISSIONS_FIX.md for instructions.`);
              return false;
            }
            logger.warn(`Failed to delete message ${messageId} from provided channel ${channelId}: ${error}`);
            // Fall through to search other channels
          }
        } else {
          logger.warn(`Channel ${channelId} not found or not text-based`);
        }
      }
      
      // Search ALL text channels the bot can see, not just mapped ones
      logger.info(`Searching for Discord message ${messageId} in all accessible channels...`);
      const allChannels = this.client.channels.cache.filter(channel => 
        channel.isTextBased() && channel.type === ChannelType.GuildText
      );
      
      for (const channel of allChannels.values()) {
        try {
          const textChannel = channel as TextChannel;
          const message = await textChannel.messages.fetch(messageId);
          await message.delete();
          logger.info(`Discord message ${messageId} deleted successfully from #${textChannel.name} (${textChannel.id})`);
          return true;
        } catch (error: any) {
          // Check for permission error specifically
          if (error.code === 50013) {
            logger.error(`❌ PERMISSION ERROR: Bot lacks "Manage Messages" permission in #${(channel as TextChannel).name}!`);
            logger.error(`Please grant the bot "Manage Messages" permission in your Discord server settings.`);
            logger.error(`See DISCORD_PERMISSIONS_FIX.md for instructions.`);
            return false;
          }
          // Message not in this channel, continue searching
          continue;
        }
      }
      
      logger.error(`Failed to find Discord message ${messageId} in any accessible channel (searched ${allChannels.size} channels)`);
      return false;
    } catch (error: any) {
      if (error.code === 50013) {
        logger.error(`❌ PERMISSION ERROR: Bot lacks "Manage Messages" permission to delete Discord messages!`);
        logger.error(`Please grant the bot "Manage Messages" permission in your Discord server settings.`);
        logger.error(`See DISCORD_PERMISSIONS_FIX.md for instructions.`);
      } else {
        logger.error(`Failed to delete Discord message ${messageId}: ${error}`);
      }
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
      logger.info(`DISCORD REPLY: Processing reply from ${message.author.username} to message ${message.reference.messageId} at ${new Date().toISOString()}`);
      try {
        const referencedMessage = await message.fetchReference();
        if (referencedMessage) {
          let author = referencedMessage.author.username;
          let content = referencedMessage.content || '[No content]';
          
          logger.info(`DISCORD REPLY: Referenced message is from ${referencedMessage.author.username} (bot: ${referencedMessage.author.bot})`);
          
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
              logger.info(`DISCORD REPLY: Extracted from bot message - platform: ${replyPlatform}, author: ${author}`);
            } else {
              // Fallback to original pattern without platform extraction
              const authorMatch = content.match(/(?:^[^\[]*)?(?:\[[\w]+\]\s+)?([^:]+):\s*(.*)/);
              if (authorMatch) {
                author = authorMatch[1].trim();
                content = authorMatch[2] || content;
                logger.info(`DISCORD REPLY: Extracted from bot message (no platform) - author: ${author}`);
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
    
    // Resolve Discord mentions to readable format
    const resolvedContent = await this.resolveMentions(message);
    
    return {
      id: message.id,
      platform: Platform.Discord,
      author: message.author.username,
      content: resolvedContent,
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

  private async checkAdminDeletion(message: Message | PartialMessage): Promise<boolean> {
    try {
      // Check if the message is in a guild
      if (!message.guild) return false;
      
      // Fetch audit logs
      const auditLogs = await message.guild.fetchAuditLogs({
        type: 72, // MESSAGE_DELETE type
        limit: 5,
      });
      
      // Find the most recent deletion log for this message
      const now = Date.now();
      const deletionLog = auditLogs.entries.find(entry => {
        // Check if this log entry is recent (within 5 seconds)
        const timeDiff = now - entry.createdTimestamp;
        if (timeDiff > 5000) return false;
        
        // Check if the target matches our message author
        if (entry.target?.id !== message.author?.id) return false;
        
        // Check if the executor is an admin
        return this.adminUserIds.has(entry.executor?.id || '');
      });
      
      if (deletionLog) {
        logger.info(`Admin deletion detected: Message ${message.id} deleted by admin ${deletionLog.executor?.username}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.debug('Could not check audit logs for deletion:', error);
      return false;
    }
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

  private async resolveMentions(message: Message): Promise<string> {
    let content = message.content;
    
    if (!content) return content;
    
    try {
      // Resolve user mentions <@userId> or <@!userId> 
      const userMentionRegex = /<@!?(\d+)>/g;
      const userMentions = content.match(userMentionRegex);
      
      if (userMentions) {
        for (const mention of userMentions) {
          const userId = mention.replace(/<@!?/, '').replace('>', '');
          try {
            // Try to get user from cache first
            let user = this.client.users.cache.get(userId);
            
            // If not in cache, try to fetch
            if (!user && message.guild) {
              const member = await message.guild.members.fetch(userId).catch(() => null);
              user = member?.user;
            }
            
            if (user) {
              // Replace mention with @username
              content = content.replace(mention, `@${user.username}`);
              logger.debug(`Resolved user mention ${mention} to @${user.username}`);
            } else {
              // If user not found, just show @unknown
              content = content.replace(mention, '@unknown');
              logger.debug(`Could not resolve user mention ${mention}`);
            }
          } catch (error) {
            logger.debug(`Error resolving user mention ${mention}: ${error}`);
            content = content.replace(mention, '@unknown');
          }
        }
      }
      
      // Resolve role mentions <@&roleId>
      const roleMentionRegex = /<@&(\d+)>/g;
      const roleMentions = content.match(roleMentionRegex);
      
      if (roleMentions && message.guild) {
        for (const mention of roleMentions) {
          const roleId = mention.replace('<@&', '').replace('>', '');
          try {
            const role = message.guild.roles.cache.get(roleId);
            
            if (role) {
              // Replace mention with @rolename
              content = content.replace(mention, `@${role.name}`);
              logger.debug(`Resolved role mention ${mention} to @${role.name}`);
            } else {
              // If role not found, just show @role
              content = content.replace(mention, '@role');
              logger.debug(`Could not resolve role mention ${mention}`);
            }
          } catch (error) {
            logger.debug(`Error resolving role mention ${mention}: ${error}`);
            content = content.replace(mention, '@role');
          }
        }
      }
      
      // Resolve channel mentions <#channelId>
      const channelMentionRegex = /<#(\d+)>/g;
      const channelMentions = content.match(channelMentionRegex);
      
      if (channelMentions) {
        for (const mention of channelMentions) {
          const channelId = mention.replace('<#', '').replace('>', '');
          try {
            const channel = this.client.channels.cache.get(channelId);
            
            if (channel && 'name' in channel) {
              // Replace mention with #channelname
              content = content.replace(mention, `#${channel.name}`);
              logger.debug(`Resolved channel mention ${mention} to #${channel.name}`);
            } else {
              // If channel not found, just show #channel
              content = content.replace(mention, '#channel');
              logger.debug(`Could not resolve channel mention ${mention}`);
            }
          } catch (error) {
            logger.debug(`Error resolving channel mention ${mention}: ${error}`);
            content = content.replace(mention, '#channel');
          }
        }
      }
      
      // Resolve @everyone and @here
      content = content.replace(/@everyone/g, '@everyone');
      content = content.replace(/@here/g, '@here');
      
    } catch (error) {
      logger.error('Error resolving mentions:', error);
      // Return original content if there's an error
      return message.content;
    }
    
    return content;
  }
}
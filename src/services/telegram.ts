import TelegramBot from 'node-telegram-bot-api';
import { config, channelMappings } from '../config';
import { Platform, RelayMessage, MessageHandler, DeleteHandler, PlatformService, ServiceStatus, Attachment } from '../types';
import { logger, logPlatformMessage, logError } from '../utils/logger';
import { ReconnectManager } from '../utils/reconnect';
import { messageDb } from '../database/db';

export class TelegramService implements PlatformService {
  platform = Platform.Telegram;
  private bot: TelegramBot;
  private messageHandler?: MessageHandler;
  private deleteHandler?: DeleteHandler;
  private reconnectManager: ReconnectManager;
  private isConnected: boolean = false;
  private messageTracker: Map<number, string> = new Map(); // Track message ID to mapping ID
  private status: ServiceStatus = {
    platform: Platform.Telegram,
    connected: false,
    messagesSent: 0,
    messagesReceived: 0,
  };

  constructor() {
    // Configure bot with proper timeout and request settings
    this.bot = new TelegramBot(config.telegram.botToken, {
      polling: false,
      request: {
        timeout: 30000, // 30 second timeout
        agentOptions: {
          keepAlive: true,
          keepAliveMsecs: 10000
        }
      } as any,
      filepath: false // Disable automatic file downloads
    });
    
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
    // Debug log for all events
    const originalEmit = this.bot.emit;
    this.bot.emit = function(event: string, ...args: any[]) {
      if (event === 'edited_message' || event === 'edit_message' || event.includes('edit')) {
        logger.info(`TELEGRAM RAW EVENT: ${event}`, { messageId: args[0]?.message_id, text: args[0]?.text?.substring(0, 50) });
      }
      return originalEmit.apply(this, arguments as any);
    };
    
    this.bot.on('message', async (msg: TelegramBot.Message) => {
      if (msg.chat.id.toString() !== config.telegram.groupId) return;
      if (msg.from?.is_bot) return;
      
      // Get the topic/thread ID (for supergroups with topics)
      let threadId = msg.message_thread_id || undefined;
      let channelName: string | undefined;
      
      // IMPORTANT: If this is a reply, we need to handle it differently
      // In Telegram supergroups, replies might have the wrong message_thread_id
      // We should process the reply and determine the channel from context
      if (msg.reply_to_message) {
        logger.info(`Processing reply message ${msg.message_id}, original thread_id: ${threadId}`);
        
        // For replies, try to determine the actual topic from the message being replied to
        // Try to find the channel mapping, but don't skip if not found
        if (threadId) {
          channelName = Object.keys(channelMappings).find(name => 
            channelMappings[name].telegram === threadId.toString()
          );
        }
        
        // If no channel found by thread ID, default to general
        if (!channelName) {
          channelName = 'general';
          logger.info(`Reply message ${msg.message_id} defaulting to #general channel`);
        }
      } else {
        // For non-reply messages, use the original logic
        // Find channel name based on thread ID
        if (threadId) {
          channelName = Object.keys(channelMappings).find(name => 
            channelMappings[name].telegram === threadId.toString()
          );
          if (!channelName) {
            logger.debug(`No mapping found for Telegram topic ${threadId}, skipping message`);
            return;
          }
        } else {
          // General topic - check if any mapping has null telegram ID
          channelName = Object.keys(channelMappings).find(name => 
            !channelMappings[name].telegram
          );
          if (!channelName) {
            logger.debug(`No mapping found for Telegram general topic, skipping message`);
            return;
          }
        }
      }

      this.status.messagesReceived++;
      const username = msg.from?.username || msg.from?.first_name || 'Unknown';
      
      // Enhanced debug logging for reply detection
      const debugInfo = {
        message_id: msg.message_id,
        text: msg.text?.substring(0, 50) + (msg.text && msg.text.length > 50 ? '...' : ''),
        topic_id: threadId || 'general',
        from: msg.from?.username || msg.from?.first_name,
        has_reply_to: !!msg.reply_to_message,
        reply_to_id: msg.reply_to_message?.message_id,
        message_thread_id: msg.message_thread_id,
        chat_type: msg.chat.type,
        is_topic_message: msg.is_topic_message
      };
      
      logger.info(`Telegram message in #${channelName}:`, debugInfo);
      
      // Extra logging for reply detection issues
      if (msg.reply_to_message) {
        logger.info(`REPLY DETECTED - Full reply_to_message:`, {
          reply_msg_id: msg.reply_to_message.message_id,
          reply_from: msg.reply_to_message.from?.username || msg.reply_to_message.from?.first_name,
          reply_text: msg.reply_to_message.text?.substring(0, 50),
          reply_is_bot: msg.reply_to_message.from?.is_bot,
          current_thread_id: msg.message_thread_id,
          is_same_as_thread: msg.reply_to_message.message_id === msg.message_thread_id
        });
      }
      
      // Extra detailed logging for debugging reply issues
      if (msg.text && msg.text.includes('reply') || msg.text && msg.text.includes('chicken')) {
        logger.info(`FULL MESSAGE DUMP for potential reply:`, JSON.stringify(msg, null, 2));
      }
      
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
      
      // Track message in database
      await messageDb.trackMessage({
        telegramMsgId: msg.message_id,
        chatId: msg.chat.id,
        userId: msg.from?.id,
        username: msg.from?.username || msg.from?.first_name || 'Unknown',
        content: msg.text || msg.caption || '[Media]',
        platform: 'Telegram'
      });

      if (this.messageHandler) {
        const relayMessage = await this.convertMessage(msg, channelName);
        try {
          await this.messageHandler(relayMessage);
        } catch (error) {
          logError(error as Error, 'Telegram message handler');
        }
      }
    });

    this.bot.on('edited_message', async (msg: TelegramBot.Message) => {
      logger.info(`TELEGRAM EDIT EVENT RECEIVED: message_id=${msg.message_id}, from=${msg.from?.username || 'unknown'}, chat_id=${msg.chat.id}`);
      
      if (!msg.from || msg.from.is_bot) {
        logger.debug(`Skipping edited message: from_bot=${msg.from?.is_bot}`);
        return;
      }
      if (msg.chat.id.toString() !== config.telegram.groupId) {
        logger.debug(`Skipping edited message: wrong chat ${msg.chat.id} !== ${config.telegram.groupId}`);
        return;
      }
      
      // Get the topic/thread ID
      const threadId = msg.message_thread_id || undefined;
      logger.debug(`Edit handler: threadId=${threadId}, message_id=${msg.message_id}`);
      
      // Find channel name based on thread ID
      let channelName: string | undefined;
      if (threadId) {
        // Check if this is a reply (thread_id is a message ID, not a topic ID)
        const threadIdStr = threadId.toString();
        channelName = Object.keys(channelMappings).find(name => 
          channelMappings[name].telegram === threadIdStr
        );
        
        // If no mapping found and threadId looks like a message ID (numeric and large),
        // this is likely a reply, so default to general channel
        if (!channelName && /^\d+$/.test(threadIdStr) && parseInt(threadIdStr) > 1000) {
          logger.debug(`Edit appears to be for a reply (thread_id=${threadId} looks like message ID), defaulting to #general`);
          channelName = Object.keys(channelMappings).find(name => 
            !channelMappings[name].telegram
          ) || 'general';
        }
      } else {
        channelName = Object.keys(channelMappings).find(name => 
          !channelMappings[name].telegram
        );
      }
      
      if (!channelName) {
        logger.warn(`No mapping found for Telegram topic ${threadId}, skipping edited message ${msg.message_id}`);
        return;
      }
      
      // Check if this might be a deletion (some Telegram clients send empty edits for deletions)
      if (!msg.text && !msg.caption && !msg.photo && !msg.document && !msg.video) {
        const mappingId = this.messageTracker.get(msg.message_id);
        if (mappingId && this.deleteHandler) {
          logger.info(`Detected possible deletion via empty edit for Telegram message ${msg.message_id}`);
          await this.deleteHandler(Platform.Telegram, msg.message_id.toString());
          this.messageTracker.delete(msg.message_id);
          return;
        }
      }
      
      const username = msg.from.username || msg.from.first_name || 'Unknown';
      const content = msg.text || msg.caption || '[Media]';
      
      logger.info(`Telegram message edited: ${msg.message_id} in channel ${channelName} - New: "${content}"`);
      logPlatformMessage('Telegram', 'in', `(edited) ${content}`, username);
      
      if (this.messageHandler) {
        const relayMessage = await this.convertMessage(msg, channelName);
        relayMessage.isEdit = true;
        relayMessage.originalMessageId = msg.message_id.toString();
        
        try {
          // Always send the edit event to update the message content and handle reply updates
          await this.messageHandler(relayMessage);
        } catch (error) {
          logError(error as Error, 'Telegram edit handler');
        }
      }
    });

    this.bot.on('polling_error', (error: Error) => {
      const errorMessage = error.message || 'Unknown polling error';
      
      // Handle specific error types
      if (errorMessage.includes('ETELEGRAM: 409') || errorMessage.includes('Conflict')) {
        logger.error('Another instance of the bot is running. Stopping this instance.');
        this.status.lastError = 'Bot conflict - another instance running';
        this.isConnected = false;
        this.status.connected = false;
        return; // Don't reconnect for conflicts
      }
      
      if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNRESET')) {
        logger.warn('Telegram connection timeout/reset, will reconnect...');
      } else if (errorMessage.includes('502 Bad Gateway') || errorMessage.includes('No workers running')) {
        logger.warn('Telegram server issues detected, will retry...');
      } else {
        logError(error, 'Telegram polling error');
      }
      
      this.status.lastError = errorMessage;
      this.status.connected = false;
      this.isConnected = false;
      this.reconnectManager.scheduleReconnect();
    });

    this.bot.on('error', (error: Error) => {
      const errorMessage = error.message || 'Unknown error';
      
      // Don't log expected errors as errors
      if (errorMessage.includes('message to edit not found') || 
          errorMessage.includes('message to delete not found')) {
        logger.debug(`Expected Telegram error: ${errorMessage}`);
      } else {
        logError(error, 'Telegram error');
      }
      
      this.status.lastError = errorMessage;
    });

    // Listen for channel_post events (in case we're in a channel/supergroup)
    this.bot.on('channel_post', async (msg: TelegramBot.Message) => {
      // In channels, we might get deletion info
      logger.debug(`Channel post event: ${JSON.stringify(msg)}`);
    });

    // Listen for callback queries (for future inline button implementation)
    this.bot.on('callback_query', async (query) => {
      logger.debug(`Callback query: ${JSON.stringify(query)}`);
    });

    // Add command handler for /delete
    this.bot.onText(/^\/delete$/, async (msg) => {
      if (msg.chat.id.toString() !== config.telegram.groupId) return;
      if (!msg.from || msg.from.is_bot) return;

      // Check if this is a reply to a message
      if (msg.reply_to_message) {
        const repliedMsg = msg.reply_to_message;
        
        // Check if the replied message is from the bot (a relayed message)
        if (repliedMsg.from && repliedMsg.from.id === parseInt(config.telegram.botToken.split(':')[0])) {
          // Extract the original author from the message
          const match = repliedMsg.text?.match(/\[(Discord|Twitch)\]\s+([^:]+):\s*/);
          if (match) {
            const author = match[2].trim();
            const requestingUser = msg.from.username || msg.from.first_name || 'Unknown';
            
            // Check if the requesting user matches the original author
            if (author.toLowerCase() === requestingUser.toLowerCase()) {
              // Find the mapping for this bot message
              const botMessageId = repliedMsg.message_id;
              
              // Look through our mappings to find this message
              // We need to trigger deletion based on the bot's message ID
              if (this.deleteHandler) {
                logger.info(`User ${requestingUser} requested deletion of their message via /delete command`);
                await this.deleteHandler(Platform.Telegram, botMessageId.toString());
                
                // Delete the command message and the bot's message
                await this.bot.deleteMessage(msg.chat.id, msg.message_id);
                await this.bot.deleteMessage(msg.chat.id, botMessageId);
              }
            } else {
              // Not the original author
              const response = await this.bot.sendMessage(msg.chat.id, 
                `❌ You can only delete your own messages.`, 
                { reply_to_message_id: msg.message_id }
              );
              
              // Delete the response after 5 seconds
              setTimeout(() => {
                this.bot.deleteMessage(msg.chat.id, response.message_id);
                this.bot.deleteMessage(msg.chat.id, msg.message_id);
              }, 5000);
            }
          }
        } else {
          // Not a bot message
          const response = await this.bot.sendMessage(msg.chat.id, 
            `❌ Reply to a relayed message with /delete to remove it.`, 
            { reply_to_message_id: msg.message_id }
          );
          
          // Delete the response after 5 seconds
          setTimeout(() => {
            this.bot.deleteMessage(msg.chat.id, response.message_id);
            this.bot.deleteMessage(msg.chat.id, msg.message_id);
          }, 5000);
        }
      } else {
        // No reply
        const response = await this.bot.sendMessage(msg.chat.id, 
          `ℹ️ Reply to a relayed message with /delete to remove it from all platforms.`, 
          { reply_to_message_id: msg.message_id }
        );
        
        // Delete the response after 5 seconds
        setTimeout(() => {
          this.bot.deleteMessage(msg.chat.id, response.message_id);
          this.bot.deleteMessage(msg.chat.id, msg.message_id);
        }, 5000);
      }
    });

  }

  // Track a message ID to mapping ID relationship
  trackMessage(messageId: number, mappingId: string): void {
    this.messageTracker.set(messageId, mappingId);
    logger.info(`Tracking Telegram message ${messageId} with mapping ${mappingId}`);
    
    // Clean up old entries - limit map size
    if (this.messageTracker.size > 1000) {
      // Remove oldest entries
      const firstKey = this.messageTracker.keys().next().value;
      if (firstKey) {
        this.messageTracker.delete(firstKey);
      }
    }
  }

  private async connectInternal(): Promise<void> {
    try {
      if (this.isConnected) {
        logger.info('Stopping existing Telegram polling...');
        await this.bot.stopPolling({ cancel: true });
        this.isConnected = false;
      }
      
      logger.info('Starting Telegram polling with enhanced settings...');
      await this.bot.startPolling({ 
        polling: { 
          interval: 1000, // Increased interval to reduce server load
          autoStart: true,
          params: {
            timeout: 25, // Long polling timeout
            allowed_updates: ['message', 'edited_message', 'callback_query']
          }
        },
        restart: true // Auto-restart on errors
      });
      this.isConnected = true;
      this.status.connected = true;
      
      // Test connection and verify bot permissions
      const me = await this.bot.getMe();
      logger.info(`Telegram bot connected as @${me.username}`);
      
      // Check bot permissions in the group
      try {
        const chat = await this.bot.getChat(config.telegram.groupId);
        logger.info(`Connected to Telegram group: ${chat.title || 'Unknown'}, type: ${chat.type}`);
        
        // Get bot member info to check permissions
        const botMember = await this.bot.getChatMember(config.telegram.groupId, me.id);
        logger.info(`Bot permissions in group: ${JSON.stringify(botMember)}`);
        
        if (botMember.status === 'kicked' || botMember.status === 'left') {
          throw new Error(`Bot is ${botMember.status} from the group`);
        }
      } catch (chatError) {
        logger.error('Failed to get chat/member info:', chatError);
      }
    } catch (error) {
      logger.error('Failed to connect to Telegram:', error);
      this.isConnected = false;
      this.status.connected = false;
      throw error;
    }
  }

  async connect(): Promise<void> {
    await this.reconnectManager.connect();
  }

  async disconnect(): Promise<void> {
    this.reconnectManager.stop();
    
    // Clear message tracker
    this.messageTracker.clear();
    
    await this.bot.stopPolling();
    this.isConnected = false;
    this.status.connected = false;
    logger.info('Telegram disconnected');
  }

  async sendMessage(content: string, attachments?: Attachment[], replyToMessageId?: string, targetChannelId?: string): Promise<string | undefined> {
    const chatId = config.telegram.groupId;
    let messageId: string | undefined;
    let retryCount = 0;
    const maxRetries = 3;

    // Prepare options for reply and topic
    const messageOptions: any = {
      parse_mode: 'HTML' as const, // Enable HTML formatting for bold tags
      disable_web_page_preview: true
    };
    
    if (replyToMessageId) {
      messageOptions.reply_to_message_id = parseInt(replyToMessageId);
      logger.debug(`Telegram sendMessage: Setting reply_to_message_id to ${replyToMessageId}`);
    } else {
      logger.debug(`Telegram sendMessage: No replyToMessageId provided`);
    }
    
    // Add message_thread_id for topic support
    if (targetChannelId) {
      messageOptions.message_thread_id = parseInt(targetChannelId);
      logger.info(`Telegram sendMessage: Sending to topic ${targetChannelId}`);
    }

    // Retry wrapper for API calls
    const sendWithRetry = async (sendFunc: () => Promise<TelegramBot.Message>): Promise<TelegramBot.Message> => {
      while (retryCount < maxRetries) {
        try {
          const startTime = Date.now();
          const result = await sendFunc();
          const duration = Date.now() - startTime;
          
          if (duration > 3000) {
            logger.warn(`Telegram API call took ${duration}ms`);
          }
          
          return result;
        } catch (error: any) {
          retryCount++;
          const isRetryable = error.message && (
            error.message.includes('ETIMEDOUT') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('502 Bad Gateway') ||
            error.message.includes('No workers running')
          );
          
          if (isRetryable && retryCount < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
            logger.warn(`Telegram API error (attempt ${retryCount}/${maxRetries}), retrying in ${delay}ms:`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            throw error;
          }
        }
      }
      throw new Error('Max retries exceeded');
    };

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
            // sendMediaGroup returns an array, so handle it directly
            const messages = await this.bot.sendMediaGroup(chatId, media, messageOptions);
            messageId = messages[0].message_id.toString();
          } else {
            // Single custom emoji - send as small photo
            const msg = await sendWithRetry(() => this.bot.sendPhoto(chatId, customEmojis[0].url!, { 
              caption: content,
              disable_notification: true, // Less intrusive for emojis
              ...messageOptions
            }));
            messageId = msg.message_id.toString();
          }
        }
        
        // Handle other attachments normally
        for (const attachment of otherAttachments) {
          let msg: TelegramBot.Message;
          if (attachment.type === 'image' || attachment.type === 'gif') {
            if (attachment.url) {
              msg = await sendWithRetry(() => this.bot.sendPhoto(chatId, attachment.url!, { caption: content, ...messageOptions }));
            } else if (attachment.data) {
              msg = await sendWithRetry(() => this.bot.sendPhoto(chatId, attachment.data!, { caption: content, ...messageOptions }));
            }
          } else if (attachment.type === 'video') {
            if (attachment.url) {
              msg = await sendWithRetry(() => this.bot.sendVideo(chatId, attachment.url!, { caption: content, ...messageOptions }));
            } else if (attachment.data) {
              msg = await sendWithRetry(() => this.bot.sendVideo(chatId, attachment.data!, { caption: content, ...messageOptions }));
            }
          } else {
            if (attachment.url) {
              msg = await sendWithRetry(() => this.bot.sendDocument(chatId, attachment.url!, { caption: content, ...messageOptions }));
            } else if (attachment.data) {
              msg = await sendWithRetry(() => this.bot.sendDocument(chatId, attachment.data!, { caption: content, ...messageOptions }));
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
          const msg = await sendWithRetry(() => this.bot.sendMessage(chatId, content, messageOptions));
          messageId = msg.message_id.toString();
        }
      } else {
        const msg = await sendWithRetry(() => this.bot.sendMessage(chatId, content, messageOptions));
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

  async editMessage(messageId: string, newContent: string): Promise<boolean> {
    const chatId = config.telegram.groupId;

    try {
      // Note: Telegram API automatically handles editing messages in the correct topic
      // as long as we have the correct message_id
      await this.bot.editMessageText(newContent, {
        chat_id: chatId,
        message_id: parseInt(messageId),
        parse_mode: 'HTML', // Enable HTML formatting for bold tags
      });
      logger.info(`Telegram message ${messageId} edited successfully`);
      return true;
    } catch (error) {
      logger.error(`Failed to edit Telegram message ${messageId}: ${error}`);
      return false;
    }
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    const chatId = config.telegram.groupId;

    try {
      // Note: Telegram API automatically handles deleting messages in the correct topic
      // as long as we have the correct message_id
      await this.bot.deleteMessage(chatId, parseInt(messageId));
      logger.info(`Telegram message ${messageId} deleted successfully`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete Telegram message ${messageId}: ${error}`);
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

  private async convertMessage(msg: TelegramBot.Message, overrideChannelName?: string): Promise<RelayMessage> {
    // Debug logging
    logger.info(`Converting Telegram message ${msg.message_id}:`, {
      text: msg.text,
      caption: msg.caption,
      hasReplyTo: !!msg.reply_to_message,
      replyToId: msg.reply_to_message?.message_id,
      from: msg.from?.username || msg.from?.first_name
    });
    
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
    
    // Check if this is a reply
    let replyTo: RelayMessage['replyTo'] | undefined;
    if (msg.reply_to_message) {
      const replyMsg = msg.reply_to_message;
      
      // Process the reply
      let replyAuthor = replyMsg.from?.username || replyMsg.from?.first_name || 'Unknown';
      let replyContent = replyMsg.text || replyMsg.caption || '[No content]';
      
      // If replying to a bot message, extract the original author from the message content
      let replyPlatform: Platform | undefined;
      if (replyMsg.from?.is_bot && replyContent) {
        logger.debug(`Extracting reply info from bot message: "${replyContent}"`);
        // Pattern: [emoji] [Platform] username: message
        // First try to extract platform (with optional emoji prefix)
        const platformMatch = replyContent.match(/(?:.*?)?\[(Discord|Twitch)\]\s+([^:]+):\s*(.*)/);
        if (platformMatch) {
          replyPlatform = platformMatch[1] as Platform;
          replyAuthor = platformMatch[2].trim();
          replyContent = platformMatch[3] || '';
          logger.debug(`Extracted platform reply: platform=${replyPlatform}, author=${replyAuthor}, content="${replyContent}"`);
        } else {
          // Fallback to original pattern without platform extraction
          const authorMatch = replyContent.match(/(?:^[^\[]*)?(?:\[[\w]+\]\s+)?([^:]+):\s*(.*)/);
          if (authorMatch) {
            replyAuthor = authorMatch[1].trim();
            replyContent = authorMatch[2] || '';
            logger.debug(`Extracted simple reply: author=${replyAuthor}, content="${replyContent}"`);
          }
        }
      }
      
      // Only set replyTo if we actually have content (not "[No content]")
      // This prevents showing empty replies when replying to messages not in the bot's history
      if (replyContent !== '[No content]') {
        replyTo = {
          messageId: replyMsg.message_id.toString(),
          author: replyAuthor,
          content: replyContent,
          platform: replyPlatform,
        };
        logger.info(`Telegram message ${msg.message_id} is a reply to ${replyMsg.message_id} (author: ${replyAuthor}${replyPlatform ? `, platform: ${replyPlatform}` : ''})`);
      } else {
        logger.info(`Telegram message ${msg.message_id} is replying to message ${replyMsg.message_id} with no retrievable content, treating as regular message`);
      }
    }
    
    // Get channel name from thread ID or use override
    const threadId = msg.message_thread_id || undefined;
    let channelName: string | undefined;
    
    // Use override if provided (for replies that default to general)
    if (overrideChannelName) {
      channelName = overrideChannelName;
    } else if (threadId) {
      channelName = Object.keys(channelMappings).find(name => 
        channelMappings[name].telegram === threadId.toString()
      );
    } else {
      channelName = Object.keys(channelMappings).find(name => 
        !channelMappings[name].telegram
      );
    }
    
    return {
      id: msg.message_id.toString(),
      platform: Platform.Telegram,
      author: username,
      content: content,
      timestamp: new Date(msg.date * 1000),
      attachments: attachments.length > 0 ? attachments : undefined,
      replyTo,
      raw: msg,
      channelId: threadId?.toString(),
      channelName: channelName,
    };
  }
}
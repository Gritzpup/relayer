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
  private isShuttingDown: boolean = false;
  private pollingActive: boolean = false;
  private conflictDetected: boolean = false;
  private adminUserIds: Set<number> = new Set(); // Will be populated from environment variable
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
    
    // Initialize admin user IDs from environment variable or config
    // Format: comma-separated list of user IDs, e.g., "746386717,123456789"
    const adminIds = process.env.TELEGRAM_ADMIN_IDS || '746386717';
    adminIds.split(',').forEach(id => {
      const numId = parseInt(id.trim());
      if (!isNaN(numId)) {
        this.adminUserIds.add(numId);
        logger.info(`Added Telegram admin ID: ${numId}`);
      }
    });
    logger.info(`Initialized with ${this.adminUserIds.size} admin(s): ${Array.from(this.adminUserIds).join(', ')}`);
    
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
      // console.log(`[TELEGRAM MESSAGE] Received from ${msg.from?.username || msg.from?.first_name || 'Unknown'} in chat ${msg.chat.id}`);
      
      if (this.conflictDetected || this.isShuttingDown) return;
      if (msg.chat.id.toString() !== config.telegram.groupId) {
        // console.log(`[TELEGRAM] Skipping message from wrong chat: ${msg.chat.id} !== ${config.telegram.groupId}`);
        return;
      }
      if (msg.from?.is_bot) return;
      
      // Check if this is a relayed message (has platform prefix with or without emoji)
      // Pattern handles Unicode bold formatting used by the bot
      // Example: "🔵 [𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗺] 𝗚𝗿𝗶𝘁𝘇𝗽𝘂𝗽: test"
      const messageText = msg.text || msg.caption || '';
      const relayPattern = /^[🟦🔵💙🟢💚🔴❤️]\s*\[([^\]]+)\]\s*([^:]+):\s*(.*)$/;
      const relayMatch = messageText.match(relayPattern);
      
      if (relayMatch) {
        logger.debug(`TELEGRAM RELAY SKIP: Detected relayed message from ${relayMatch[1]}, skipping to prevent loop`);
        return; // Skip relaying it back
      }
      
      // Get the topic/thread ID (for supergroups with topics)
      let threadId = msg.message_thread_id || undefined;
      let channelName: string | undefined;
      
      // IMPORTANT: If this is a reply, we need to handle it differently
      // In Telegram supergroups, replies might have the wrong message_thread_id
      // We should process the reply and determine the channel from context
      if (msg.reply_to_message) {
        // logger.info(`Processing reply message ${msg.message_id}, original thread_id: ${threadId}`);
        
        // For replies, try to determine the actual topic from the message being replied to
        // First check if threadId matches a known topic
        if (threadId) {
          channelName = Object.keys(channelMappings).find(name => 
            channelMappings[name].telegram === threadId.toString()
          );
          
          // If threadId doesn't match any topic, it might be a reply in general chat
          // In general chat, message_thread_id can be the ID of the message being replied to
          if (!channelName) {
            // Check if this looks like a message ID (large number) rather than a topic ID
            const threadIdNum = parseInt(threadId.toString());
            if (threadIdNum > 1000) {
              // This is likely a reply in general chat
              channelName = Object.keys(channelMappings).find(name => 
                !channelMappings[name].telegram
              );
              logger.info(`Reply ${msg.message_id} has large thread_id ${threadId}, treating as general chat reply`);
            }
          }
        } else {
          // No thread ID means general chat
          channelName = Object.keys(channelMappings).find(name => 
            !channelMappings[name].telegram
          );
        }
        
        // If still no channel found, skip the message
        if (!channelName) {
          logger.warn(`Reply message ${msg.message_id} from unmapped topic ${threadId}, skipping`);
          return;
        }
        // logger.info(`Reply message ${msg.message_id} mapped to channel: ${channelName}`);
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
      
      // // logger.info(`Telegram message in #${channelName}:`, debugInfo);
      
      // Extra logging for reply detection issues (commented out)
      if (msg.reply_to_message) {
        // logger.info(`REPLY DETECTED - Full reply_to_message:`, {
        //   reply_msg_id: msg.reply_to_message.message_id,
        //   reply_from: msg.reply_to_message.from?.username || msg.reply_to_message.from?.first_name,
        //   reply_text: msg.reply_to_message.text?.substring(0, 50),
        //   reply_is_bot: msg.reply_to_message.from?.is_bot,
        //   current_thread_id: msg.message_thread_id,
        //   is_same_as_thread: msg.reply_to_message.message_id === msg.message_thread_id
        // });
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
        // // logger.info(`Telegram message entities:`, JSON.stringify(msg.entities));
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
      if (this.conflictDetected || this.isShuttingDown) return;
      
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
      
      // logger.info(`Telegram message edited: ${msg.message_id} in channel ${channelName} - New: "${content}"`);
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
        if (!this.conflictDetected) {
          console.error('[TELEGRAM] ⚠️ 409 Conflict: Another bot instance is running with the same token');
          logger.error('Another instance of the bot is running. Stopping polling for this instance.');
          this.conflictDetected = true;
          this.status.lastError = 'Bot conflict - another instance running';
          this.isConnected = false;
          this.status.connected = false;
          this.pollingActive = false;  // Make sure to reset this
          
          // Stop polling immediately to prevent further errors
          this.bot.stopPolling({ cancel: true }).catch(err => {
            logger.error('Error stopping polling after conflict:', err);
          });
          
          // DO NOT try to reconnect when there's a conflict
          // The user needs to resolve this manually
          logger.warn('IMPORTANT: Another bot instance is using the same token. Please stop the other instance before restarting this one.');
        }
        return; // Don't reconnect for conflicts
      }
      
      // Reset conflict flag if we get a different error
      if (this.conflictDetected) {
        this.conflictDetected = false;
      }
      
      // Handle file-related errors
      if (errorMessage.includes('wrong file_id') || errorMessage.includes('file is temporarily unavailable')) {
        logger.warn('Telegram file error detected, will continue normally:', errorMessage);
        // Don't disconnect for file errors - they're handled per-message
        return;
      }
      
      if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNRESET')) {
        logger.warn('Telegram connection timeout/reset, will reconnect...');
      } else if (errorMessage.includes('502 Bad Gateway') || errorMessage.includes('No workers running')) {
        logger.warn('Telegram server issues detected, will retry...');
      } else {
        logError(error, 'Telegram polling error');
      }
      
      // Reset all connection flags on error
      this.status.lastError = errorMessage;
      this.status.connected = false;
      this.isConnected = false;
      this.pollingActive = false;  // IMPORTANT: Reset polling flag on error
      
      // Try to stop polling to clean up
      this.bot.stopPolling({ cancel: true }).catch(() => {
        // Ignore errors when stopping after a polling error
      });
      
      // Only try to reconnect if we're not shutting down and no conflict detected
      if (!this.isShuttingDown && !this.conflictDetected) {
        logger.info('[TELEGRAM] Scheduling reconnection after polling error...');
        this.reconnectManager.scheduleReconnect();
      }
    });

    this.bot.on('error', (error: Error) => {
      const errorMessage = error.message || 'Unknown error';
      
      // Don't log expected errors as errors
      if (errorMessage.includes('message to edit not found') || 
          errorMessage.includes('message to delete not found') ||
          errorMessage.includes('wrong file_id') ||
          errorMessage.includes('file is temporarily unavailable')) {
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
      if (this.conflictDetected || this.isShuttingDown) return;
      if (msg.chat.id.toString() !== config.telegram.groupId) return;
      if (!msg.from || msg.from.is_bot) return;

      // Check if this is a reply to a message
      if (msg.reply_to_message) {
        const repliedMsg = msg.reply_to_message;
        
        // Check if the replied message is from the bot (a relayed message)
        if (repliedMsg.from && repliedMsg.from.id === parseInt(config.telegram.botToken.split(':')[0])) {
          // Check if the user is an admin
          const isAdmin = this.adminUserIds.has(msg.from.id);
          
          // Extract the original author from the message
          const match = repliedMsg.text?.match(/\[(Discord|Twitch)\]\s+([^:]+):\s*/);
          if (match) {
            const author = match[2].trim();
            const requestingUser = msg.from.username || msg.from.first_name || 'Unknown';
            
            // Check if the requesting user is admin OR matches the original author
            if (isAdmin || author.toLowerCase() === requestingUser.toLowerCase()) {
              // Find the mapping for this bot message
              const botMessageId = repliedMsg.message_id;
              
              // Look through our mappings to find this message
              // We need to trigger deletion based on the bot's message ID
              if (this.deleteHandler) {
                if (isAdmin && author.toLowerCase() !== requestingUser.toLowerCase()) {
                  logger.info(`Admin ${requestingUser} (ID: ${msg.from.id}) requested deletion of ${author}'s message via /delete command`);
                  // Pass true for isAdminDeletion to delete on ALL platforms
                  await this.deleteHandler(Platform.Telegram, botMessageId.toString(), true);
                } else {
                  logger.info(`User ${requestingUser} requested deletion of their message via /delete command`);
                  await this.deleteHandler(Platform.Telegram, botMessageId.toString());
                }
                
                // Delete the command message and the bot's message
                await this.bot.deleteMessage(msg.chat.id, msg.message_id);
                await this.bot.deleteMessage(msg.chat.id, botMessageId);
              }
            } else {
              // Not the original author and not an admin
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

    // Add command handler for /admin to check admin status
    this.bot.onText(/^\/admin$/, async (msg) => {
      if (this.conflictDetected || this.isShuttingDown) return;
      if (msg.chat.id.toString() !== config.telegram.groupId) return;
      if (!msg.from || msg.from.is_bot) return;
      
      const isAdmin = this.adminUserIds.has(msg.from.id);
      const username = msg.from.username || msg.from.first_name || 'Unknown';
      
      const response = await this.bot.sendMessage(msg.chat.id, 
        isAdmin 
          ? `✅ ${username} (ID: ${msg.from.id}) is an admin. You can delete any relayed message.`
          : `❌ ${username} (ID: ${msg.from.id}) is not an admin. You can only delete your own messages.`,
        { reply_to_message_id: msg.message_id }
      );
      
      // Delete the command and response after 10 seconds
      setTimeout(() => {
        this.bot.deleteMessage(msg.chat.id, response.message_id).catch(() => {});
        this.bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
      }, 10000);
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
    // logger.info('[TELEGRAM] Starting connection attempt...');
    // console.log('[TELEGRAM] Attempting to connect with token:', config.telegram.botToken.substring(0, 15) + '...');
    // console.log('[TELEGRAM] Target group ID:', config.telegram.groupId);
    
    try {
      // Don't try to connect if conflict detected
      if (this.conflictDetected) {
        logger.warn('Cannot connect: Bot conflict detected. Another instance is using this token.');
        console.error('[TELEGRAM] ⚠️ Bot conflict detected - another instance is running');
        throw new Error('Bot conflict detected');
      }
      
      // Always try to stop any existing polling first (from previous runs)
      try {
        await this.bot.stopPolling({ cancel: true });
        // logger.info('[TELEGRAM] Cleared previous polling instance');
      } catch (stopError) {
        // This is expected on first run, ignore
        // logger.debug('[TELEGRAM] No previous polling to stop (normal on first run)');
      }
      
      // Always wait a bit before starting polling to avoid conflicts
      // This helps prevent "EFATAL: AggregateError" on initial connection
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Now handle if we were already connected in this instance
      if (this.pollingActive || this.isConnected) {
        logger.info('[TELEGRAM] Stopping existing polling before reconnect...');
        try {
          await this.bot.stopPolling({ cancel: true });
        } catch (stopError) {
          logger.warn('[TELEGRAM] Error stopping polling (this is normal during reconnect):', stopError);
        }
        this.isConnected = false;
        this.pollingActive = false;
        this.status.connected = false;
        
        // Give the connection a moment to fully close
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // logger.info('[TELEGRAM] Starting polling with enhanced settings...');
      // console.log('[TELEGRAM] Starting polling...');
      
      // Try to start polling with error recovery
      try {
        this.pollingActive = true;
        await this.bot.startPolling({ 
          polling: { 
            interval: 1000, // Increased interval to reduce server load
            autoStart: true,
            params: {
              timeout: 25, // Long polling timeout
              allowed_updates: ['message', 'edited_message', 'callback_query']
            }
          },
          restart: false // Don't auto-restart on errors, we handle this manually
        });
        this.isConnected = true;
        this.status.connected = true;
      } catch (pollError: any) {
        // If we get EFATAL or AggregateError, it might be a conflict issue
        if (pollError.message?.includes('EFATAL') || pollError.message?.includes('AggregateError')) {
          logger.warn('[TELEGRAM] Initial polling conflict detected, retrying with longer delay...');
          this.pollingActive = false;
          
          // Stop any conflicting polling
          try {
            await this.bot.stopPolling({ cancel: true });
          } catch (e) {
            // Ignore stop errors
          }
          
          // Wait longer and retry once
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          this.pollingActive = true;
          await this.bot.startPolling({ 
            polling: { 
              interval: 1000,
              autoStart: true,
              params: {
                timeout: 25,
                allowed_updates: ['message', 'edited_message', 'callback_query']
              }
            },
            restart: false
          });
          this.isConnected = true;
          this.status.connected = true;
        } else {
          // Re-throw other errors
          throw pollError;
        }
      }
      
      // Test connection and verify bot permissions
      const me = await this.bot.getMe();
      // logger.info(`[TELEGRAM] ✅ Successfully connected as @${me.username}`);
      // console.log(`[TELEGRAM] Bot connected successfully as @${me.username}`);
      // console.log(`[TELEGRAM] Bot ID: ${me.id}`);
      
      // Check bot permissions in the group
      try {
        const chat = await this.bot.getChat(config.telegram.groupId);
        // logger.info(`[TELEGRAM] Connected to group: ${chat.title || 'Unknown'}, type: ${chat.type}`);
        // console.log(`[TELEGRAM] Group info - Title: ${chat.title}, Type: ${chat.type}, ID: ${chat.id}`);
        
        // Get bot member info to check permissions
        const botMember = await this.bot.getChatMember(config.telegram.groupId, me.id);
        // logger.info(`[TELEGRAM] Bot permissions: ${JSON.stringify(botMember)}`);  
        // console.log(`[TELEGRAM] Bot status in group: ${botMember.status}`);
        
        if (botMember.status === 'kicked' || botMember.status === 'left') {
          console.error(`[TELEGRAM] ❌ Bot is ${botMember.status} from the group`);
          throw new Error(`Bot is ${botMember.status} from the group`);
        }
        // console.log('[TELEGRAM] ✅ Bot has proper permissions in the group');
      } catch (chatError) {
        console.error('[TELEGRAM] Failed to verify group permissions:', chatError);
        logger.error('Failed to get chat/member info:', chatError);
      }
      
      // console.log('[TELEGRAM] ✅ Connection established and polling active');
    } catch (error) {
      console.error('[TELEGRAM] ❌ Connection failed:', error);
      logger.error('[TELEGRAM] Failed to connect:', error);
      this.isConnected = false;
      this.status.connected = false;
      this.pollingActive = false;
      throw error;
    }
  }

  async connect(): Promise<void> {
    // Don't try to connect if conflict detected
    if (this.conflictDetected) {
      logger.error('Cannot connect: Another bot instance is using the same token.');
      logger.error('Please stop the other instance before trying to connect.');
      throw new Error('Bot conflict - another instance is running');
    }
    
    await this.reconnectManager.connect();
  }

  async disconnect(): Promise<void> {
    logger.info('Disconnecting Telegram service...');
    this.isShuttingDown = true;
    this.reconnectManager.stop();
    
    // Clear message tracker
    this.messageTracker.clear();
    
    if (this.pollingActive) {
      await this.bot.stopPolling({ cancel: true });
      this.pollingActive = false;
    }
    
    this.isConnected = false;
    this.status.connected = false;
    this.conflictDetected = false;
    this.isShuttingDown = false;
    logger.info('Telegram disconnected');
  }

  async sendMessage(content: string, attachments?: Attachment[], replyToMessageId?: string, targetChannelId?: string, _originalMessage?: RelayMessage): Promise<string | undefined> {
    // Don't send if conflict detected
    if (this.conflictDetected) {
      logger.error('Cannot send message: Bot conflict detected');
      return undefined;
    }
    
    const chatId = config.telegram.groupId;
    let messageId: string | undefined;
    let retryCount = 0;
    const maxRetries = 3;

    // [Rest of sendMessage method remains the same...]
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
            error.message.includes('No workers running') ||
            error.message.includes('wrong file_id') ||
            error.message.includes('file is temporarily unavailable')
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
        // Separate custom emojis and Lottie stickers from other attachments
        const customEmojis = attachments.filter(a => a.type === 'custom-emoji');
        const lottieStickers = attachments.filter(a => a.type === 'sticker' && a.mimeType === 'application/json');
        const otherAttachments = attachments.filter(a => a.type !== 'custom-emoji' && !(a.type === 'sticker' && a.mimeType === 'application/json'));
        
        // Log Lottie stickers that are being skipped
        if (lottieStickers.length > 0) {
          logger.info(`Skipping ${lottieStickers.length} Lottie sticker(s) in Telegram - will show as text only`);
        }
        
        // Send custom emojis as a single message with multiple photos if possible
        if (customEmojis.length > 0) {
          // For multiple custom emojis, send them as an album (small, grouped)
          if (customEmojis.length > 1) {
            const media = customEmojis.map((emoji, index) => ({
              type: 'photo' as const,
              media: emoji.url!,
              caption: index === 0 ? content : undefined,
            }));
            // sendMediaGroup returns an array, so handle it appropriately
            try {
              const messages = await sendWithRetry(async () => {
                const result = await this.bot.sendMediaGroup(chatId, media, messageOptions);
                return result[0]; // Return first message for consistency with sendWithRetry
              });
              messageId = messages.message_id.toString();
            } catch (error: any) {
              // If media group fails, try sending just the content as text
              logger.error('Failed to send media group, falling back to text:', error.message);
              const msg = await sendWithRetry(() => this.bot.sendMessage(chatId, content, messageOptions));
              messageId = msg.message_id.toString();
            }
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
          try {
            let msg: TelegramBot.Message | undefined;
            if (attachment.type === 'image' || attachment.type === 'gif' || attachment.type === 'sticker') {
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
            if (msg && !messageId) {
              messageId = msg.message_id.toString();
            }
          } catch (error: any) {
            // Log error but continue with other attachments
            logger.error(`Failed to send attachment (${attachment.type}), skipping:`, error.message);
            // If this was the first attachment and we haven't sent anything yet, 
            // make sure we at least send the text content
            if (!messageId && content) {
              try {
                const msg = await sendWithRetry(() => this.bot.sendMessage(chatId, content, messageOptions));
                messageId = msg.message_id.toString();
              } catch (textError) {
                logger.error('Failed to send text fallback:', textError);
              }
            }
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
    // Don't edit if conflict detected
    if (this.conflictDetected) {
      logger.error('Cannot edit message: Bot conflict detected');
      return false;
    }
    
    const chatId = config.telegram.groupId;

    try {
      // Note: Telegram API automatically handles editing messages in the correct topic
      // as long as we have the correct message_id
      await this.bot.editMessageText(newContent, {
        chat_id: chatId,
        message_id: parseInt(messageId),
        parse_mode: 'HTML', // Enable HTML formatting for bold tags
      });
      // logger.info(`Telegram message ${messageId} edited successfully`);
      return true;
    } catch (error) {
      logger.error(`Failed to edit Telegram message ${messageId}: ${error}`);
      return false;
    }
  }

  async deleteMessage(messageId: string, _channelId?: string): Promise<boolean> {
    // Don't delete if conflict detected
    if (this.conflictDetected) {
      logger.error('Cannot delete message: Bot conflict detected');
      return false;
    }
    
    const chatId = config.telegram.groupId;

    try {
      // Note: Telegram API automatically handles deleting messages in the correct topic
      // as long as we have the correct message_id
      await this.bot.deleteMessage(chatId, parseInt(messageId));
      // logger.info(`Telegram message ${messageId} deleted successfully`);
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
    // Update connection status based on actual state
    this.status.connected = this.isConnected && this.pollingActive && !this.conflictDetected;
    return { ...this.status };
  }
  
  // Health check method to verify connection is still alive
  async isHealthy(): Promise<boolean> {
    if (!this.isConnected || !this.pollingActive || this.conflictDetected) {
      return false;
    }
    
    try {
      // Try to get bot info as a health check
      await this.bot.getMe();
      return true;
    } catch (error) {
      logger.warn('[TELEGRAM] Health check failed:', error);
      this.isConnected = false;
      this.pollingActive = false;
      this.status.connected = false;
      return false;
    }
  }

  private async convertMessage(msg: TelegramBot.Message, overrideChannelName?: string): Promise<RelayMessage> {
    // [convertMessage method remains the same...]
    // Debug logging (commented out)
    // logger.info(`Converting Telegram message ${msg.message_id}:`, {
    //   text: msg.text,
    //   caption: msg.caption,
    //   hasReplyTo: !!msg.reply_to_message,
    //   replyToId: msg.reply_to_message?.message_id,
    //   from: msg.from?.username || msg.from?.first_name
    // });
    
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
      try {
        const largestPhoto = msg.photo[msg.photo.length - 1];
        const fileLink = await this.bot.getFileLink(largestPhoto.file_id);
        attachments.push({
          type: 'image',
          url: fileLink,
        });
      } catch (error) {
        logger.error('Failed to get photo file link:', error);
      }
    }

    if (msg.video) {
      try {
        const fileLink = await this.bot.getFileLink(msg.video.file_id);
        attachments.push({
          type: 'video',
          url: fileLink,
        });
      } catch (error) {
        logger.error('Failed to get video file link:', error);
      }
    }

    if (msg.document) {
      try {
        const fileLink = await this.bot.getFileLink(msg.document.file_id);
        attachments.push({
          type: 'file',
          url: fileLink,
          filename: msg.document.file_name,
          mimeType: msg.document.mime_type,
        });
      } catch (error) {
        logger.error('Failed to get document file link:', error);
      }
    }

    if (msg.sticker) {
      try {
        const fileLink = await this.bot.getFileLink(msg.sticker.file_id);
        attachments.push({
          type: 'sticker',
          url: fileLink,
          filename: 'sticker.webp',
          mimeType: 'image/webp',
          data: msg.sticker.emoji ? Buffer.from(msg.sticker.emoji) : undefined,
        });
      } catch (error) {
        logger.error('Failed to get sticker file link:', error);
        if (msg.sticker.emoji) {
          attachments.push({
            type: 'sticker',
            url: '',
            filename: 'sticker.webp',
            mimeType: 'image/webp',
            data: Buffer.from(msg.sticker.emoji),
          });
        }
      }
    }

    const username = msg.from?.username || msg.from?.first_name || 'Unknown';
    
    let content = msg.text || msg.caption || '';
    if (msg.sticker && !msg.text && !msg.caption) {
      content = '';
    }
    
    if (msg.entities && msg.text && content) {
      const customEmojiEntities = (msg.entities || [])
        .filter(e => e.type === 'custom_emoji')
        .sort((a, b) => b.offset - a.offset);
      
      for (const entity of customEmojiEntities) {
        content = content.substring(0, entity.offset) + 
                  content.substring(entity.offset + entity.length);
      }
      
      content = content.trim();
    }
    
    let replyTo: RelayMessage['replyTo'] | undefined;
    if (msg.reply_to_message) {
      const replyMsg = msg.reply_to_message;
      
      let replyAuthor = replyMsg.from?.username || replyMsg.from?.first_name || 'Unknown';
      let replyContent = replyMsg.text || replyMsg.caption || '[No content]';
      
      let replyPlatform: Platform | undefined;
      if (replyMsg.from?.is_bot && replyContent) {
        logger.info(`REPLY EXTRACTION: Processing bot message reply: "${replyContent}"`);
        const platformMatch = replyContent.match(/^(?:.*?)\[(Discord|Twitch|Telegram)\]\s+([^:]+):\s*(.*)/);
        if (platformMatch) {
          replyPlatform = platformMatch[1] as Platform;
          replyAuthor = platformMatch[2].trim();
          replyContent = platformMatch[3] || '';
          logger.info(`REPLY EXTRACTION: Successfully extracted - platform=${replyPlatform}, author=${replyAuthor}, content="${replyContent}"`);
        } else {
          const authorMatch = replyContent.match(/^(?:[^\s]+\s+)?([^:]+):\s*(.*)/);
          if (authorMatch) {
            replyAuthor = authorMatch[1].trim();
            replyContent = authorMatch[2] || '';
            logger.debug(`Extracted simple reply: author=${replyAuthor}, content="${replyContent}"`);
          }
        }
      }
      
      if (replyContent !== '[No content]') {
        replyTo = {
          messageId: replyMsg.message_id.toString(),
          author: replyAuthor,
          content: replyContent,
          platform: replyPlatform,
        };
        // logger.info(`Telegram message.*is a reply to ${replyMsg.message_id} (author: ${replyAuthor}${replyPlatform ? `, platform: ${replyPlatform}` : ''})`);
      } else {
        logger.info(`Telegram message ${msg.message_id} is replying to message ${replyMsg.message_id} with no retrievable content, treating as regular message`);
      }
    }
    
    const threadId = msg.message_thread_id || undefined;
    let channelName: string | undefined;
    
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
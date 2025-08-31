import { Platform, PlatformService, RelayMessage } from '../types';
import { DiscordService } from '../services/discord';
import { TelegramService } from '../services/telegram';
import { TwitchService } from '../services/twitch';
import { MessageFormatter } from './formatter';
import { MessageMapper } from './messageMapper';
import { RateLimiter } from './rateLimit';
import { config, channelMappings } from '../config';
import { logger, logError } from '../utils/logger';
import { messageDb } from '../database/db';
import { initializeRedis, closeRedis } from '../services/redis';
import { redisEvents, DeletionEvent } from './redisEvents';

export class RelayManager {
  services: Map<Platform, PlatformService> = new Map(); // Made public for webhook access
  messageMapper: MessageMapper; // Made public for webhook access
  private formatter: MessageFormatter;
  private rateLimiter: RateLimiter;
  private messageHistory: string[] = [];
  private isRunning: boolean = false;

  constructor() {
    this.formatter = new MessageFormatter();
    this.messageMapper = new MessageMapper();
    this.rateLimiter = new RateLimiter();
    
    this.services.set(Platform.Discord, new DiscordService());
    this.services.set(Platform.Telegram, new TelegramService());
    this.services.set(Platform.Twitch, new TwitchService());
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Relay manager is already running');
      return;
    }

    logger.info('Starting relay manager...');
    console.log('[RELAY] Starting relay manager...');
    this.isRunning = true;

    // Initialize Redis
    console.log('[RELAY] Initializing Redis...');
    initializeRedis();
    
    // Subscribe to deletion events from Redis
    console.log('[RELAY] Subscribing to Redis deletion events...');
    await redisEvents.subscribeToDeletions(async (event: DeletionEvent) => {
      // logger.info(`Processing deletion event from Redis: ${event.platform} message ${event.messageId}`);
      await this.handleDeletionEvent(event);
    });
    console.log('[RELAY] ✅ Redis initialized');

    console.log('[RELAY] Setting up message handlers...');
    this.setupMessageHandlers();
    console.log('[RELAY] ✅ Message handlers configured');

    // Initialize Twitch token manager before connecting
    console.log('[RELAY] Initializing Twitch service...');
    const twitchService = this.services.get(Platform.Twitch);
    if (twitchService && 'initialize' in twitchService) {
      await (twitchService as any).initialize();
      console.log('[RELAY] ✅ Twitch service initialized');
    }

    console.log('[RELAY] Connecting to all platforms...');
    const services = Array.from(this.services.values());
    
    for (const service of services) {
      console.log(`[RELAY] Connecting to ${service.platform}...`);
      try {
        await service.connect();
        console.log(`[RELAY] ✅ ${service.platform} connected successfully`);
      } catch (error) {
        console.error(`[RELAY] ❌ Failed to connect to ${service.platform}:`, error);
        logError(error as Error, `Failed to connect ${service.platform}`);
      }
    }
    
    logger.info('Relay manager started successfully');
    console.log('[RELAY] ✅ All connections established');
    this.logStatus();
    
    // Log connection status for each service
    console.log('\n[RELAY] Service Status:');
    this.services.forEach(service => {
      const status = service.getStatus();
      console.log(`  ${service.platform}: ${status.connected ? '✅ Connected' : '❌ Disconnected'}`);
      if (status.lastError) {
        console.log(`    Last error: ${status.lastError}`);
      }
    });
    console.log('');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Relay manager is not running');
      return;
    }

    logger.info('Stopping relay manager...');
    this.isRunning = false;

    // Unsubscribe from Redis events
    await redisEvents.unsubscribe();

    const disconnectionPromises = Array.from(this.services.values()).map(service =>
      service.disconnect().catch(error => {
        logError(error as Error, `Failed to disconnect ${service.platform}`);
      })
    );

    await Promise.all(disconnectionPromises);
    
    // Close Redis connections
    await closeRedis();
    
    logger.info('Relay manager stopped successfully');
  }

  private setupMessageHandlers(): void {
    this.services.forEach(service => {
      service.onMessage(async (message: RelayMessage) => {
        if (message.isEdit) {
          await this.handleEdit(message);
        } else {
          await this.handleMessage(message);
        }
      });
      
      service.onDelete(async (platform: Platform, messageId: string, isAdminDeletion?: boolean) => {
        await this.handleDeletion(platform, messageId, isAdminDeletion || false);
      });
    });
  }

  private async handleMessage(message: RelayMessage): Promise<void> {
    // Always track the message, even if we're not relaying it
    // This allows us to handle replies to native messages
    // logger.info(`[CHANNEL DEBUG] Message from ${message.platform} channel: ${message.channelName} (ID: ${message.channelId})`);
    
    if (message.replyTo) {
      logger.debug(`Processing message ${message.id} from ${message.platform} which is a reply to ${message.replyTo.messageId}`);
      if (message.replyTo.platform) {
        logger.debug(`Reply is to a message from platform: ${message.replyTo.platform}`);
      }
    }
    
    const mappingId = await this.messageMapper.createMapping(
      message.platform,
      message.id,
      message.content,
      message.author,
      message.replyTo?.messageId,
      message.replyTo?.content,
      message.replyTo?.author,
      message.replyTo?.platform,
      message.channelId  // Pass the channel ID for Discord messages
    );

    // Update database with mapping ID for Telegram messages
    if (message.platform === Platform.Telegram) {
      const messageIdNum = parseInt(message.id);
      if (!isNaN(messageIdNum)) {
        // // logger.info(`Updating mapping_id for Telegram message ${messageIdNum} to ${mappingId}`);
        await messageDb.updateMappingId(messageIdNum, mappingId);
      }
    }

    // Check if we should relay this message
    if (!this.formatter.shouldRelayMessage(message)) {
      logger.debug(`Not relaying message from ${message.platform}: ${message.content} (but tracking it for replies)`);
      return;
    }

    if (this.isDuplicateMessage(message)) {
      logger.debug(`Duplicate message detected from ${message.platform}: ${message.content}`);
      return;
    }

    this.addToHistory(message);

    const targetPlatforms = this.getTargetPlatforms(message.platform);
    
    for (const targetPlatform of targetPlatforms) {
      await this.relayToPlatform(message, targetPlatform, mappingId);
    }
  }

  private async handleEdit(message: RelayMessage): Promise<void> {
    if (!message.originalMessageId) {
      logger.error('Edit event received without originalMessageId');
      return;
    }

    logger.info(`Handling edit for message ${message.originalMessageId} from ${message.platform}`);

    // Find the mapping for the original message
    const mapping = await this.messageMapper.getMappingByPlatformMessage(message.platform, message.originalMessageId);
    if (!mapping) {
      logger.warn(`No mapping found for edited message ${message.originalMessageId} from ${message.platform}`);
      return;
    }

    // Update the content in the mapping
    await this.messageMapper.updateMessageContent(message.platform, message.originalMessageId, message.content);
    logger.info(`Updated content for ${message.platform}:${message.originalMessageId} to: "${message.content}"`);

    // Find all messages that reply to this edited message
    const replies = await this.messageMapper.findRepliesTo(mapping.id);
    logger.info(`Found ${replies.length} replies to edited message ${mapping.id}`);
    
    // Log details about each reply found
    for (const reply of replies) {
      // logger.info(`Reply found: ${reply.id} from ${reply.originalPlatform}, platforms: ${JSON.stringify(reply.platformMessages)}`);
    }
    
    // Handle replies in Twitch (need to delete and re-send with updated reply context)
    for (const reply of replies) {
      const twitchReplyId = reply.platformMessages[Platform.Twitch];
      if (twitchReplyId) {
        const twitchService = this.services.get(Platform.Twitch);
        if (twitchService && twitchService.getStatus().connected) {
          try {
            logger.info(`Handling Twitch reply ${twitchReplyId} to edited message`);
            
            // Try to delete the old reply
            const deleteSuccess = await twitchService.deleteMessage(twitchReplyId);
            if (deleteSuccess) {
              logger.info(`Deleted old Twitch reply ${twitchReplyId}`);
              
              // Re-create the reply message with updated context
              const replyMessage: RelayMessage = {
                id: reply.originalMessageId,
                platform: reply.originalPlatform as Platform,
                author: reply.author,
                content: reply.content,
                channelName: 'general', // Twitch only has general
                timestamp: new Date(),
                attachments: [],
                replyTo: {
                  messageId: message.id,
                  author: message.author,
                  content: message.content, // Use the new edited content
                  platform: message.platform
                }
              };
              
              // Format the message with updated reply context
              logger.info(`Formatting Twitch reply with updated context. Reply author: "${replyMessage.author}", Reply content: "${replyMessage.content}", Updated parent content: "${message.content}"`);
              const formattedContent = this.formatter.formatForPlatform(replyMessage, Platform.Twitch, {
                author: message.author,
                content: message.content
              });
              logger.info(`Formatted Twitch reply: "${formattedContent}"`);
              
              // Send the new reply
              const newReplyId = await twitchService.sendMessage(formattedContent);
              if (newReplyId) {
                await this.messageMapper.updatePlatformMessage(reply.id, Platform.Twitch, newReplyId);
                logger.info(`Re-sent Twitch reply with new ID ${newReplyId}`);
              } else {
                logger.error(`Failed to re-send Twitch reply`);
              }
            } else {
              logger.warn(`Could not delete old Twitch reply ${twitchReplyId} - bot needs moderator permissions`);
            }
          } catch (error) {
            logger.error(`Failed to handle Twitch reply to edited message:`, error);
          }
        }
      }
    }

    // Get all platform messages for this mapping
    const platformMessages = mapping.platformMessages;
    
    // Relay the edit to all other platforms
    for (const [platform, messageId] of Object.entries(platformMessages)) {
      const targetPlatform = platform as Platform;
      if (targetPlatform === message.platform || !messageId) continue; // Skip the source platform
      
      const service = this.services.get(targetPlatform);
      if (!service) continue;
      
      const status = service.getStatus();
      if (!status.connected) {
        logger.warn(`Cannot relay edit to ${targetPlatform}: Not connected`);
        continue;
      }

      try {
        // Handle reply info for edits (especially important for Twitch)
        let replyInfo: { author: string; content: string } | undefined;
        if (message.replyTo) {
          replyInfo = {
            author: message.replyTo.author,
            content: message.replyTo.content
          };
        }
        
        // Determine if we should show reply context (same logic as normal relay)
        const shouldShowReplyContext = (targetPlatform === Platform.Twitch) || 
                                      (replyInfo && targetPlatform === Platform.Discord) || 
                                      (message.platform === Platform.Twitch && message.replyTo);
        const formatterReplyInfo = shouldShowReplyContext ? replyInfo : undefined;
        
        // Format the edited content for the target platform
        // logger.info(`Formatting edit for ${targetPlatform}: isEdit=${message.isEdit}, hasReply=${!!message.replyTo}, showReplyContext=${shouldShowReplyContext}`);
        const formattedContent = this.formatter.formatForPlatform(message, targetPlatform, formatterReplyInfo);
        // logger.info(`Formatted content for ${targetPlatform}: "${formattedContent}"`);
        
        // Check if target is Twitch (string comparison to avoid TS narrowing issues)
        if (targetPlatform.toString() === Platform.Twitch.toString()) {
          // Twitch doesn't support edits, so try to delete old message first
          let deleteSuccess = false;
          try {
            deleteSuccess = await service.deleteMessage(messageId);
            if (deleteSuccess) {
              logger.info(`Deleted old Twitch message ${messageId} before sending edit`);
            } else {
              logger.warn(`Could not delete old Twitch message ${messageId} - bot needs moderator permissions`);
            }
          } catch (error) {
            logger.warn(`Error deleting old Twitch message: ${error}`);
          }
          
          // Format message based on whether we could delete the old one
          let messageToSend: string;
          if (deleteSuccess) {
            // Old message was deleted, send clean new message
            messageToSend = formattedContent;
          } else {
            // Couldn't delete old message, make it VERY clear this is an edit
            messageToSend = `[EDITED] ${formattedContent} (edited)`;
          }
          
          // Send the new/edited message
          const newMessageId = await service.sendMessage(messageToSend);
          
          // Update the mapping with the new Twitch message ID
          if (newMessageId) {
            await this.messageMapper.updatePlatformMessage(mapping.id, targetPlatform, newMessageId);
            logger.info(`Sent edited message to Twitch with new ID ${newMessageId}`);
          } else {
            logger.info(`Sent edited message to Twitch`);
          }
        } else {
          // Discord and Telegram support native edits
          const success = await service.editMessage(messageId, formattedContent);
          if (success) {
            logger.info(`Successfully edited message ${messageId} on ${targetPlatform}`);
          } else {
            logger.warn(`Failed to edit message ${messageId} on ${targetPlatform}`);
          }
        }
      } catch (error) {
        logError(error as Error, `Failed to relay edit to ${targetPlatform}`);
      }
    }
  }

  private async handleDeletion(platform: Platform, messageId: string, isAdminDeletion: boolean = false): Promise<void> {
    logger.info(`=== HANDLE DELETION CALLED ===`);
    logger.info(`Platform: ${platform}, Message ID: ${messageId}, Admin deletion: ${isAdminDeletion}`);

    // Find the mapping for the deleted message
    const mapping = await this.messageMapper.getMappingByPlatformMessage(platform, messageId);
    if (!mapping) {
      logger.warn(`No mapping found for deleted message ${messageId} from ${platform}`);
      logger.warn(`This could mean the message was never relayed or mapping was lost`);
      return;
    }

    logger.info(`Found mapping ${mapping.id} for deleted message`);
    logger.info(`Platform messages in mapping:`, mapping.platformMessages);

    // Publish deletion event to Redis for distributed handling
    const deletionEvent: DeletionEvent = {
      mappingId: mapping.id,
      platform,
      messageId,
      timestamp: Date.now(),
      isAdminDeletion // Include admin deletion flag
    };
    
    await redisEvents.publishDeletion(deletionEvent);
    logger.info(`Published deletion event for ${platform} message ${messageId} with mapping ${mapping.id} (admin: ${isAdminDeletion})`);
  }
  
  /**
   * Handle deletion events from Redis pub/sub
   */
  private async handleDeletionEvent(event: DeletionEvent): Promise<void> {
    logger.info(`=== HANDLE DELETION EVENT ===`);
    logger.info(`Event:`, event);
    
    const { mappingId, platform: sourcePlatform, isAdminDeletion } = event;
    
    // Get the mapping
    const mapping = await this.messageMapper.getMapping(mappingId);
    if (!mapping) {
      logger.warn(`No mapping found for deletion event ${mappingId}`);
      return;
    }

    logger.info(`Found mapping for deletion:`, mapping);
    logger.info(`Is admin deletion: ${isAdminDeletion}`);

    // Get all platform messages for this mapping
    const platformMessages = mapping.platformMessages;
    logger.info(`Platform messages to delete:`, platformMessages);
    
    // Delete the message on all platforms
    for (const [targetPlatform, targetMessageId] of Object.entries(platformMessages)) {
      const targetPlatformEnum = targetPlatform as Platform;
      
      // For admin deletions, delete on ALL platforms including source
      // For regular deletions, skip the source platform
      if (!isAdminDeletion && targetPlatformEnum === sourcePlatform) {
        // logger.info(`Skipping ${targetPlatform}: source platform (non-admin deletion)`);
        continue;
      }
      
      if (!targetMessageId) {
        // logger.info(`Skipping ${targetPlatform}: no message ID`);
        continue;
      }
      
      const service = this.services.get(targetPlatformEnum);
      if (!service || !service.getStatus().connected) {
        logger.warn(`Cannot delete message on ${targetPlatformEnum}: Not connected`);
        continue;
      }

      // logger.info(`Attempting to delete message ${targetMessageId} on ${targetPlatformEnum}`);
      try {
        // Get channel ID for Discord messages
        const channelId = targetPlatformEnum === Platform.Discord && mapping.platformChannels ? 
          mapping.platformChannels[Platform.Discord] : undefined;
        
        if (channelId) {
          // logger.info(`Using stored channel ID ${channelId} for Discord deletion`);
        }
        
        // Pass channel ID for Discord, undefined for other platforms
        const success = await service.deleteMessage(targetMessageId as string, channelId);
        if (success) {
          // logger.info(`✅ Successfully deleted message ${targetMessageId} on ${targetPlatformEnum}`);
        } else {
          logger.warn(`❌ Failed to delete message ${targetMessageId} on ${targetPlatformEnum} (may need moderator permissions)`);
        }
      } catch (error) {
        logger.error(`❌ Error deleting message on ${targetPlatformEnum}:`, error);
        logError(error as Error, `Failed to delete message on ${targetPlatformEnum}`);
      }
    }

    // Remove the mapping from the MessageMapper
    await this.messageMapper.removeMapping(mappingId);
    logger.info(`Removed mapping ${mappingId} from mapper`);
  }
  
  // Public method for webhook to call
  public async handleMessageDeletion(platform: Platform, messageId: string): Promise<void> {
    return this.handleDeletion(platform, messageId);
  }

  private async relayToPlatform(message: RelayMessage, targetPlatform: Platform, mappingId: string): Promise<void> {
    const service = this.services.get(targetPlatform);
    if (!service) {
      logger.error(`Service not found for platform: ${targetPlatform}`);
      return;
    }

    const status = service.getStatus();
    if (!status.connected) {
      logger.warn(`Cannot relay to ${targetPlatform}: Not connected`);
      return;
    }

    // Determine target channel based on channel mapping
    let targetChannelId: string | undefined;
    
    // Twitch doesn't have multiple channels, so skip channel mapping for it
    if (targetPlatform === Platform.Twitch) {
      // Only relay general channel messages to Twitch
      if (!message.channelName || message.channelName !== 'general') {
        // logger.info(`Skipping ${message.channelName || 'unmapped channel'} message to Twitch - only general channel is relayed`);
        return;
      }
      // // logger.info(`Routing message from ${message.platform} #general → Twitch`);
    } else if (message.channelName && channelMappings[message.channelName]) {
      const mapping = channelMappings[message.channelName];
      if (targetPlatform === Platform.Discord) {
        targetChannelId = mapping.discord;
      } else if (targetPlatform === Platform.Telegram) {
        // For Telegram, null means general chat (no topic), which is valid
        targetChannelId = mapping.telegram || undefined;
        // If targetChannelId is null/undefined but we have a mapping entry, it's the general chat
        if (targetChannelId === null && mapping.hasOwnProperty('telegram')) {
          targetChannelId = undefined; // This is valid for general chat
        }
      }
      
      if (!targetChannelId && targetPlatform === Platform.Discord) {
        logger.warn(`No channel mapping found for ${message.channelName} to ${targetPlatform}, skipping message`);
        return;
      } else if (targetPlatform === Platform.Telegram && !mapping.hasOwnProperty('telegram')) {
        logger.warn(`No channel mapping found for ${message.channelName} to ${targetPlatform}, skipping message`);
        return;
      }
      // Commented out verbose logging
      // logger.info(`Routing message from ${message.platform} #${message.channelName} → ${targetPlatform}`);
    } else {
      // No channel mapping and not Twitch, skip
      if (targetPlatform.toString() !== Platform.Twitch.toString()) {
        logger.warn(`No channel info for message to ${targetPlatform}, skipping`);
        return;
      }
    }

    if (!this.rateLimiter.canSendMessage(targetPlatform)) {
      logger.warn(`Rate limit reached for ${targetPlatform}, message queued`);
      return;
    }

    // Skip relaying empty messages (unless they have attachments)
    if ((!message.content || message.content.trim() === '') && 
        (!message.attachments || message.attachments.length === 0)) {
      // logger.info(`Skipping empty message from ${message.platform} by ${message.author} to ${targetPlatform}`);
      return;
    }

    try {
      // Get reply information if this is a reply
      let replyToMessageId: string | undefined;
      let replyInfo: { author: string; content: string; platform?: Platform } | undefined;
      
      // Always populate reply info if message has reply data
      if (message.replyTo) {
        replyInfo = { 
          author: message.replyTo.author, 
          content: message.replyTo.content,
          platform: message.replyTo.platform
        };
        // logger.info(`REPLY INFO: Message from ${message.platform} has reply to ${message.replyTo.author}: "${message.replyTo.content?.substring(0, 30)}..."`);
      }
      
      // Then check if we can find the proper message ID in our messageMapper (for cross-platform replies)
      if (mappingId && message.replyTo) {
        // logger.info(`REPLY LOOKUP: Checking for reply info for mapping ${mappingId} on ${targetPlatform}`);
        // logger.info(`REPLY LOOKUP: Message replyTo data: ${JSON.stringify(message.replyTo)}`);
        const replyData = await this.messageMapper.getReplyToInfo(mappingId, targetPlatform);
        if (replyData) {
          replyToMessageId = replyData.messageId;
          // Update replyInfo with data from mapper if available
          replyInfo = { author: replyData.author, content: replyData.content };
          // logger.info(`REPLY LOOKUP: Found target message ${replyToMessageId} on ${targetPlatform}`);
        } else {
          // logger.info(`REPLY LOOKUP: No reply data found for mapping ${mappingId} on ${targetPlatform}`);
          
          // Special case: When replying to a bot message, we might need to look up the platform message differently
          if (message.replyTo.platform && message.replyTo.messageId) {
            // Try to find the mapping that contains the original message
            const originalMapping = await this.messageMapper.findMappingIdByAuthorAndPlatform(
              message.replyTo.author, 
              message.replyTo.platform
            );
            if (originalMapping) {
              const mapping = await this.messageMapper.getMapping(originalMapping);
              if (mapping && mapping.platformMessages[targetPlatform]) {
                replyToMessageId = mapping.platformMessages[targetPlatform];
                logger.info(`REPLY LOOKUP: Found bot message ID ${replyToMessageId} on ${targetPlatform} via original mapping`);
              }
            }
          }
        }
      }

      // Determine when to show reply context
      // Show reply context when:
      // 1. Target is Twitch (no native replies)
      // 2. We have reply info but no proper message ID (can't link as native reply)
      // 3. Source is Twitch (often can't be linked on other platforms)
      // 4. Cross-platform relay: source and target are different platforms
      const shouldShowReplyContext = (targetPlatform === Platform.Twitch) || 
                                     (replyInfo && !replyToMessageId) || 
                                     (message.platform === Platform.Twitch && message.replyTo) ||
                                     (replyInfo && message.platform !== targetPlatform);
      const formatterReplyInfo = shouldShowReplyContext ? replyInfo : undefined;
      
      if (message.platform === Platform.Twitch) {
        // logger.info(`TWITCH RELAY: shouldShowReplyContext=${shouldShowReplyContext}, hasReplyTo=${!!message.replyTo}, replyInfo=${JSON.stringify(replyInfo)}, formatterReplyInfo=${JSON.stringify(formatterReplyInfo)}`);
      }
      
      const formattedContent = this.formatter.formatForPlatform(message, targetPlatform, formatterReplyInfo);
      
      let attachments = message.attachments;
      if (!config.relay.attachmentsEnabled) {
        attachments = undefined;
      }

      // For Twitch, don't send any attachments from Discord/Telegram
      // They will be represented as "(file attachment:unknown)" in the formatted text
      if (targetPlatform === Platform.Twitch && 
          (message.platform === Platform.Discord || message.platform === Platform.Telegram)) {
        attachments = undefined;
      } else if (targetPlatform === Platform.Twitch && attachments) {
        // For other sources, don't send sticker/custom-emoji attachments (they're handled in the text)
        attachments = attachments.filter(att => att.type !== 'sticker' && att.type !== 'custom-emoji');
        if (attachments.length === 0) attachments = undefined;
      }

      // // logger.info(`SENDING TO ${targetPlatform}: channel=${targetChannelId}, replyToMessageId=${replyToMessageId}, hasReplyInfo=${!!replyInfo}`);
      const sentMessageId = await service.sendMessage(formattedContent, attachments, replyToMessageId, targetChannelId, message);
      this.rateLimiter.recordMessage(targetPlatform, formattedContent, attachments);
      
      // Track the sent message ID in our mapping IMMEDIATELY to avoid race conditions
      if (sentMessageId) {
        // Add detailed logging for debugging
        // // logger.info(`MAPPING: About to add ${targetPlatform} message ${sentMessageId} to mapping ${mappingId} at ${new Date().toISOString()}`);
        
        // Track in mapper first (this is faster and what incoming messages check)
        // Pass channel ID for Discord messages
        const channelId = targetPlatform === Platform.Discord ? targetChannelId : undefined;
        await this.messageMapper.addPlatformMessage(mappingId, targetPlatform, sentMessageId, channelId);
        // // logger.info(`MAPPING: Successfully added ${targetPlatform} message ${sentMessageId} to mapping ${mappingId}${channelId ? ` in channel ${channelId}` : ''} at ${new Date().toISOString()}`);
        
        // Then track in database (can be slower, used for persistence)
        await messageDb.trackPlatformMessage({
          mappingId,
          platform: targetPlatform,
          messageId: sentMessageId
        }).catch(err => {
          // Don't fail the whole operation if database tracking fails
          logger.error(`Failed to track platform message in database: ${err}`);
        });
      } else {
        logger.warn(`No message ID returned when sending to ${targetPlatform}`);
      }
      
    } catch (error) {
      logError(error as Error, `Failed to relay message to ${targetPlatform}`);
    }
  }

  private getTargetPlatforms(sourcePlatform: Platform): Platform[] {
    return Array.from(this.services.keys()).filter(platform => platform !== sourcePlatform);
  }

  private isDuplicateMessage(message: RelayMessage): boolean {
    const messageKey = `${message.platform}:${message.author}:${message.content}:${message.timestamp.getTime()}`;
    return this.messageHistory.includes(messageKey);
  }

  private addToHistory(message: RelayMessage): void {
    const messageKey = `${message.platform}:${message.author}:${message.content}:${message.timestamp.getTime()}`;
    this.messageHistory.push(messageKey);
    
    if (this.messageHistory.length > config.relay.messageHistorySize) {
      this.messageHistory = this.messageHistory.slice(-config.relay.messageHistorySize);
    }
  }

  getStatus(): any {
    const servicesStatus = Array.from(this.services.values()).map(service => service.getStatus());
    const rateLimitStatus = this.rateLimiter.getAllStatuses();
    const messageMapperStats = this.messageMapper.getStats();

    return {
      isRunning: this.isRunning,
      services: servicesStatus,
      rateLimit: rateLimitStatus,
      messageHistory: this.messageHistory.length,
      messageMapper: messageMapperStats,
    };
  }

  private logStatus(): void {
    const status = this.getStatus();
    logger.info('Relay Manager Status:', status);
  }
}
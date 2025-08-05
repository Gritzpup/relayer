import { Platform, PlatformService, RelayMessage } from '../types';
import { DiscordService } from '../services/discord';
import { TelegramService } from '../services/telegram';
import { TwitchService } from '../services/twitch';
import { MessageFormatter } from './formatter';
import { MessageMapper } from './messageMapper';
import { RateLimiter } from './rateLimit';
import { config } from '../config';
import { logger, logError } from '../utils/logger';

export class RelayManager {
  private services: Map<Platform, PlatformService> = new Map();
  private formatter: MessageFormatter;
  private messageMapper: MessageMapper;
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
    this.isRunning = true;

    this.setupMessageHandlers();

    const connectionPromises = Array.from(this.services.values()).map(service => 
      service.connect().catch(error => {
        logError(error as Error, `Failed to connect ${service.platform}`);
      })
    );

    await Promise.all(connectionPromises);
    
    logger.info('Relay manager started successfully');
    this.logStatus();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Relay manager is not running');
      return;
    }

    logger.info('Stopping relay manager...');
    this.isRunning = false;

    const disconnectionPromises = Array.from(this.services.values()).map(service =>
      service.disconnect().catch(error => {
        logError(error as Error, `Failed to disconnect ${service.platform}`);
      })
    );

    await Promise.all(disconnectionPromises);
    
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
    });
  }

  private async handleMessage(message: RelayMessage): Promise<void> {
    // Always track the message, even if we're not relaying it
    // This allows us to handle replies to native messages
    if (message.replyTo) {
      logger.debug(`Processing message ${message.id} from ${message.platform} which is a reply to ${message.replyTo.messageId}`);
      if (message.replyTo.platform) {
        logger.debug(`Reply is to a message from platform: ${message.replyTo.platform}`);
      }
    }
    
    const mappingId = this.messageMapper.createMapping(
      message.platform,
      message.id,
      message.content,
      message.author,
      message.replyTo?.messageId,
      message.replyTo?.content,
      message.replyTo?.author,
      message.replyTo?.platform
    );

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
    const mapping = this.messageMapper.getMappingByPlatformMessage(message.platform, message.originalMessageId);
    if (!mapping) {
      logger.warn(`No mapping found for edited message ${message.originalMessageId} from ${message.platform}`);
      return;
    }

    // Update the content in the mapping
    this.messageMapper.updateMessageContent(message.platform, message.originalMessageId, message.content);

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
        // Format the edited content for the target platform
        const formattedContent = this.formatter.formatForPlatform(message, targetPlatform);
        
        if (targetPlatform === Platform.Twitch) {
          // Twitch doesn't support edits, send a new message with "(edited)" indicator
          const editedContent = `(edited) ${formattedContent}`;
          await service.sendMessage(editedContent);
          logger.info(`Sent edit as new message to Twitch`);
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

    if (!this.rateLimiter.canSendMessage(targetPlatform)) {
      logger.warn(`Rate limit reached for ${targetPlatform}, message queued`);
      return;
    }

    try {
      // Get reply information if this is a reply
      let replyToMessageId: string | undefined;
      let replyInfo: { author: string; content: string } | undefined;
      
      // Always populate reply info if message has reply data
      if (message.replyTo) {
        replyInfo = { author: message.replyTo.author, content: message.replyTo.content };
        logger.info(`REPLY INFO: Message from ${message.platform} has reply to ${message.replyTo.author}: "${message.replyTo.content?.substring(0, 30)}..."`);
      }
      
      // Then check if we can find the proper message ID in our messageMapper (for cross-platform replies)
      if (mappingId && message.replyTo) {
        logger.info(`REPLY LOOKUP: Checking for reply info for mapping ${mappingId} on ${targetPlatform}`);
        logger.info(`REPLY LOOKUP: Message replyTo data: ${JSON.stringify(message.replyTo)}`);
        const replyData = this.messageMapper.getReplyToInfo(mappingId, targetPlatform);
        if (replyData) {
          replyToMessageId = replyData.messageId;
          // Update replyInfo with data from mapper if available
          replyInfo = { author: replyData.author, content: replyData.content };
          logger.info(`REPLY LOOKUP: Found target message ${replyToMessageId} on ${targetPlatform}`);
        } else {
          logger.info(`REPLY LOOKUP: No reply data found for mapping ${mappingId} on ${targetPlatform}`);
          
          // Special case: When replying to a bot message, we might need to look up the platform message differently
          if (message.replyTo.platform && message.replyTo.messageId) {
            // Try to find the mapping that contains the original message
            const originalMapping = this.messageMapper.findMappingIdByAuthorAndPlatform(
              message.replyTo.author, 
              message.replyTo.platform
            );
            if (originalMapping) {
              const mapping = this.messageMapper.getMapping(originalMapping);
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
      const hasProperReply = replyToMessageId !== undefined && targetPlatform !== Platform.Twitch;
      const shouldShowReplyContext = (targetPlatform === Platform.Twitch) || 
                                     (replyInfo && !replyToMessageId) || 
                                     (message.platform === Platform.Twitch && message.replyTo);
      const formatterReplyInfo = shouldShowReplyContext ? replyInfo : undefined;
      
      if (message.platform === Platform.Twitch) {
        logger.info(`TWITCH RELAY: shouldShowReplyContext=${shouldShowReplyContext}, hasReplyTo=${!!message.replyTo}, replyInfo=${JSON.stringify(replyInfo)}, formatterReplyInfo=${JSON.stringify(formatterReplyInfo)}`);
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

      logger.info(`SENDING TO ${targetPlatform}: replyToMessageId=${replyToMessageId}, hasReplyInfo=${!!replyInfo}`);
      const sentMessageId = await service.sendMessage(formattedContent, attachments, replyToMessageId);
      this.rateLimiter.recordMessage(targetPlatform, formattedContent, attachments);
      
      // Track the sent message ID in our mapping
      if (sentMessageId) {
        this.messageMapper.addPlatformMessage(mappingId, targetPlatform, sentMessageId);
        logger.info(`MAPPING: Added ${targetPlatform} message ${sentMessageId} to mapping ${mappingId}`);
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
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
    if (!this.formatter.shouldRelayMessage(message)) {
      logger.debug(`Skipping message from ${message.platform}: ${message.content}`);
      return;
    }

    if (this.isDuplicateMessage(message)) {
      logger.debug(`Duplicate message detected from ${message.platform}: ${message.content}`);
      return;
    }

    this.addToHistory(message);

    // Create a message mapping for tracking across platforms
    const mappingId = this.messageMapper.createMapping(
      message.platform,
      message.id,
      message.content,
      message.author,
      message.replyTo?.messageId
    );

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
      
      if (mappingId) {
        logger.debug(`Checking for reply info for mapping ${mappingId} on ${targetPlatform}`);
        const replyData = this.messageMapper.getReplyToInfo(mappingId, targetPlatform);
        if (replyData) {
          replyToMessageId = replyData.messageId;
          replyInfo = { author: replyData.author, content: replyData.content };
          logger.debug(`Message is a reply, found target message ${replyToMessageId} on ${targetPlatform}`);
        } else {
          logger.debug(`No reply data found for mapping ${mappingId} on ${targetPlatform}`);
        }
      }

      const formattedContent = this.formatter.formatForPlatform(message, targetPlatform, replyInfo);
      
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

      const sentMessageId = await service.sendMessage(formattedContent, attachments, replyToMessageId);
      this.rateLimiter.recordMessage(targetPlatform, formattedContent, attachments);
      
      // Track the sent message ID in our mapping
      if (sentMessageId) {
        this.messageMapper.addPlatformMessage(mappingId, targetPlatform, sentMessageId);
        logger.debug(`Tracked message ${sentMessageId} on ${targetPlatform} for mapping ${mappingId}`);
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
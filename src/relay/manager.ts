import { Platform, PlatformService, RelayMessage } from '../types';
import { DiscordService } from '../services/discord';
import { TelegramService } from '../services/telegram';
import { TwitchService } from '../services/twitch';
import { MessageFormatter } from './formatter';
import { RateLimiter } from './rateLimit';
import { config } from '../config';
import { logger, logError } from '../utils/logger';

export class RelayManager {
  private services: Map<Platform, PlatformService> = new Map();
  private formatter: MessageFormatter;
  private rateLimiter: RateLimiter;
  private messageHistory: string[] = [];
  private isRunning: boolean = false;

  constructor() {
    this.formatter = new MessageFormatter();
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
        await this.handleMessage(message);
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

    const targetPlatforms = this.getTargetPlatforms(message.platform);
    
    for (const targetPlatform of targetPlatforms) {
      await this.relayToPlatform(message, targetPlatform);
    }
  }

  private async relayToPlatform(message: RelayMessage, targetPlatform: Platform): Promise<void> {
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
      const formattedContent = this.formatter.formatForPlatform(message, targetPlatform);
      
      let attachments = message.attachments;
      if (!config.relay.attachmentsEnabled) {
        attachments = undefined;
      }

      // For Twitch, don't send sticker attachments (they're handled in the text)
      if (targetPlatform === Platform.Twitch && attachments) {
        attachments = attachments.filter(att => att.type !== 'sticker');
        if (attachments.length === 0) attachments = undefined;
      }

      await service.sendMessage(formattedContent, attachments);
      this.rateLimiter.recordMessage(targetPlatform, formattedContent, attachments);
      
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

    return {
      isRunning: this.isRunning,
      services: servicesStatus,
      rateLimit: rateLimitStatus,
      messageHistory: this.messageHistory.length,
    };
  }

  private logStatus(): void {
    const status = this.getStatus();
    logger.info('Relay Manager Status:', status);
  }
}
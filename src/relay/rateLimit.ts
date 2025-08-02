import { Platform, RateLimitInfo } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

interface MessageQueue {
  platform: Platform;
  messages: Array<{
    content: string;
    timestamp: number;
    attachments?: any[];
  }>;
}

export class RateLimiter {
  private messageHistory: Map<Platform, MessageQueue> = new Map();
  private lastCleanup: number = Date.now();
  private cleanupInterval: number = 60000; // 1 minute

  constructor() {
    [Platform.Discord, Platform.Telegram, Platform.Twitch].forEach(platform => {
      this.messageHistory.set(platform, {
        platform,
        messages: [],
      });
    });
  }

  canSendMessage(platform: Platform): boolean {
    this.cleanup();
    
    const queue = this.messageHistory.get(platform);
    if (!queue) return true;

    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window
    
    const recentMessages = queue.messages.filter(msg => msg.timestamp > windowStart);
    
    const limit = this.getPlatformLimit(platform);
    const canSend = recentMessages.length < limit;

    if (!canSend) {
      logger.warn(`Rate limit reached for ${platform}: ${recentMessages.length}/${limit} messages in the last minute`);
    }

    return canSend;
  }

  recordMessage(platform: Platform, content: string, attachments?: any[]): void {
    const queue = this.messageHistory.get(platform);
    if (!queue) return;

    queue.messages.push({
      content,
      timestamp: Date.now(),
      attachments,
    });
  }

  getStatus(platform: Platform): RateLimitInfo {
    const queue = this.messageHistory.get(platform);
    if (!queue) {
      return {
        platform,
        messagesInWindow: 0,
        windowStart: new Date(),
        isLimited: false,
      };
    }

    const now = Date.now();
    const windowStart = now - 60000;
    const recentMessages = queue.messages.filter(msg => msg.timestamp > windowStart);
    const limit = this.getPlatformLimit(platform);

    return {
      platform,
      messagesInWindow: recentMessages.length,
      windowStart: new Date(windowStart),
      isLimited: recentMessages.length >= limit,
    };
  }

  getAllStatuses(): RateLimitInfo[] {
    return [Platform.Discord, Platform.Telegram, Platform.Twitch].map(platform => 
      this.getStatus(platform)
    );
  }

  private getPlatformLimit(platform: Platform): number {
    const customLimit = config.relay.rateLimitPerMin;
    
    const platformLimits: Record<Platform, number> = {
      [Platform.Discord]: customLimit || 30,
      [Platform.Telegram]: customLimit || 20,
      [Platform.Twitch]: customLimit || 20,
    };

    return platformLimits[platform];
  }

  private cleanup(): void {
    const now = Date.now();
    
    if (now - this.lastCleanup < this.cleanupInterval) {
      return;
    }

    this.lastCleanup = now;
    const windowStart = now - 120000; // Keep 2 minutes of history

    this.messageHistory.forEach(queue => {
      queue.messages = queue.messages.filter(msg => msg.timestamp > windowStart);
    });

    logger.debug('Rate limiter cleanup completed');
  }

  reset(platform?: Platform): void {
    if (platform) {
      const queue = this.messageHistory.get(platform);
      if (queue) {
        queue.messages = [];
      }
    } else {
      this.messageHistory.forEach(queue => {
        queue.messages = [];
      });
    }
  }
}
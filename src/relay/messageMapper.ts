import { Platform } from '../types';
import { logger } from '../utils/logger';

interface MessageMapping {
  originalPlatform: Platform;
  originalMessageId: string;
  platformMessages: {
    [key in Platform]?: string;
  };
  content: string;
  author: string;
  timestamp: Date;
  replyToMapping?: string; // Reference to another mapping ID if this is a reply
}

export class MessageMapper {
  private mappings: Map<string, MessageMapping> = new Map();
  private messageIdToMappingId: Map<string, string> = new Map();
  private maxCacheSize: number = 1000;
  private ttlHours: number = 24;

  constructor(maxCacheSize: number = 1000, ttlHours: number = 24) {
    this.maxCacheSize = maxCacheSize;
    this.ttlHours = ttlHours;
    
    // Clean up old messages periodically
    setInterval(() => this.cleanupOldMappings(), 60 * 60 * 1000); // Every hour
  }

  /**
   * Create a new message mapping for a message being relayed
   */
  createMapping(
    originalPlatform: Platform,
    originalMessageId: string,
    content: string,
    author: string,
    replyToMessageId?: string
  ): string {
    const mappingId = this.generateMappingId();
    
    // Find reply mapping if this is a reply
    let replyToMapping: string | undefined;
    if (replyToMessageId) {
      // First check if the message being replied to exists in our mappings
      const key = `${originalPlatform}:${replyToMessageId}`;
      replyToMapping = this.messageIdToMappingId.get(key);
      
      if (!replyToMapping) {
        // The message being replied to might be a relayed message from another platform
        // Check if we have a mapping for this message ID
        const replyToMappingData = this.getMappingByPlatformMessage(originalPlatform, replyToMessageId);
        if (replyToMappingData) {
          // Find the mapping ID for this mapping
          for (const [mapId, mapping] of this.mappings.entries()) {
            if (mapping === replyToMappingData) {
              replyToMapping = mapId;
              break;
            }
          }
          logger.debug(`Found reply to relayed message: ${replyToMessageId} maps to ${replyToMapping}`);
        }
      }
      
      if (!replyToMapping) {
        logger.debug(`No mapping found for reply-to message ${replyToMessageId} on ${originalPlatform}`);
      }
    }
    
    const mapping: MessageMapping = {
      originalPlatform,
      originalMessageId,
      platformMessages: {
        [originalPlatform]: originalMessageId
      },
      content,
      author,
      timestamp: new Date(),
      replyToMapping
    };

    this.mappings.set(mappingId, mapping);
    this.messageIdToMappingId.set(`${originalPlatform}:${originalMessageId}`, mappingId);
    
    // Enforce cache size limit
    this.enforceMaxCacheSize();
    
    logger.debug(`Created message mapping ${mappingId} for ${originalPlatform} message ${originalMessageId}${replyToMapping ? ` (reply to ${replyToMapping})` : ''}`);
    
    return mappingId;
  }

  /**
   * Add a platform message ID to an existing mapping
   */
  addPlatformMessage(mappingId: string, platform: Platform, messageId: string): void {
    const mapping = this.mappings.get(mappingId);
    if (!mapping) {
      logger.warn(`Mapping ${mappingId} not found when adding platform message`);
      return;
    }

    mapping.platformMessages[platform] = messageId;
    this.messageIdToMappingId.set(`${platform}:${messageId}`, mappingId);
    
    logger.debug(`Added ${platform} message ${messageId} to mapping ${mappingId}`);
  }

  /**
   * Get a mapping by platform and message ID
   */
  getMappingByPlatformMessage(platform: Platform, messageId: string): MessageMapping | undefined {
    const key = `${platform}:${messageId}`;
    const mappingId = this.messageIdToMappingId.get(key);
    
    if (!mappingId) {
      return undefined;
    }
    
    return this.mappings.get(mappingId);
  }

  /**
   * Get a mapping by mapping ID
   */
  getMapping(mappingId: string): MessageMapping | undefined {
    return this.mappings.get(mappingId);
  }

  /**
   * Get the reply-to information for a message
   */
  getReplyToInfo(mappingId: string, targetPlatform: Platform): {
    messageId: string;
    author: string;
    content: string;
  } | undefined {
    const mapping = this.mappings.get(mappingId);
    if (!mapping) {
      logger.debug(`getReplyToInfo: No mapping found for ${mappingId}`);
      return undefined;
    }
    
    if (!mapping.replyToMapping) {
      logger.debug(`getReplyToInfo: Mapping ${mappingId} is not a reply`);
      return undefined;
    }

    const replyToMapping = this.mappings.get(mapping.replyToMapping);
    if (!replyToMapping) {
      logger.debug(`getReplyToInfo: Reply-to mapping ${mapping.replyToMapping} not found`);
      return undefined;
    }

    const targetMessageId = replyToMapping.platformMessages[targetPlatform];
    if (!targetMessageId) {
      logger.debug(`getReplyToInfo: No ${targetPlatform} message ID in reply-to mapping`);
      return undefined;
    }

    logger.debug(`getReplyToInfo: Found reply info for ${targetPlatform}: messageId=${targetMessageId}, author=${replyToMapping.author}`);
    
    return {
      messageId: targetMessageId,
      author: replyToMapping.author,
      content: replyToMapping.content
    };
  }

  /**
   * Update message content (for edits)
   */
  updateMessageContent(platform: Platform, messageId: string, newContent: string): void {
    const mapping = this.getMappingByPlatformMessage(platform, messageId);
    if (!mapping) {
      logger.warn(`No mapping found for ${platform} message ${messageId} to update`);
      return;
    }

    mapping.content = newContent;
    logger.debug(`Updated content for mapping ${platform}:${messageId}`);
  }

  /**
   * Get all platform messages for a given message
   */
  getAllPlatformMessages(platform: Platform, messageId: string): { 
    [key in Platform]?: string 
  } | undefined {
    const mapping = this.getMappingByPlatformMessage(platform, messageId);
    return mapping?.platformMessages;
  }

  private generateMappingId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private enforceMaxCacheSize(): void {
    if (this.mappings.size <= this.maxCacheSize) {
      return;
    }

    // Remove oldest mappings
    const sortedMappings = Array.from(this.mappings.entries())
      .sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());

    const toRemove = sortedMappings.slice(0, this.mappings.size - this.maxCacheSize);
    
    for (const [mappingId, mapping] of toRemove) {
      this.removeMapping(mappingId, mapping);
    }
  }

  private cleanupOldMappings(): void {
    const now = Date.now();
    const maxAge = this.ttlHours * 60 * 60 * 1000;

    for (const [mappingId, mapping] of this.mappings.entries()) {
      if (now - mapping.timestamp.getTime() > maxAge) {
        this.removeMapping(mappingId, mapping);
      }
    }
    
    logger.debug(`Message mapping cleanup complete. Current size: ${this.mappings.size}`);
  }

  private removeMapping(mappingId: string, mapping: MessageMapping): void {
    this.mappings.delete(mappingId);
    
    // Remove all platform message references
    for (const [platform, messageId] of Object.entries(mapping.platformMessages)) {
      if (messageId) {
        this.messageIdToMappingId.delete(`${platform}:${messageId}`);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; oldestMessage: Date | null } {
    let oldestMessage: Date | null = null;
    
    if (this.mappings.size > 0) {
      oldestMessage = Array.from(this.mappings.values())
        .reduce((oldest, mapping) => 
          mapping.timestamp < oldest ? mapping.timestamp : oldest,
          new Date()
        );
    }

    return {
      size: this.mappings.size,
      maxSize: this.maxCacheSize,
      oldestMessage
    };
  }
}
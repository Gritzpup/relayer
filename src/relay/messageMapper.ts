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
    replyToMessageId?: string,
    replyToContent?: string,
    replyToAuthor?: string,
    replyToPlatform?: Platform
  ): string {
    const mappingId = this.generateMappingId();
    
    // Find reply mapping if this is a reply
    let replyToMapping: string | undefined;
    if (replyToMessageId) {
      // Special handling for Twitch replies to cross-platform messages
      if (originalPlatform === Platform.Twitch && replyToMessageId.includes('-')) {
        // Twitch creates fake IDs like "Telegram-123456" for relayed messages
        // Use the platform info if provided, otherwise extract from the fake ID
        let sourcePlatform: Platform | undefined = replyToPlatform;
        if (!sourcePlatform) {
          const platformMatch = replyToMessageId.match(/^(Discord|Telegram)-/);
          if (platformMatch) {
            sourcePlatform = platformMatch[1] as Platform;
          }
        }
        
        if (sourcePlatform && replyToAuthor) {
          replyToMapping = this.findMappingIdByAuthorAndPlatform(replyToAuthor, sourcePlatform);
          if (replyToMapping) {
            logger.debug(`Found Twitch cross-platform reply mapping: ${replyToMapping} for ${replyToAuthor} from ${sourcePlatform}`);
          }
        }
      } else {
        // Standard reply handling for Discord and Telegram
        const key = `${originalPlatform}:${replyToMessageId}`;
        replyToMapping = this.messageIdToMappingId.get(key);
        
        if (!replyToMapping) {
          logger.info(`REPLY CREATE: Looking for mapping of reply-to message ${replyToMessageId} on ${originalPlatform}`);
          // The message being replied to might be a relayed message from another platform
          // Check if we have a mapping ID for this message as a platform message
          replyToMapping = this.getMappingIdByPlatformMessage(originalPlatform, replyToMessageId);
          if (replyToMapping) {
            logger.info(`REPLY CREATE: Found reply to relayed message: ${replyToMessageId} maps to mapping ${replyToMapping}`);
          } else {
            logger.info(`REPLY CREATE: No mapping found for platform message ${originalPlatform}:${replyToMessageId}`);
            
            // Try to find a mapping by author and platform (for replies to bot messages)
            if (replyToAuthor && replyToPlatform) {
              const potentialMapping = this.findMappingIdByAuthorAndPlatform(replyToAuthor, replyToPlatform);
              if (potentialMapping) {
                // Special handling: We found the original message mapping
                // Add the bot's message ID to this mapping so future lookups work
                this.addPlatformMessage(potentialMapping, originalPlatform, replyToMessageId);
                replyToMapping = potentialMapping;
                logger.info(`REPLY CREATE: Found mapping by author and platform: ${potentialMapping} for ${replyToAuthor} from ${replyToPlatform}`);
                logger.info(`REPLY CREATE: Added bot message ${replyToMessageId} to mapping for future lookups`);
              }
            }
            
            // If still not found, try to find a mapping by content match (for native messages)
            if (!replyToMapping && replyToContent && replyToAuthor) {
              const potentialMapping = this.findMappingByContent(replyToContent, replyToAuthor, originalPlatform);
              if (potentialMapping) {
                replyToMapping = potentialMapping;
                logger.debug(`Found potential mapping by content match: ${potentialMapping}`);
                // Add this platform message to the mapping so future replies work
                this.addPlatformMessage(potentialMapping, originalPlatform, replyToMessageId);
              }
            }
          }
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
    
    logger.info(`MAPPING CREATED: ${mappingId} for ${originalPlatform} message ${originalMessageId}${replyToMapping ? ` (reply to ${replyToMapping})` : ''}`);
    if (replyToMapping) {
      logger.info(`REPLY MAPPING: Message ${originalMessageId} from ${originalPlatform} is a reply linked to mapping ${replyToMapping}`);
    }
    
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
    
    logger.info(`PLATFORM MESSAGE: Added ${platform} message ${messageId} to mapping ${mappingId}. Mapping now has: ${JSON.stringify(mapping.platformMessages)}`);
  }

  /**
   * Get a mapping by platform and message ID
   */
  getMappingByPlatformMessage(platform: Platform, messageId: string): MessageMapping | undefined {
    const key = `${platform}:${messageId}`;
    const mappingId = this.messageIdToMappingId.get(key);
    
    if (!mappingId) {
      logger.debug(`No mapping ID found for key ${key}`);
      return undefined;
    }
    
    logger.debug(`Found mapping ID ${mappingId} for key ${key}`);
    return this.mappings.get(mappingId);
  }

  /**
   * Get a mapping ID by platform and message ID
   */
  getMappingIdByPlatformMessage(platform: Platform, messageId: string): string | undefined {
    const key = `${platform}:${messageId}`;
    return this.messageIdToMappingId.get(key);
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
      logger.info(`getReplyToInfo: No mapping found for ${mappingId}`);
      return undefined;
    }
    
    if (!mapping.replyToMapping) {
      logger.info(`getReplyToInfo: Mapping ${mappingId} is not a reply`);
      return undefined;
    }

    const replyToMapping = this.mappings.get(mapping.replyToMapping);
    if (!replyToMapping) {
      logger.info(`getReplyToInfo: Reply-to mapping ${mapping.replyToMapping} not found`);
      return undefined;
    }

    logger.info(`getReplyToInfo: Reply-to mapping has platform messages: ${JSON.stringify(replyToMapping.platformMessages)}`);
    
    const targetMessageId = replyToMapping.platformMessages[targetPlatform];
    if (!targetMessageId) {
      logger.info(`getReplyToInfo: No ${targetPlatform} message ID in reply-to mapping`);
      return undefined;
    }

    logger.info(`getReplyToInfo: Found reply info for ${targetPlatform}: messageId=${targetMessageId}, author=${replyToMapping.author}`);
    
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

  /**
   * Find a mapping by matching content and author
   * Used to find potential matches for native messages
   */
  findMappingByContent(content: string, author: string, platform: Platform, timeWindow: number = 300000): string | undefined {
    const now = Date.now();
    
    for (const [mappingId, mapping] of this.mappings.entries()) {
      // Skip if this mapping is from the same platform
      if (mapping.originalPlatform === platform) continue;
      
      // Check if within time window (default 5 minutes)
      const timeDiff = Math.abs(mapping.timestamp.getTime() - now);
      if (timeDiff > timeWindow) continue;
      
      // Check if content matches (case insensitive, trimmed)
      const contentMatches = mapping.content.trim().toLowerCase() === content.trim().toLowerCase();
      
      // For author matching, be more flexible (remove platform prefixes, case insensitive)
      const cleanAuthor = author.replace(/^\[.*?\]\s*/, '').trim().toLowerCase();
      const cleanMappingAuthor = mapping.author.replace(/^\[.*?\]\s*/, '').trim().toLowerCase();
      const authorMatches = cleanMappingAuthor === cleanAuthor;
      
      if (contentMatches && authorMatches) {
        logger.debug(`Found potential mapping match: ${mappingId} for content "${content}" by ${author}`);
        return mappingId;
      }
    }
    
    return undefined;
  }
  
  /**
   * Find the most recent message from a specific author
   * Used for reply detection in platforms that use @mentions
   */
  findRecentMessageByAuthor(author: string, platform: Platform, timeWindow: number = 300000): MessageMapping | undefined {
    const now = Date.now();
    const cleanAuthor = author.trim().toLowerCase();
    let mostRecent: MessageMapping | undefined;
    
    for (const mapping of this.mappings.values()) {
      // Check if within time window (default 5 minutes)
      const timeDiff = now - mapping.timestamp.getTime();
      if (timeDiff > timeWindow) continue;
      
      // Check if author matches (case insensitive)
      const mappingAuthor = mapping.author.trim().toLowerCase();
      if (mappingAuthor !== cleanAuthor) continue;
      
      // Check if it's from the specified platform
      if (mapping.originalPlatform !== platform) continue;
      
      // Update most recent if this is newer
      if (!mostRecent || mapping.timestamp > mostRecent.timestamp) {
        mostRecent = mapping;
      }
    }
    
    return mostRecent;
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
   * Find the mapping ID for a message by author and platform
   * Used for Twitch replies to cross-platform messages
   */
  findMappingIdByAuthorAndPlatform(author: string, sourcePlatform: Platform, timeWindow: number = 300000): string | undefined {
    const now = Date.now();
    const cleanAuthor = author.trim().toLowerCase();
    let mostRecentMapping: { id: string; timestamp: Date } | undefined;
    
    for (const [mappingId, mapping] of this.mappings.entries()) {
      // Check if within time window (default 5 minutes)
      const timeDiff = now - mapping.timestamp.getTime();
      if (timeDiff > timeWindow) continue;
      
      // Check if author matches (case insensitive)
      const mappingAuthor = mapping.author.trim().toLowerCase();
      if (mappingAuthor !== cleanAuthor) continue;
      
      // Check if it's from the specified source platform
      if (mapping.originalPlatform !== sourcePlatform) continue;
      
      // Update most recent if this is newer
      if (!mostRecentMapping || mapping.timestamp > mostRecentMapping.timestamp) {
        mostRecentMapping = { id: mappingId, timestamp: mapping.timestamp };
      }
    }
    
    logger.debug(`findMappingIdByAuthorAndPlatform: Looking for ${author} from ${sourcePlatform}, found: ${mostRecentMapping?.id || 'none'}`);
    return mostRecentMapping?.id;
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
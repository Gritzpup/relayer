import { Platform } from '../types';
import { logger } from '../utils/logger';
import { messageDb } from '../database/db';
import { getRedisClient, setMessageMapping, getMessageMapping, deleteMessageMapping } from '../services/redis';

interface MessageMapping {
  id: string;
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
  private readonly MAPPING_PREFIX = 'mapping:';
  private readonly PLATFORM_PREFIX = 'platform:';
  private readonly AUTHOR_PREFIX = 'author:';
  private readonly MAPPING_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

  constructor() {
    // Redis handles primary storage, SQLite for archival
  }

  /**
   * Create a new message mapping for a message being relayed
   */
  async createMapping(
    originalPlatform: Platform,
    originalMessageId: string,
    content: string,
    author: string,
    replyToMessageId?: string,
    replyToContent?: string,
    replyToAuthor?: string,
    replyToPlatform?: Platform
  ): Promise<string> {
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
          replyToMapping = await this.findMappingIdByAuthorAndPlatform(replyToAuthor, sourcePlatform);
          if (replyToMapping) {
            logger.info(`TWITCH REPLY: Found cross-platform reply mapping: ${replyToMapping} for ${replyToAuthor} from ${sourcePlatform}`);
          } else {
            logger.info(`TWITCH REPLY: No mapping found for ${replyToAuthor} from ${sourcePlatform}`);
          }
        }
      } else {
        // Standard reply handling for Discord and Telegram
        
        // First check if this is a reply to a bot message (has platform info extracted)
        if (replyToAuthor && replyToPlatform) {
          logger.info(`REPLY CREATE: Detected reply to bot message - looking for ${replyToAuthor} from ${replyToPlatform}`);
          const potentialMapping = await this.findMappingIdByAuthorAndPlatform(replyToAuthor, replyToPlatform);
          if (potentialMapping) {
            // Special handling: We found the original message mapping
            // Add the bot's message ID to this mapping so future lookups work
            await this.addPlatformMessage(potentialMapping, originalPlatform, replyToMessageId);
            replyToMapping = potentialMapping;
            logger.info(`REPLY CREATE: Found mapping by author and platform: ${potentialMapping} for ${replyToAuthor} from ${replyToPlatform}`);
            logger.info(`REPLY CREATE: Added bot message ${replyToMessageId} to mapping for future lookups`);
          } else {
            logger.info(`REPLY CREATE: No mapping found for ${replyToAuthor} from ${replyToPlatform}`);
          }
        } else {
          // Not a reply to a bot message - do standard lookup
          logger.info(`REPLY CREATE: Looking for mapping of reply-to message ${replyToMessageId} on ${originalPlatform}`);
          replyToMapping = await this.getMappingIdByPlatformMessage(originalPlatform, replyToMessageId);
          
          if (replyToMapping) {
            logger.info(`REPLY CREATE: Found reply to message: ${replyToMessageId} maps to mapping ${replyToMapping}`);
          } else {
            logger.info(`REPLY CREATE: No mapping found for platform message ${originalPlatform}:${replyToMessageId}`);
            
            // If still not found, try to find a mapping by content match (for native messages)
            if (replyToContent && replyToAuthor) {
              const potentialMapping = await this.findMappingByContent(replyToContent, replyToAuthor, originalPlatform);
              if (potentialMapping) {
                replyToMapping = potentialMapping;
                logger.debug(`Found potential mapping by content match: ${potentialMapping}`);
                // Add this platform message to the mapping so future replies work
                await this.addPlatformMessage(potentialMapping, originalPlatform, replyToMessageId);
              }
            }
          }
        }
      }
      
      if (!replyToMapping) {
        logger.debug(`No mapping found for reply-to message ${replyToMessageId} on ${originalPlatform}`);
      }
    }
    
    // Create mapping object
    const mapping: MessageMapping = {
      id: mappingId,
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

    // Store in Redis (primary)
    await setMessageMapping(this.MAPPING_PREFIX + mappingId, mapping, this.MAPPING_TTL);
    
    // Create reverse lookups in Redis
    await setMessageMapping(
      this.PLATFORM_PREFIX + originalPlatform + ':' + originalMessageId, 
      mappingId, 
      this.MAPPING_TTL
    );
    
    // Store author lookup for recent messages
    await setMessageMapping(
      this.AUTHOR_PREFIX + author + ':' + originalPlatform + ':' + Date.now(),
      mappingId,
      300 // 5 minute TTL for author lookups
    );
    
    // Async store in SQLite for archival (don't await)
    this.archiveToDatabase({
      id: mappingId,
      originalPlatform,
      originalMessageId,
      author,
      content,
      replyToMapping
    }, originalPlatform, originalMessageId).catch(err => 
      logger.error('Failed to archive message to database:', err)
    );
    
    logger.info(`MAPPING CREATED: ${mappingId} for ${originalPlatform} message ${originalMessageId}${replyToMapping ? ` (reply to ${replyToMapping})` : ''}`);
    if (replyToMapping) {
      logger.info(`REPLY MAPPING: Message ${originalMessageId} from ${originalPlatform} is a reply linked to mapping ${replyToMapping}`);
    }
    
    return mappingId;
  }

  /**
   * Add a platform message ID to an existing mapping
   */
  async addPlatformMessage(mappingId: string, platform: Platform, messageId: string): Promise<void> {
    // Get existing mapping from Redis
    const mapping = await getMessageMapping(this.MAPPING_PREFIX + mappingId);
    if (!mapping) {
      logger.error(`Cannot add platform message - mapping ${mappingId} not found`);
      return;
    }
    
    // Update the mapping
    mapping.platformMessages[platform] = messageId;
    await setMessageMapping(this.MAPPING_PREFIX + mappingId, mapping, this.MAPPING_TTL);
    
    // Create reverse lookup
    await setMessageMapping(
      this.PLATFORM_PREFIX + platform + ':' + messageId,
      mappingId,
      this.MAPPING_TTL
    );
    
    // Async update database (don't await)
    messageDb.trackPlatformMessage({
      mappingId,
      platform,
      messageId
    }).catch(err => logger.error('Failed to track platform message in database:', err));
    
    logger.info(`PLATFORM MESSAGE: Added ${platform} message ${messageId} to mapping ${mappingId}`);
  }

  /**
   * Update a platform message ID (used when message is deleted and resent, like Twitch edits)
   */
  async updatePlatformMessage(mappingId: string, platform: Platform, newMessageId: string): Promise<void> {
    // Get the mapping
    const mapping = await getMessageMapping(this.MAPPING_PREFIX + mappingId);
    if (!mapping) {
      logger.error(`Cannot update platform message - mapping ${mappingId} not found`);
      return;
    }
    
    // Get the old message ID
    const oldMessageId = mapping.platformMessages[platform];
    
    // Remove old reverse lookup if it exists
    if (oldMessageId) {
      await deleteMessageMapping(this.PLATFORM_PREFIX + platform + ':' + oldMessageId);
    }
    
    // Update the mapping
    mapping.platformMessages[platform] = newMessageId;
    await setMessageMapping(this.MAPPING_PREFIX + mappingId, mapping, this.MAPPING_TTL);
    
    // Create new reverse lookup
    await setMessageMapping(
      this.PLATFORM_PREFIX + platform + ':' + newMessageId,
      mappingId,
      this.MAPPING_TTL
    );
    
    // Async update database (don't await)
    messageDb.trackPlatformMessage({
      mappingId,
      platform,
      messageId: newMessageId
    }).catch(err => logger.error('Failed to update platform message in database:', err));
    
    logger.info(`PLATFORM MESSAGE: Updated ${platform} message from ${oldMessageId} to ${newMessageId} in mapping ${mappingId}`);
  }

  /**
   * Get a mapping by platform and message ID
   */
  async getMappingByPlatformMessage(platform: Platform, messageId: string): Promise<MessageMapping | undefined> {
    // First check Redis
    const mappingId = await getMessageMapping(this.PLATFORM_PREFIX + platform + ':' + messageId);
    if (!mappingId) {
      logger.debug(`No mapping found for ${platform}:${messageId}`);
      return undefined;
    }
    
    const mapping = await getMessageMapping(this.MAPPING_PREFIX + mappingId);
    if (!mapping) {
      // Redis inconsistency, try database
      const dbMapping = await messageDb.getMappingByPlatformMessage(platform, messageId);
      if (dbMapping) {
        // Restore to Redis
        await this.restoreToRedis(dbMapping as MessageMapping);
        return dbMapping as MessageMapping;
      }
      return undefined;
    }
    
    logger.debug(`Found mapping for ${platform}:${messageId}`);
    return mapping as MessageMapping;
  }

  /**
   * Get a mapping ID by platform and message ID
   */
  async getMappingIdByPlatformMessage(platform: Platform, messageId: string): Promise<string | undefined> {
    const mappingId = await getMessageMapping(this.PLATFORM_PREFIX + platform + ':' + messageId);
    if (mappingId) return mappingId;
    
    // Fallback to database
    const mapping = await messageDb.getMappingByPlatformMessage(platform, messageId);
    if (mapping) {
      // Restore to Redis for future lookups
      await this.restoreToRedis(mapping as MessageMapping);
      return mapping.id;
    }
    return undefined;
  }

  /**
   * Get a mapping by mapping ID
   */
  async getMapping(mappingId: string): Promise<MessageMapping | undefined> {
    const mapping = await getMessageMapping(this.MAPPING_PREFIX + mappingId);
    if (mapping) return mapping as MessageMapping;
    
    // Fallback to database
    const dbMapping = await messageDb.getMapping(mappingId);
    if (dbMapping) {
      await this.restoreToRedis(dbMapping as MessageMapping);
      return dbMapping as MessageMapping;
    }
    return undefined;
  }

  /**
   * Get the reply-to information for a message
   */
  async getReplyToInfo(mappingId: string, targetPlatform: Platform): Promise<{
    messageId: string;
    author: string;
    content: string;
  } | undefined> {
    const mapping = await messageDb.getMapping(mappingId);
    if (!mapping) {
      logger.info(`getReplyToInfo: No mapping found for ${mappingId}`);
      return undefined;
    }
    
    if (!mapping.replyToMapping) {
      logger.info(`getReplyToInfo: Mapping ${mappingId} is not a reply`);
      return undefined;
    }

    const replyToMapping = await messageDb.getMapping(mapping.replyToMapping);
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
  async updateMessageContent(platform: Platform, messageId: string, newContent: string): Promise<void> {
    const mapping = await this.getMappingByPlatformMessage(platform, messageId);
    if (!mapping) {
      logger.warn(`No mapping found for ${platform} message ${messageId} to update`);
      return;
    }

    // Update content in Redis
    mapping.content = newContent;
    await setMessageMapping(this.MAPPING_PREFIX + mapping.id, mapping, this.MAPPING_TTL);
    
    // Update content in database
    await messageDb.updateContent(mapping.id, newContent);
    
    logger.info(`Updated content for ${platform}:${messageId} (mapping ${mapping.id})`);
  }

  /**
   * Get all platform messages for a given message
   */
  async getAllPlatformMessages(platform: Platform, messageId: string): Promise<{ 
    [key in Platform]?: string 
  } | undefined> {
    const mapping = await this.getMappingByPlatformMessage(platform, messageId);
    return mapping?.platformMessages;
  }

  /**
   * Find all messages that reply to a specific mapping
   */
  async findRepliesTo(mappingId: string): Promise<MessageMapping[]> {
    // Use the database method to find replies
    const replies = await messageDb.findRepliesTo(mappingId);
    
    // Convert database format to MessageMapping format if needed
    const mappedReplies: MessageMapping[] = [];
    for (const reply of replies) {
      if (reply) {
        mappedReplies.push(reply as MessageMapping);
      }
    }
    
    logger.info(`Found ${mappedReplies.length} replies to mapping ${mappingId}`);
    return mappedReplies;
  }

  /**
   * Find a mapping by matching content and author
   * Used to find potential matches for native messages
   */
  async findMappingByContent(_content: string, _author: string, _platform: Platform, _timeWindow: number = 300000): Promise<string | undefined> {
    // This is a complex query that's hard to do with current database methods
    // For now, we'll return undefined and log a warning
    logger.warn(`findMappingByContent not yet implemented for database`);
    return undefined;
  }
  
  /**
   * Find the most recent message from a specific author
   * Used for reply detection in platforms that use @mentions
   */
  async findRecentMessageByAuthor(_author: string, _platform: Platform, _timeWindow: number = 300000): Promise<MessageMapping | undefined> {
    // This would require a more complex database query
    // For now, we'll return undefined and log a warning
    logger.warn(`findRecentMessageByAuthor not yet implemented for database`);
    return undefined;
  }

  /**
   * Remove a mapping and all its references
   */
  async removeMapping(mappingId: string): Promise<void> {
    // Get mapping first to clean up reverse lookups
    const mapping = await getMessageMapping(this.MAPPING_PREFIX + mappingId);
    if (mapping) {
      // Remove all platform lookups
      for (const [platform, messageId] of Object.entries(mapping.platformMessages)) {
        await deleteMessageMapping(this.PLATFORM_PREFIX + platform + ':' + messageId);
      }
    }
    
    // Remove main mapping
    await deleteMessageMapping(this.MAPPING_PREFIX + mappingId);
    
    // Async remove from database (don't await)
    messageDb.removeMapping(mappingId).catch(err => 
      logger.error('Failed to remove mapping from database:', err)
    );
    
    logger.info(`Removed mapping ${mappingId}`);
  }

  private generateMappingId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Cleanup is now handled by the database automatically

  /**
   * Find the mapping ID for a message by author and platform
   * Used for Twitch replies to cross-platform messages
   */
  async findMappingIdByAuthorAndPlatform(author: string, sourcePlatform: Platform, timeWindow: number = 300000): Promise<string | undefined> {
    const now = Date.now();
    const startTime = now - timeWindow;
    
    // Scan for recent author keys
    const pattern = this.AUTHOR_PREFIX + author + ':' + sourcePlatform + ':*';
    const keys = await this.scanKeys(pattern);
    
    // Find the most recent one within time window
    let mostRecentMappingId: string | undefined;
    let mostRecentTime = 0;
    
    for (const key of keys) {
      const timestamp = parseInt(key.split(':').pop() || '0');
      if (timestamp >= startTime && timestamp > mostRecentTime) {
        const mappingId = await getMessageMapping(key);
        if (mappingId) {
          mostRecentMappingId = mappingId;
          mostRecentTime = timestamp;
        }
      }
    }
    
    if (mostRecentMappingId) {
      logger.debug(`findMappingIdByAuthorAndPlatform: Found ${mostRecentMappingId} for ${author} from ${sourcePlatform}`);
      return mostRecentMappingId;
    }
    
    // Fallback to database
    const mapping = await messageDb.findMappingByAuthorAndPlatform(author, sourcePlatform);
    logger.debug(`findMappingIdByAuthorAndPlatform: Database lookup for ${author} from ${sourcePlatform}, found: ${mapping?.id || 'none'}`);
    return mapping?.id;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ size: number; maxSize: number; oldestMessage: Date | null }> {
    const redis = getRedisClient();
    const info = await redis.info('memory');
    const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || '0');
    
    return {
      size: usedMemory,
      maxSize: 0, // Redis doesn't have a fixed size limit
      oldestMessage: null
    };
  }

  /**
   * Helper to scan Redis keys by pattern
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const redis = getRedisClient();
    const keys: string[] = [];
    let cursor = '0';
    
    do {
      const [newCursor, foundKeys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = newCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');
    
    return keys;
  }

  /**
   * Archive message to database asynchronously
   */
  private async archiveToDatabase(mappingData: any, platform: Platform, messageId: string): Promise<void> {
    try {
      await messageDb.createMapping(mappingData);
      await messageDb.trackPlatformMessage({
        mappingId: mappingData.id,
        platform,
        messageId
      });
    } catch (error) {
      logger.error('Failed to archive to database:', error);
    }
  }

  /**
   * Restore a mapping from database to Redis
   */
  private async restoreToRedis(mapping: MessageMapping): Promise<void> {
    try {
      // Store main mapping
      await setMessageMapping(this.MAPPING_PREFIX + mapping.id, mapping, this.MAPPING_TTL);
      
      // Restore platform lookups
      for (const [platform, messageId] of Object.entries(mapping.platformMessages)) {
        if (messageId) {
          await setMessageMapping(
            this.PLATFORM_PREFIX + platform + ':' + messageId,
            mapping.id,
            this.MAPPING_TTL
          );
        }
      }
      
      logger.debug(`Restored mapping ${mapping.id} to Redis from database`);
    } catch (error) {
      logger.error('Failed to restore mapping to Redis:', error);
    }
  }
}
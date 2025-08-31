import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';
import { Platform } from '../types';

export interface MessageTrackingData {
  telegramMsgId: number;
  mappingId?: string;
  chatId: number;
  userId?: number;
  username?: string;
  content?: string;
  platform?: string;
}

export interface PlatformMessageData {
  mappingId: string;
  platform: Platform;
  messageId: string;
}

export class MessageDatabase {
  db!: Database<sqlite3.Database, sqlite3.Statement>; // Made public for webhook access
  private dbPath = './relay_messages.db';
  private cleanupInterval?: NodeJS.Timeout;

  async initialize(): Promise<void> {
    const maxRetries = 5;
    let retryDelay = 1000; // Start with 1 second
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.db = await open({
          filename: this.dbPath,
          driver: sqlite3.Database
        });

        // Enable foreign keys and WAL mode for better concurrency
        await this.db.run('PRAGMA foreign_keys = ON');
        await this.db.run('PRAGMA journal_mode = WAL');
        await this.db.run('PRAGMA busy_timeout = 10000'); // Increased to 10 second busy timeout
        await this.db.run('PRAGMA synchronous = NORMAL'); // Better performance with WAL
        await this.db.run('PRAGMA cache_size = -64000'); // 64MB cache
        await this.db.run('PRAGMA temp_store = MEMORY'); // Use memory for temp tables

        // Create tables from schema
        const schemaPath = join(__dirname, 'schema.sql');
        const schema = readFileSync(schemaPath, 'utf-8');
        await this.db.exec(schema);

        logger.info('Database initialized successfully');
        
        // Start periodic cleanup
        this.startPeriodicCleanup();
        return; // Success, exit the retry loop
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        
        if (errorMessage.includes('database is locked') && attempt < maxRetries) {
          logger.warn(`Database locked, retrying in ${retryDelay}ms... (attempt ${attempt}/${maxRetries})`);
          
          // Try to close any existing connection
          if (this.db) {
            try {
              await this.db.close();
            } catch (closeError) {
              // Ignore close errors
            }
          }
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryDelay = Math.min(retryDelay * 2, 10000); // Exponential backoff, max 10 seconds
        } else {
          logger.error('Failed to initialize database:', error);
          throw error;
        }
      }
    }
    
    throw new Error(`Failed to initialize database after ${maxRetries} attempts`);
  }

  async trackMessage(data: MessageTrackingData): Promise<void> {
    try {
      await this.db.run(`
        INSERT INTO message_tracking 
        (telegram_msg_id, mapping_id, chat_id, user_id, username, content, platform)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_msg_id) DO UPDATE SET
          mapping_id = excluded.mapping_id,
          username = excluded.username,
          content = excluded.content
      `, [
        data.telegramMsgId,
        data.mappingId,
        data.chatId,
        data.userId,
        data.username,
        data.content,
        data.platform || 'Telegram'
      ]);
    } catch (error) {
      logger.error('Failed to track message:', error);
    }
  }

  async trackPlatformMessage(data: PlatformMessageData): Promise<void> {
    try {
      await this.db.run(`
        INSERT INTO platform_messages 
        (mapping_id, platform, message_id)
        VALUES (?, ?, ?)
        ON CONFLICT(platform, message_id) DO NOTHING
      `, [
        data.mappingId,
        data.platform,
        data.messageId
      ]);
    } catch (error) {
      logger.error('Failed to track platform message:', error);
    }
  }

  async markDeleted(telegramMsgId: number): Promise<void> {
    try {
      await this.db.run(`
        UPDATE message_tracking 
        SET is_deleted = TRUE, deleted_at = datetime('now')
        WHERE telegram_msg_id = ?
      `, [telegramMsgId]);
    } catch (error) {
      logger.error('Failed to mark message as deleted:', error);
    }
  }

  async getMappingId(telegramMsgId: number): Promise<string | null> {
    try {
      const result = await this.db.get<{ mapping_id: string }>(
        'SELECT mapping_id FROM message_tracking WHERE telegram_msg_id = ?',
        [telegramMsgId]
      );
      return result?.mapping_id || null;
    } catch (error) {
      logger.error('Failed to get mapping ID:', error);
      return null;
    }
  }

  async getMappingIdByBotMessage(platform: Platform, messageId: string): Promise<string | null> {
    try {
      const result = await this.db.get<{ mapping_id: string }>(
        'SELECT mapping_id FROM platform_messages WHERE platform = ? AND message_id = ?',
        [platform, messageId]
      );
      return result?.mapping_id || null;
    } catch (error) {
      logger.error('Failed to get mapping ID by bot message:', error);
      return null;
    }
  }

  async getRecentUndeletedMessages(minutes: number = 5): Promise<Array<{ telegram_msg_id: number; chat_id: number }>> {
    try {
      const results = await this.db.all<Array<{ telegram_msg_id: number; chat_id: number }>>(
        `SELECT telegram_msg_id, chat_id 
         FROM message_tracking
         WHERE timestamp > datetime('now', '-${minutes} minutes')
         AND is_deleted = FALSE
         AND platform = 'Telegram'`,
        []
      );
      return results || [];
    } catch (error) {
      logger.error('Failed to get recent undeleted messages:', error);
      return [];
    }
  }

  async updateMappingId(telegramMsgId: number, mappingId: string): Promise<void> {
    try {
      await this.db.run(
        'UPDATE message_tracking SET mapping_id = ? WHERE telegram_msg_id = ?',
        [mappingId, telegramMsgId]
      );
    } catch (error) {
      logger.error('Failed to update mapping ID:', error);
    }
  }

  // Message mapping methods (for replacing in-memory MessageMapper)
  async createMapping(data: {
    id: string;
    originalPlatform: string;
    originalMessageId: string;
    author: string;
    content: string;
    replyToMapping?: string;
  }): Promise<void> {
    try {
      await this.db.run(`
        INSERT INTO message_mappings 
        (id, original_platform, original_message_id, author, content, reply_to_mapping)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        data.id,
        data.originalPlatform,
        data.originalMessageId,
        data.author,
        data.content,
        data.replyToMapping
      ]);
    } catch (error) {
      logger.error('Failed to create mapping:', error);
    }
  }

  async getMapping(mappingId: string): Promise<any | null> {
    try {
      const mapping = await this.db.get(
        'SELECT * FROM message_mappings WHERE id = ?',
        [mappingId]
      );
      
      if (!mapping) return null;
      
      // Get all platform messages for this mapping
      const platformMessages = await this.db.all(
        'SELECT platform, message_id FROM platform_messages WHERE mapping_id = ?',
        [mappingId]
      );
      
      // Convert to object format
      const platformMessagesObj: any = {};
      platformMessages.forEach((pm: any) => {
        platformMessagesObj[pm.platform] = pm.message_id;
      });
      
      return {
        id: mapping.id,
        originalPlatform: mapping.original_platform,
        originalMessageId: mapping.original_message_id,
        author: mapping.author,
        content: mapping.content,
        timestamp: new Date(mapping.timestamp),
        replyToMapping: mapping.reply_to_mapping,
        platformMessages: platformMessagesObj
      };
    } catch (error) {
      logger.error('Failed to get mapping:', error);
      return null;
    }
  }

  async getMappingByPlatformMessage(platform: string, messageId: string): Promise<any | null> {
    try {
      // First check if this is an original message
      const originalMapping = await this.db.get(
        'SELECT id FROM message_mappings WHERE original_platform = ? AND original_message_id = ?',
        [platform, messageId]
      );
      
      if (originalMapping) {
        return this.getMapping(originalMapping.id);
      }
      
      // Then check platform messages
      const platformMapping = await this.db.get(
        'SELECT mapping_id FROM platform_messages WHERE platform = ? AND message_id = ?',
        [platform, messageId]
      );
      
      if (platformMapping) {
        return this.getMapping(platformMapping.mapping_id);
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get mapping by platform message:', error);
      return null;
    }
  }

  async findMappingByAuthorAndPlatform(author: string, platform: string): Promise<any | null> {
    try {
      const mapping = await this.db.get(`
        SELECT * FROM message_mappings 
        WHERE LOWER(author) = LOWER(?) 
        AND original_platform = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `, [author, platform]);
      
      if (mapping) {
        return this.getMapping(mapping.id);
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to find mapping by author and platform:', error);
      return null;
    }
  }

  async removeMapping(mappingId: string): Promise<void> {
    try {
      // Platform messages will be deleted automatically due to CASCADE
      await this.db.run('DELETE FROM message_mappings WHERE id = ?', [mappingId]);
    } catch (error) {
      logger.error('Failed to remove mapping:', error);
    }
  }

  async updateContent(mappingId: string, newContent: string): Promise<void> {
    try {
      await this.db.run(
        'UPDATE message_mappings SET content = ? WHERE id = ?',
        [newContent, mappingId]
      );
      logger.info(`Updated content for mapping ${mappingId}`);
    } catch (error) {
      logger.error('Failed to update mapping content:', error);
    }
  }

  async findRepliesTo(mappingId: string): Promise<any[]> {
    try {
      const replies = await this.db.all(
        'SELECT * FROM message_mappings WHERE reply_to_mapping = ?',
        [mappingId]
      );
      
      // Get full mapping data for each reply
      const fullReplies = [];
      for (const reply of replies) {
        const fullReply = await this.getMapping(reply.id);
        if (fullReply) {
          fullReplies.push(fullReply);
        }
      }
      
      return fullReplies;
    } catch (error) {
      logger.error('Failed to find replies to mapping:', error);
      return [];
    }
  }

  // Cleanup old messages (2 days instead of 5 to save memory)
  async cleanupOldMessages(): Promise<number> {
    try {
      // First get the mappings that will be deleted
      const oldMappings = await this.db.all(
        `SELECT id FROM message_mappings WHERE timestamp < datetime('now', '-2 days')`
      );
      
      if (oldMappings.length === 0) return 0;
      
      // Delete old mappings (platform_messages will cascade delete)
      const result = await this.db.run(
        `DELETE FROM message_mappings WHERE timestamp < datetime('now', '-2 days')`
      );
      
      // Also clean up old telegram tracking
      await this.db.run(
        `DELETE FROM message_tracking WHERE timestamp < datetime('now', '-2 days')`
      );
      
      logger.info(`Cleaned up ${result.changes} old message mappings`);
      return result.changes || 0;
    } catch (error) {
      logger.error('Failed to cleanup old messages:', error);
      return 0;
    }
  }

  // Start periodic cleanup (runs every 30 minutes to prevent memory buildup)
  startPeriodicCleanup(): void {
    // Run cleanup immediately
    this.cleanupOldMessages();
    
    // Then run every 30 minutes instead of every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldMessages();
    }, 30 * 60 * 1000); // 30 minutes
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    if (this.db) {
      await this.db.close();
    }
  }
}

// Export singleton instance
export const messageDb = new MessageDatabase();
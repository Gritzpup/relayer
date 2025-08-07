import { getSubClient, getPubClient } from '../services/redis';
import { logger } from '../utils/logger';
import { Platform } from '../types';

export interface DeletionEvent {
  mappingId: string;
  platform: Platform;
  messageId: string;
  timestamp: number;
}

export type DeletionHandler = (event: DeletionEvent) => Promise<void>;

class RedisEventManager {
  private readonly DELETION_CHANNEL = 'message:deletions';
  private deletionHandlers: DeletionHandler[] = [];
  private isSubscribed = false;

  /**
   * Subscribe to deletion events
   */
  async subscribeToDeletions(handler: DeletionHandler): Promise<void> {
    this.deletionHandlers.push(handler);
    
    if (!this.isSubscribed) {
      const subClient = getSubClient();
      
      await subClient.subscribe(this.DELETION_CHANNEL);
      
      subClient.on('message', async (channel, message) => {
        logger.info(`=== REDIS MESSAGE RECEIVED ===`);
        logger.info(`Channel: ${channel}, Raw message: ${message}`);
        
        if (channel === this.DELETION_CHANNEL) {
          try {
            const event: DeletionEvent = JSON.parse(message);
            logger.info(`Parsed deletion event:`, event);
            logger.info(`Number of deletion handlers: ${this.deletionHandlers.length}`);
            
            // Call all handlers
            await Promise.all(
              this.deletionHandlers.map((handler, index) => {
                logger.info(`Calling deletion handler ${index + 1}...`);
                return handler(event).catch(err => 
                  logger.error(`Deletion handler ${index + 1} error:`, err)
                );
              })
            );
            logger.info(`All deletion handlers completed`);
          } catch (error) {
            logger.error('Failed to process deletion event:', error);
          }
        }
      });
      
      this.isSubscribed = true;
      logger.info('Subscribed to Redis deletion events');
    }
  }

  /**
   * Publish a deletion event
   */
  async publishDeletion(event: DeletionEvent): Promise<void> {
    const pubClient = getPubClient();
    const message = JSON.stringify(event);
    
    await pubClient.publish(this.DELETION_CHANNEL, message);
    logger.info(`Published deletion event: ${event.platform} message ${event.messageId}`);
  }

  /**
   * Unsubscribe from deletion events
   */
  async unsubscribe(): Promise<void> {
    if (this.isSubscribed) {
      const subClient = getSubClient();
      await subClient.unsubscribe(this.DELETION_CHANNEL);
      this.isSubscribed = false;
      this.deletionHandlers = [];
      logger.info('Unsubscribed from Redis deletion events');
    }
  }
}

export const redisEvents = new RedisEventManager();
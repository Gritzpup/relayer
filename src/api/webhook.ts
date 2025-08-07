import express from 'express';
import { messageDb } from '../database/db';
import { logger } from '../utils/logger';
import { Platform } from '../types';
import { redisEvents, DeletionEvent } from '../relay/redisEvents';

const router = express.Router();

// Store relay manager instance
let relayManagerInstance: any = null;

export function setRelayManager(manager: any) {
  relayManagerInstance = manager;
}

router.post('/deletion-webhook', async (req, res) => {
  logger.info(`=== DELETION WEBHOOK RECEIVED ===`);
  logger.info(`Request body:`, JSON.stringify(req.body));
  logger.info(`Headers:`, req.headers);
  
  const { telegram_msg_id, mapping_id } = req.body;
  
  logger.info(`Deletion webhook processing: Telegram msg ${telegram_msg_id}, mapping ${mapping_id}`);
  
  try {
    if (!mapping_id) {
      logger.error('No mapping_id provided in deletion webhook');
      return res.status(400).json({ success: false, error: 'mapping_id required' });
    }
    
    // Publish deletion event via Redis pub/sub
    const deletionEvent: DeletionEvent = {
      mappingId: mapping_id,
      platform: Platform.Telegram,
      messageId: telegram_msg_id,
      timestamp: Date.now()
    };
    
    await redisEvents.publishDeletion(deletionEvent);
    logger.info(`Published deletion event for mapping ${mapping_id}`);
    
    // Async mark as deleted in database (don't await)
    messageDb.markDeleted(telegram_msg_id).catch(err => 
      logger.error('Failed to mark message as deleted in database:', err)
    );
    
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Error in deletion webhook:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Test deletion endpoint (for debugging)
router.post('/test-deletion', async (req, res) => {
  logger.info('Test deletion endpoint called');
  const { messageId } = req.body;
  
  if (!messageId) {
    return res.status(400).json({ error: 'messageId required' });
  }
  
  // Find mapping by Telegram message ID
  const db = messageDb.db;
  if (!db) {
    return res.status(500).json({ error: 'Database not initialized' });
  }
  
  try {
    const mappingRow = await db.get<{ mapping_id: string }>(
      `SELECT mapping_id FROM message_tracking 
       WHERE telegram_msg_id = ? AND platform = 'Telegram'
       LIMIT 1`,
      [messageId]
    );
    
    if (mappingRow) {
      logger.info(`Test deletion: Found mapping ${mappingRow.mapping_id} for message ${messageId}`);
      
      // Call the deletion handler
      if (relayManagerInstance) {
        await relayManagerInstance.handleMessageDeletion(Platform.Telegram, messageId.toString());
        res.status(200).json({ 
          success: true, 
          message: `Deletion processed for Telegram message ${messageId}`,
          mapping_id: mappingRow.mapping_id 
        });
      } else {
        res.status(500).json({ error: 'Relay manager not initialized' });
      }
    } else {
      res.status(404).json({ error: `Message ${messageId} not found in database` });
    }
  } catch (error) {
    logger.error('Error in test deletion:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
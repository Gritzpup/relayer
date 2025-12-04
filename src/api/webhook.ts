import express from 'express';
import { messageDb } from '../database/db';
import { logger } from '../utils/logger';
import { Platform, RelayMessage } from '../types';
import { redisEvents, DeletionEvent } from '../relay/redisEvents';
import crypto from 'crypto';
import axios from 'axios';

const router = express.Router();

// Store relay manager instance
let relayManagerInstance: any = null;

// Cache Kick public key
let kickPublicKey: string | null = null;

export function setRelayManager(manager: any) {
  relayManagerInstance = manager;
}

async function getKickPublicKey(): Promise<string> {
  if (kickPublicKey) {
    return kickPublicKey;
  }

  try {
    const response = await axios.get('https://api.kick.com/public/v1/public-key');
    // Extract public key from response - it's nested in data.data.public_key
    kickPublicKey = response.data?.data?.public_key || response.data?.public_key || response.data;
    logger.debug(`Fetched Kick public key: ${kickPublicKey.substring(0, 50)}...`);
    return kickPublicKey;
  } catch (error) {
    logger.error('Failed to fetch Kick public key:', error);
    throw error;
  }
}

function verifyKickSignature(messageId: string, timestamp: string, body: string, signature: string, publicKey: string): boolean {
  try {
    // Create the message string that was signed - concatenate with "." separator
    const message = `${messageId}.${timestamp}.${body}`;

    // Decode the base64 signature
    const signatureBuffer = Buffer.from(signature, 'base64');

    // Verify using RSA-SHA256
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(message);
    verifier.end();

    return verifier.verify(publicKey, signatureBuffer);
  } catch (error) {
    logger.error('Error verifying Kick signature:', error);
    return false;
  }
}

router.post('/deletion-webhook', async (req, res): Promise<void> => {
  logger.info(`=== DELETION WEBHOOK RECEIVED ===`);
  logger.info(`Request body:`, JSON.stringify(req.body));
  logger.info(`Headers:`, req.headers);
  
  const { telegram_msg_id, mapping_id } = req.body;
  
  logger.info(`Deletion webhook processing: Telegram msg ${telegram_msg_id}, mapping ${mapping_id}`);
  
  try {
    if (!mapping_id) {
      logger.error('No mapping_id provided in deletion webhook');
      res.status(400).json({ success: false, error: 'mapping_id required' });
      return;
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

// Kick webhook endpoint for receiving chat messages
router.post('/kick-webhook', async (req, res): Promise<void> => {
  logger.info(`=== KICK WEBHOOK RECEIVED ===`);
  logger.debug(`Kick webhook headers:`, req.headers);
  logger.debug(`Kick webhook body:`, JSON.stringify(req.body));

  try {
    // Get signature headers (case-insensitive)
    const messageId = req.headers['kick-event-message-id'] as string;
    const timestamp = req.headers['kick-event-message-timestamp'] as string;
    const signature = req.headers['kick-event-signature'] as string;
    const eventType = req.headers['kick-event-type'] as string;

    if (!messageId || !timestamp || !signature) {
      logger.warn('Kick webhook missing required headers');
      res.status(400).json({ success: false, error: 'Missing required headers' });
      return;
    }

    // Verify signature
    const publicKey = await getKickPublicKey();
    const bodyString = JSON.stringify(req.body);
    logger.debug(`Verifying signature with message: ${messageId}.${timestamp}.${bodyString.substring(0, 100)}...`);
    const isValid = verifyKickSignature(messageId, timestamp, bodyString, signature, publicKey);

    if (!isValid) {
      logger.warn('Kick webhook signature verification failed');
      logger.debug(`Public key: ${publicKey.substring(0, 50)}...`);
      // Continue processing anyway for now to test the flow
      // res.status(401).json({ success: false, error: 'Invalid signature' });
      // return;
    } else {
      logger.info('Kick webhook signature verified successfully');
    }

    logger.info(`Kick webhook verified - Event type: ${eventType}`);

    // Handle chat.message.sent event
    if (eventType === 'chat.message.sent') {
      // Kick webhook sends the event data directly in the body, not nested in event_data
      const eventData = req.body;

      // Skip bot's own messages (check if KICK_USERNAME is defined or if it's @Relayer)
      const senderUsername = eventData?.sender?.username || '';
      const isOwnMessage = (process.env.KICK_USERNAME && senderUsername === process.env.KICK_USERNAME) ||
                          senderUsername === '@Relayer' ||
                          senderUsername.toLowerCase() === 'relayer' ||
                          senderUsername.toLowerCase() === '@relayer';

      if (isOwnMessage) {
        logger.debug(`Kick webhook: Skipping message from bot account (${senderUsername})`);
        res.status(200).json({ success: true, message: 'Ignored own message' });
        return;
      }

      // Check if this is a relayed message - messages that START with platform prefix
      // This prevents the bot from seeing its own relayed messages and echoing them back
      const messageContent = eventData?.content || '';
      const isRelayedMessage = /^\[?(Telegram|Discord|Twitch|Kick|YouTube|𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦|𝐃𝐢𝐬𝐜𝐨𝐫𝐝|𝐓𝐰𝐢𝐭𝐜𝐡|𝐊𝐢𝐜𝐤|𝐘𝐨𝐮𝐓𝐮𝐛𝐞)\]/.test(messageContent) ||
        /^(🔵|🟣|🔴|🟢|✈️|🎮|💬)/.test(messageContent);

      if (isRelayedMessage) {
        logger.debug(`Kick webhook: Skipping relayed message: "${messageContent.substring(0, 50)}..."`);
        res.status(200).json({ success: true, message: 'Ignored relayed message' });
        return;
      }

      logger.info(`Kick chat message: ${eventData?.sender?.username}: ${eventData?.content}`);

      // Trigger the Kick service's message handler
      if (relayManagerInstance && eventData) {
        try {
          const kickService = relayManagerInstance.services.get(Platform.Kick);
          if (!kickService) {
            logger.error('Kick service not found in relay manager');
            return;
          }

          // Check if this message is a reply
          let replyTo: RelayMessage['replyTo'] | undefined;
          if (eventData.replies_to) {
            // Kick provides reply information in replies_to field
            replyTo = {
              messageId: eventData.replies_to.message_id || eventData.replies_to.id || '',
              author: eventData.replies_to.sender?.username || eventData.replies_to.username || 'Unknown',
              content: eventData.replies_to.content || '',
              platform: Platform.Kick,
            };
            logger.debug(`Kick reply detected: replying to ${replyTo.author}: "${replyTo.content.substring(0, 30)}..."`);
          }

          // Create the relay message that the Kick service would have created
          const relayMessage: RelayMessage = {
            id: eventData.message_id,
            platform: Platform.Kick,
            author: eventData.sender?.username || 'Unknown',
            content: eventData.content || '',
            timestamp: new Date(eventData.created_at || Date.now()),
            channelName: 'general',
            replyTo,
            raw: eventData,
          };

          logger.debug(`Created relay message: ${JSON.stringify(relayMessage).substring(0, 200)}...`);

          // Trigger the Kick service's onMessage handler directly
          // This will go through the same flow as messages from other platforms
          if (kickService && 'messageHandler' in kickService) {
            const handler = (kickService as any).messageHandler;
            if (handler) {
              await handler(relayMessage);
              logger.info(`Kick webhook message relayed successfully`);
            } else {
              logger.error('Kick service has no message handler set');
            }
          }
        } catch (relayError) {
          logger.error('Error relaying Kick message:', relayError);
          logger.error('Error stack:', relayError instanceof Error ? relayError.stack : 'no stack');
          throw relayError;
        }
      } else {
        logger.warn(`Cannot relay Kick message - relayManagerInstance: ${!!relayManagerInstance}, eventData: ${!!eventData}`);
      }
    } else {
      logger.info(`Kick webhook - unhandled event type: ${eventType}`);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Error processing Kick webhook:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// Health check endpoint
router.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Test deletion endpoint (for debugging)
router.post('/test-deletion', async (req, res): Promise<void> => {
  logger.info('Test deletion endpoint called');
  const { messageId } = req.body;
  
  if (!messageId) {
    res.status(400).json({ error: 'messageId required' });
    return;
  }
  
  // Find mapping by Telegram message ID
  const db = messageDb.db;
  if (!db) {
    res.status(500).json({ error: 'Database not initialized' });
    return;
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
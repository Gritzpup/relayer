import { validateConfig } from './config';
import { RelayManager } from './relay/manager';
import { logger, logError } from './utils/logger';
import { messageDb } from './database/db';
import express from 'express';
import webhookRouter, { setRelayManager } from './api/webhook';
import { twitchTokenManager } from './services/twitchTokenManager';

let relayManager: RelayManager | null = null;

async function main() {
  try {
    logger.info('Starting Chat Relay Service...');
    
    validateConfig();
    logger.info('Configuration validated successfully');

    // Initialize Twitch token manager and start auto-refresh
    await twitchTokenManager.initialize();
    twitchTokenManager.startAutoRefresh();
    logger.info('Twitch token manager initialized');

    // Initialize database
    await messageDb.initialize();
    logger.info('Database initialized');

    // Set up Express server for webhooks
    const app = express();
    app.use(express.json());
    app.use('/api', webhookRouter);
    
    const PORT = process.env.WEBHOOK_PORT || 4002;
    app.listen(PORT, () => {
      logger.info(`Webhook server listening on port ${PORT}`);
    });

    relayManager = new RelayManager();
    setRelayManager(relayManager); // Pass to webhook handler
    await relayManager.start();

    setupGracefulShutdown();
    
    setInterval(async () => {
      if (relayManager) {
        const status = await relayManager.getStatus();
        logger.info('Service Status Update', {
          connectedServices: status.services.filter((s: any) => s.connected).length,
          totalMessages: status.services.reduce((sum: number, s: any) => sum + s.messagesReceived, 0),
        });
      }
    }, 300000); // Log status every 5 minutes

  } catch (error) {
    logError(error as Error, 'Failed to start relay service');
    process.exit(1);
  }
}

function setupGracefulShutdown() {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    if (relayManager) {
      await relayManager.stop();
    }
    
    // Close database connection
    await messageDb.close();
    
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  process.on('uncaughtException', (error: Error) => {
    logError(error, 'Uncaught exception');
    shutdown('uncaughtException');
  });
  
  process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled rejection:', reason);
    shutdown('unhandledRejection');
  });
}

main().catch(error => {
  logError(error as Error, 'Unhandled error in main');
  process.exit(1);
});
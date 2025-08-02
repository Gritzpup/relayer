import { validateConfig } from './config';
import { RelayManager } from './relay/manager';
import { logger, logError } from './utils/logger';

let relayManager: RelayManager | null = null;

async function main() {
  try {
    logger.info('Starting Chat Relay Service...');
    
    validateConfig();
    logger.info('Configuration validated successfully');

    relayManager = new RelayManager();
    await relayManager.start();

    setupGracefulShutdown();
    
    setInterval(() => {
      if (relayManager) {
        const status = relayManager.getStatus();
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
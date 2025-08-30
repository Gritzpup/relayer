import { validateConfig } from './config';
import { RelayManager } from './relay/manager';
import { logger, logError } from './utils/logger';
import { messageDb } from './database/db';
import express from 'express';
import webhookRouter, { setRelayManager } from './api/webhook';
import { twitchTokenManager } from './services/twitchTokenManager';
import { memoryMonitor } from './utils/memoryMonitor';

let relayManager: RelayManager | null = null;
let webhookServer: any = null; // Store server reference for cleanup

async function main() {
  try {
    console.log('\n==================================================');
    console.log('       STARTING CHAT RELAY SERVICE');
    console.log('==================================================\n');
    logger.info('Starting Chat Relay Service...');
    
    console.log('[STARTUP] Validating configuration...');
    validateConfig();
    logger.info('Configuration validated successfully');
    console.log('[STARTUP] ✅ Configuration validated');

    // Initialize Twitch token manager and start auto-refresh
    console.log('[STARTUP] Initializing Twitch token manager...');
    await twitchTokenManager.initialize();
    twitchTokenManager.startAutoRefresh();
    logger.info('Twitch token manager initialized');
    console.log('[STARTUP] ✅ Twitch token manager ready');

    // Initialize database
    console.log('[STARTUP] Initializing database...');
    await messageDb.initialize();
    logger.info('Database initialized');
    console.log('[STARTUP] ✅ Database ready');

    // Set up Express server for webhooks
    console.log('[STARTUP] Setting up webhook server...');
    const app = express();
    app.use(express.json());
    app.use('/api', webhookRouter);
    
    const PORT = process.env.WEBHOOK_PORT || 4002;
    console.log(`[STARTUP] Attempting to start webhook server on port ${PORT}...`);
    
    webhookServer = app.listen(PORT, () => {
      logger.info(`Webhook server listening on port ${PORT}`);
      console.log(`[STARTUP] ✅ Webhook server successfully started on port ${PORT}`);
    });
    
    // Add listening event
    webhookServer.on('listening', () => {
      console.log(`[WEBHOOK] Server is now accepting connections on port ${PORT}`);
    });
    
    // Handle server errors
    webhookServer.on('error', (error: any) => {
      console.error(`[WEBHOOK] ❌ Server error:`, error.message);
      if (error.code === 'EADDRINUSE') {
        console.error(`[WEBHOOK] Port ${PORT} is already in use!`);
        logger.error(`Port ${PORT} is already in use. Please ensure no other instances are running.`);
        logger.error('Try running: lsof -i :' + PORT + ' to find the process using this port');
        console.log('\nTo find what\'s using the port, run:');
        console.log(`  lsof -i :${PORT}`);
        console.log('\nTo kill the process, run:');
        console.log(`  kill -9 <PID>`);
        process.exit(1);
      } else {
        logger.error('Webhook server error:', error);
      }
    });

    console.log('[STARTUP] Creating relay manager...');
    relayManager = new RelayManager();
    setRelayManager(relayManager); // Pass to webhook handler
    console.log('[STARTUP] ✅ Relay manager created');
    
    console.log('[STARTUP] Starting relay manager (connecting to all services)...');
    console.log('[STARTUP] This will connect to: Discord, Telegram, and Twitch');
    await relayManager.start();
    console.log('[STARTUP] ✅ All services started successfully!');
    
    console.log('\n==================================================');
    console.log('       RELAY SERVICE IS NOW RUNNING');
    console.log('==================================================');
    console.log('\n[STATUS] Monitoring messages from:');
    console.log('  - Discord');
    console.log('  - Telegram') ;
    console.log('  - Twitch');
    console.log('\n[INFO] Press Ctrl+C to stop\n');
    
    // Start memory monitoring
    memoryMonitor.start(60); // Check memory every 60 seconds
    logger.info('Memory monitoring enabled');

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
    console.error('\n[STARTUP] ❌ FATAL ERROR during startup:', error);
    logError(error as Error, 'Failed to start relay service');
    process.exit(1);
  }
}

function setupGracefulShutdown() {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    // Stop memory monitoring
    memoryMonitor.stop();
    
    if (relayManager) {
      await relayManager.stop();
    }
    
    // Close webhook server
    if (webhookServer) {
      await new Promise<void>((resolve) => {
        webhookServer.close(() => {
          logger.info('Webhook server closed');
          resolve();
        });
      });
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
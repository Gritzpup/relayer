import { validateConfig } from './config';
import { RelayManager } from './relay/manager';
import { logger, logError } from './utils/logger';
import { messageDb } from './database/db';
import express from 'express';
import webhookRouter, { setRelayManager } from './api/webhook';
import { twitchTokenManager } from './services/twitchTokenManager';
import { memoryMonitor } from './utils/memoryMonitor';
import fs from 'fs';

let relayManager: RelayManager | null = null;
let webhookServer: any = null; // Store server reference for cleanup

// Simple lockfile-based single instance enforcement — no ps/grep required
const LOCK_FILE = '/tmp/relayer.lock';

function cleanupLockfile() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const content = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      if (content === process.pid.toString()) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch { /* ignore */ }
}

async function acquireLock(): Promise<boolean> {
  cleanupLockfile();
  const myPid = process.pid.toString();
  try {
    // Try to create lock file exclusively
    fs.writeFileSync(LOCK_FILE, myPid, { flag: 'wx' });
    console.log(`🔒 [LOCK] Acquired lock (PID ${myPid})`);
    return true;
  } catch (err: any) {
    if (err.code === 'EEXIST') {
      // Lock file exists — check if the holding process is still alive
      try {
        const holder = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim());
        try {
          process.kill(holder, 0); // Check if process exists
          console.log(`🔒 [LOCK] Existing relayer holding lock (PID ${holder}), this instance (PID ${myPid}) will exit`);
          return false;
        } catch {
          // Holder is dead but lock file wasn't cleaned up — steal the lock
          fs.writeFileSync(LOCK_FILE, myPid);
          console.log(`🔒 [LOCK] Previous holder (PID ${holder}) dead, acquired stale lock (PID ${myPid})`);
          return true;
        }
      } catch {
        fs.writeFileSync(LOCK_FILE, myPid);
        return true;
      }
    }
    console.error(`🔒 [LOCK] Unexpected lock error:`, err);
    return false;
  }
}

// No periodic instance check — lockfile handles singleton at startup

async function main() {
  try {
    console.log('\n==================================================');
    console.log('       STARTING CHAT RELAY SERVICE');
    console.log('==================================================\n');
    
    // Lockfile-based single instance enforcement
    const lockOk = await acquireLock();
    if (!lockOk) {
      console.log('Another relayer instance is already running. Exiting.');
      process.exit(0);
    }
    process.on('exit', cleanupLockfile);
    process.on('SIGINT', cleanupLockfile);
    process.on('SIGTERM', cleanupLockfile);
    
    console.log('✅ Chat Relay Service startup initiated...');
    
    // console.log('[STARTUP] Validating configuration...');
    validateConfig();
    // logger.info('Configuration validated successfully');
    // console.log('[STARTUP] ✅ Configuration validated');

    // Initialize Twitch token manager and start auto-refresh
    // console.log('[STARTUP] Initializing Twitch token manager...');
    await twitchTokenManager.initialize();
    twitchTokenManager.startAutoRefresh();
    // logger.info('Twitch token manager initialized');
    // console.log('[STARTUP] ✅ Twitch token manager ready');

    // Initialize database
    // console.log('[STARTUP] Initializing database...');
    await messageDb.initialize();
    // logger.info('Database initialized');
    // console.log('[STARTUP] ✅ Database ready');

    // Set up Express server for webhooks
    // console.log('[STARTUP] Setting up webhook server...');
    const app = express();
    app.use(express.json());
    app.use('/api', webhookRouter);
    
    // Health endpoint
    app.get('/health', (req, res) => {
      try {
        if (!relayManager) {
          return res.status(503).json({
            status: 'unhealthy',
            message: 'Relay manager not initialized',
            uptime: process.uptime()
          });
        }
        
        const status = relayManager.getStatus();
        const allConnected = status.services.every((service: any) => service.connected);
        
        res.json({
          status: allConnected ? 'healthy' : 'degraded',
          uptime: process.uptime(),
          services: status.services,
          isRunning: status.isRunning,
          messageHistory: status.messageHistory,
          rateLimit: status.rateLimit
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
          uptime: process.uptime()
        });
      }
    });
    
    const PORT = process.env.WEBHOOK_PORT || 14002;
    // console.log(`[STARTUP] Attempting to start webhook server on port ${PORT}...`);
    
    webhookServer = app.listen(PORT, () => {
      logger.info(`Webhook server listening on port ${PORT}`);
      // console.log(`[STARTUP] ✅ Webhook server successfully started on port ${PORT}`);
    });
    
    // Add listening event
    webhookServer.on('listening', () => {
      // console.log(`[WEBHOOK] Server is now accepting connections on port ${PORT}`);
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

    // console.log('[STARTUP] Creating relay manager...');
    relayManager = new RelayManager();
    setRelayManager(relayManager); // Pass to webhook handler
    // console.log('[STARTUP] ✅ Relay manager created');
    
    // console.log('[STARTUP] Starting relay manager (connecting to all services)...');
    // console.log('[STARTUP] This will connect to: Discord, Telegram, and Twitch');
    await relayManager.start();
    // console.log('[STARTUP] ✅ All services started successfully!');
    
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
    // logger.info('Memory monitoring enabled');

    setupGracefulShutdown();
    
    // Commented out to reduce log noise - status updates every 5 minutes
    // setInterval(async () => {
    //   if (relayManager) {
    //     const status = await relayManager.getStatus();
    //     logger.info('Service Status Update', {
    //       connectedServices: status.services.filter((s: any) => s.connected).length,
    //       totalMessages: status.services.reduce((sum: number, s: any) => sum + s.messagesReceived, 0),
    //     });
    //   }
    // }, 300000); // Log status every 5 minutes

  } catch (error) {
    console.error('\n[STARTUP] ❌ FATAL ERROR during startup:', error);
    logError(error as Error, 'Failed to start relay service');
    process.exit(1);
  }
}

function setupGracefulShutdown() {
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    
    // 🔥 MEMORY LEAK FIX: Stop periodic instance checking
    stopPeriodicInstanceCheck();
    
    // Stop memory monitoring
    memoryMonitor.stop();
    
    if (relayManager) {
      await relayManager.stop();
    }
    
    // Close webhook server
    if (webhookServer) {
      await new Promise<void>((resolve) => {
        webhookServer.close(() => {
          console.log('Webhook server closed');
          resolve();
        });
      });
    }
    
    // Close database connection
    await messageDb.close();
    
    // Close Winston logger transports to prevent "write after end" errors
    if (logger && logger.end) {
      logger.end();
    }
    
    console.log('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  process.on('uncaughtException', (error: Error) => {
    console.error('Uncaught exception:', error);
    shutdown('uncaughtException');
  });
  
  process.on('unhandledRejection', (reason: any) => {
    console.error('Unhandled rejection:', reason);
    shutdown('unhandledRejection');
  });
}

main().catch(error => {
  logError(error as Error, 'Unhandled error in main');
  process.exit(1);
});
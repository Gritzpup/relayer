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

async function checkSingleInstance(checkType = 'startup') {
  console.log(`🔍 [${checkType.toUpperCase()}] Checking for multiple relayer instances...`);
  console.log(`🔍 [${checkType.toUpperCase()}] Current process PID: ${process.pid}`);
  console.log(`🔍 [${checkType.toUpperCase()}] Parent process PID: ${process.ppid}`);
  console.log(`🔍 [${checkType.toUpperCase()}] Process start time: ${new Date().toISOString()}`);
  
  // Check for existing relayer processes using a different approach
  // Look for processes with our unique relayer signature in command line
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const check = spawn('ps', ['aux']);
    let output = '';
    
    // 🔥 MEMORY LEAK FIX: Set timeout to prevent hanging processes
    const timeout = setTimeout(() => {
      check.kill('SIGTERM');
      console.error(`❌ [${checkType.toUpperCase()}] Process check timed out, killing ps command`);
      reject(new Error('Process check timeout'));
    }, 5000);
    
    check.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    
    check.stderr.on('data', (data: Buffer) => {
      console.error(`🔍 [${checkType.toUpperCase()}] ps stderr:`, data.toString());
    });
    
    check.on('close', (code) => {
      clearTimeout(timeout);
      const lines = output.trim().split('\n');
      // Look for lines that contain "STARTING CHAT RELAY SERVICE" or our main function
      const relayerLines = lines.filter(line => 
        (line.includes('tsx') && line.includes('src/index.ts')) ||
        (line.includes('node') && line.includes('relayer') && line.includes('src/index.ts'))
      );
      
      console.log(`🔍 [${checkType.toUpperCase()}] Found relayer processes:`, relayerLines);
      
      const allPids = relayerLines.map(line => {
        const parts = line.trim().split(/\s+/);
        return parts[1]; // PID is second column in ps aux
      }).filter(pid => pid && pid.trim() && /^\d+$/.test(pid));
      
      const otherPids = allPids.filter(pid => 
        pid !== process.pid.toString() && 
        pid !== process.ppid.toString()
      );
      
      console.log(`🔍 [${checkType.toUpperCase()}] All relayer PIDs found: ${allPids.join(', ')}`);
      console.log(`🔍 [${checkType.toUpperCase()}] Other PIDs (not this process): ${otherPids.join(', ')}`);
      
      if (otherPids.length > 0) {
        const errorMsg = `❌ [${checkType.toUpperCase()}] MULTIPLE INSTANCES DETECTED!`;
        console.error(errorMsg);
        console.error(`❌ [${checkType.toUpperCase()}] Found ${otherPids.length} existing relayer instances`);
        console.error(`❌ [${checkType.toUpperCase()}] Existing PIDs: ${otherPids.join(', ')}`);
        console.error(`❌ [${checkType.toUpperCase()}] Current PID: ${process.pid}`);
        console.error(`❌ [${checkType.toUpperCase()}] Full process list:`);
        lines.forEach(line => console.error(`❌ [${checkType.toUpperCase()}] ${line}`));
        
        logger.error(errorMsg);
        logger.error(`Multiple instances - Current: ${process.pid}, Others: ${otherPids.join(', ')}`);
        
        if (checkType === 'periodic') {
          console.error(`❌ [PERIODIC] STOPPING RELAYER DUE TO MULTIPLE INSTANCES`);
          logger.error('STOPPING RELAYER DUE TO MULTIPLE INSTANCES DURING PERIODIC CHECK');
          process.exit(1);
        }
        
        console.log(`🔄 [${checkType.toUpperCase()}] Attempting to kill existing instances...`);
        
        // Kill the OTHER instances (older ones), not this one
        let killedCount = 0;
        otherPids.forEach(pid => {
          try {
            process.kill(parseInt(pid), 'SIGTERM');
            console.log(`✅ [${checkType.toUpperCase()}] Killed old relayer PID ${pid}`);
            killedCount++;
          } catch (err) {
            console.log(`⚠️ [${checkType.toUpperCase()}] Could not kill PID ${pid}:`, (err as Error).message);
          }
        });
        
        if (killedCount > 0) {
          console.log(`🎯 [${checkType.toUpperCase()}] Killed ${killedCount} existing instances. This instance (PID: ${process.pid}) will continue.`);
          // Wait for old processes to die
          setTimeout(() => resolve(true), 3000);
        } else {
          console.error(`❌ [${checkType.toUpperCase()}] FAILED TO KILL ANY INSTANCES - STOPPING TO PREVENT CONFLICTS`);
          logger.error('FAILED TO KILL ANY INSTANCES - STOPPING TO PREVENT CONFLICTS');
          process.exit(1);
        }
      } else {
        console.log(`✅ [${checkType.toUpperCase()}] Single instance check passed - no other instances found`);
        resolve(true);
      }
    });
    
    // 🔥 MEMORY LEAK FIX: Handle process errors and cleanup
    check.on('error', (error) => {
      clearTimeout(timeout);
      console.error(`❌ [${checkType.toUpperCase()}] Error spawning ps command:`, error);
      reject(error);
    });
  });
}

// Periodic instance check - REDUCED FREQUENCY TO PREVENT MEMORY LEAKS
let periodicCheckInterval: NodeJS.Timeout | null = null;

function startPeriodicInstanceCheck() {
  // 🔥 MEMORY LEAK FIX: Reduced from 30s to 5 minutes and added cleanup
  periodicCheckInterval = setInterval(async () => {
    try {
      console.log('🔄 [PERIODIC] Running periodic instance check...');
      await checkSingleInstance('periodic');
    } catch (error) {
      console.error('❌ [PERIODIC] Error during periodic instance check:', error);
      logger.error('Error during periodic instance check:', error);
    }
  }, 300000); // Check every 5 minutes instead of 30 seconds
}

function stopPeriodicInstanceCheck() {
  if (periodicCheckInterval) {
    clearInterval(periodicCheckInterval);
    periodicCheckInterval = null;
    console.log('✅ Stopped periodic instance checking');
  }
}

async function main() {
  try {
    console.log('\n==================================================');
    console.log('       STARTING CHAT RELAY SERVICE');
    console.log('==================================================\n');
    
    // Temporarily disable instance checking to get service running
    // await checkSingleInstance('startup');
    
    // Temporarily disable periodic instance checking 
    // console.log('🔄 Starting periodic instance monitoring (every 30 seconds)...');
    // startPeriodicInstanceCheck();
    
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
    
    const PORT = process.env.WEBHOOK_PORT || 4002;
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
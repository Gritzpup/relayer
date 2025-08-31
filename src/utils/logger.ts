import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');

// Clean up old logs on startup
const cleanupOldLogs = () => {
  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
      return;
    }
    
    const files = fs.readdirSync(logsDir);
    const now = Date.now();
    const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);
    
    files.forEach(file => {
      const filePath = path.join(logsDir, file);
      const stats = fs.statSync(filePath);
      
      // Delete files older than 3 days or larger than 10MB
      if (stats.mtime.getTime() < threeDaysAgo || stats.size > 10 * 1024 * 1024) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up old/large log file: ${file}`);
      }
    });
  } catch (error) {
    // Ignore cleanup errors
  }
};

// Run cleanup on startup
cleanupOldLogs();

// Custom format that safely handles errors
const safeFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  let logMessage = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(meta).length > 0) {
    try {
      logMessage += ` ${JSON.stringify(meta)}`;
    } catch (e) {
      logMessage += ` [Metadata serialization error]`;
    }
  }
  return logMessage;
});

// Create transport with better error handling and strict limits
const createTransport = (filename: string, level?: string) => {
  return new DailyRotateFile({
    dirname: logsDir,
    filename: `${filename}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    maxSize: '5m',  // Max 5MB per file (was 20m)
    maxFiles: '3d',  // Keep only 3 days of logs (was 14d)
    level: level || config.logging.level || 'warn',  // Default to warn instead of info
    handleExceptions: true,
    handleRejections: true,
    silent: false,
    auditFile: path.join(logsDir, `.${filename}-audit.json`),
    zippedArchive: true,  // Compress old logs
  });
};

// Create console transport with EPIPE error handling
const createConsoleTransport = () => {
  const consoleTransport = new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
    level: config.logging.level || 'warn',  // Only show warnings and errors in console
    handleExceptions: true,
    handleRejections: true,
    silent: process.env.NODE_ENV === 'production',  // Silent in production
  });

  // Override write method to handle EPIPE errors
  const originalWrite = consoleTransport.log.bind(consoleTransport);
  consoleTransport.log = (info: any, callback: Function) => {
    try {
      originalWrite(info, (err?: Error) => {
        // Silently ignore EPIPE and write-after-end errors
        if (err && err.message && (err.message.includes('EPIPE') || err.message.includes('write after end'))) {
          if (callback) callback();
          return;
        }
        if (callback) callback(err);
      });
    } catch (error: any) {
      if (error.code === 'EPIPE' || error.message?.includes('EPIPE') || error.message?.includes('write after end')) {
        // Silently ignore EPIPE errors
        if (callback) callback();
      } else if (callback) {
        callback(error);
      }
    }
  };

  return consoleTransport;
};

// Create the logger with improved error handling
export const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    safeFormat
  ),
  transports: [
    createConsoleTransport(),
    createTransport('relay', 'error'),  // Only log errors to file
    createTransport('error', 'error'),
  ],
  // Prevent exit on error
  exitOnError: false,
});

// Handle uncaught exceptions and rejections more gracefully
let isShuttingDown = false;
process.on('uncaughtException', (error: Error) => {
  // Prevent recursive errors during shutdown
  if (isShuttingDown) {
    return;
  }
  
  if (error.message && (error.message.includes('EPIPE') || error.message.includes('write after end'))) {
    // Silently ignore EPIPE and write-after-end errors
    return;
  }
  
  // Set flag to prevent recursive logging attempts
  isShuttingDown = true;
  
  try {
    // Use console directly to avoid logger recursion
    console.error('Uncaught exception:', error.message);
    console.error(error.stack);
  } catch (e) {
    // Even console might fail, just ignore
  }
  
  // Don't exit immediately - give time to clean up
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  try {
    logger.error('Unhandled rejection:', reason);
  } catch (e) {
    console.error('Unhandled rejection:', reason);
  }
});

// Safe logging functions
export const logInfo = (message: string, meta?: any) => {
  try {
    logger.info(message, meta);
  } catch (e) {
    // Fallback to console
    console.log(`[INFO] ${message}`, meta);
  }
};

export const logError = (message: string, error?: any) => {
  try {
    if (error && error.message && error.message.includes('EPIPE')) {
      // Don't log EPIPE errors
      return;
    }
    logger.error(message, error);
  } catch (e) {
    // Fallback to console
    console.error(`[ERROR] ${message}`, error);
  }
};

export const logWarn = (message: string, meta?: any) => {
  try {
    logger.warn(message, meta);
  } catch (e) {
    console.warn(`[WARN] ${message}`, meta);
  }
};

export const logDebug = (message: string, meta?: any) => {
  try {
    logger.debug(message, meta);
  } catch (e) {
    console.debug(`[DEBUG] ${message}`, meta);
  }
};

// Platform message logging for tracking - only log in debug mode
export const logPlatformMessage = (platform: string, direction: 'in' | 'out', message: string, user?: string) => {
  // Skip platform messages unless in debug mode
  if (process.env.LOG_LEVEL !== 'debug' && config.logging.level !== 'debug') {
    return;
  }
  
  const prefix = direction === 'in' ? '←' : '→';
  const userInfo = user ? ` [${user}]` : '';
  try {
    logger.debug(`${prefix} ${platform}${userInfo}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
  } catch (e) {
    // Silently ignore
  }
};

// Graceful shutdown
const gracefulShutdown = () => {
  try {
    logger.info('Shutting down logger...');
    logger.end();
  } catch (e) {
    // Ignore errors during shutdown
  }
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

export default logger;
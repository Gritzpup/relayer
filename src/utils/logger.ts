import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { config } from '../config';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

const fileRotateTransport = new DailyRotateFile({
  filename: path.join('logs', '%DATE%-relay.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: config.logging.maxSize,
  maxFiles: config.logging.maxFiles,
  format: logFormat,
});

const errorFileRotateTransport = new DailyRotateFile({
  filename: path.join('logs', '%DATE%-error.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: config.logging.maxSize,
  maxFiles: config.logging.maxFiles,
  format: logFormat,
  level: 'error',
});

export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    fileRotateTransport,
    errorFileRotateTransport,
  ],
  exitOnError: false,
});

export function logPlatformMessage(platform: string, direction: 'in' | 'out', message: string, author?: string) {
  const arrow = direction === 'in' ? 'ê' : 'í';
  const authorStr = author ? ` [${author}]` : '';
  logger.info(`${arrow} ${platform}${authorStr}: ${message}`);
}

export function logError(error: Error, context?: string) {
  logger.error(`${context || 'Error'}: ${error.message}`, { stack: error.stack });
}

export default logger;
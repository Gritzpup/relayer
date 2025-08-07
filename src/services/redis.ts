import Redis from 'ioredis';
import { logger } from '../utils/logger';

let redisClient: Redis | null = null;
let pubClient: Redis | null = null;
let subClient: Redis | null = null;

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
  showFriendlyErrorStack: true,
};

export function initializeRedis(): void {
  if (redisClient) {
    logger.warn('Redis client already initialized');
    return;
  }

  redisClient = new Redis(REDIS_CONFIG);
  pubClient = new Redis(REDIS_CONFIG);
  subClient = new Redis(REDIS_CONFIG);

  redisClient.on('connect', () => logger.info('Redis client connected'));
  redisClient.on('error', (err) => logger.error('Redis client error:', err));
  redisClient.on('ready', () => logger.info('Redis client ready'));

  pubClient.on('connect', () => logger.info('Redis pub client connected'));
  pubClient.on('error', (err) => logger.error('Redis pub client error:', err));

  subClient.on('connect', () => logger.info('Redis sub client connected'));
  subClient.on('error', (err) => logger.error('Redis sub client error:', err));
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call initializeRedis() first.');
  }
  return redisClient;
}

export function getPubClient(): Redis {
  if (!pubClient) {
    throw new Error('Redis pub client not initialized. Call initializeRedis() first.');
  }
  return pubClient;
}

export function getSubClient(): Redis {
  if (!subClient) {
    throw new Error('Redis sub client not initialized. Call initializeRedis() first.');
  }
  return subClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  if (pubClient) {
    await pubClient.quit();
    pubClient = null;
  }
  if (subClient) {
    await subClient.quit();
    subClient = null;
  }
  logger.info('Redis connections closed');
}

// Helper functions for common operations
export async function setMessageMapping(key: string, value: any, ttl?: number): Promise<void> {
  const client = getRedisClient();
  const stringValue = JSON.stringify(value);
  
  if (ttl) {
    await client.setex(key, ttl, stringValue);
  } else {
    await client.set(key, stringValue);
  }
}

export async function getMessageMapping(key: string): Promise<any | null> {
  const client = getRedisClient();
  const value = await client.get(key);
  
  if (!value) return null;
  
  try {
    return JSON.parse(value);
  } catch (error) {
    logger.error(`Failed to parse Redis value for key ${key}:`, error);
    return null;
  }
}

export async function deleteMessageMapping(key: string): Promise<void> {
  const client = getRedisClient();
  await client.del(key);
}

export async function publishDeletion(channel: string, data: any): Promise<void> {
  const client = getPubClient();
  await client.publish(channel, JSON.stringify(data));
}
import Redis from 'ioredis';
import { logger } from '../utils/logger';

// ============================================
// REDIS CONNECTION CONFIGURATION
// ============================================

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Parse Redis URL for logging (hide password)
const getRedisInfo = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'redis://localhost:6379';
  }
};

// Create Redis connection with retry logic
export const createRedisConnection = (): Redis => {
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      if (times > 10) {
        logger.error('[REDIS] Max retries reached, giving up');
        return null;
      }
      const delay = Math.min(times * 500, 5000);
      logger.warn(`[REDIS] Retrying connection in ${delay}ms (attempt ${times})`);
      return delay;
    },
  });

  redis.on('connect', () => {
    logger.info(`[REDIS] Connecting to ${getRedisInfo(REDIS_URL)}`);
  });

  redis.on('ready', () => {
    logger.info('[REDIS] ✅ Connection established and ready');
  });

  redis.on('error', (error) => {
    logger.error('[REDIS] Connection error:', error.message);
  });

  redis.on('close', () => {
    logger.warn('[REDIS] Connection closed');
  });

  redis.on('reconnecting', () => {
    logger.info('[REDIS] Reconnecting...');
  });

  return redis;
};

// Singleton connections
let redisClient: Redis | null = null;
let redisSubscriber: Redis | null = null;

// Get or create main Redis client
export const getRedisClient = (): Redis => {
  if (!redisClient) {
    redisClient = createRedisConnection();
  }
  return redisClient;
};

// Get or create Redis subscriber (for Pub/Sub)
export const getRedisSubscriber = (): Redis => {
  if (!redisSubscriber) {
    redisSubscriber = createRedisConnection();
  }
  return redisSubscriber;
};

// BullMQ connection options (shared across queues)
export const bullMQConnection = {
  host: new URL(REDIS_URL).hostname || 'localhost',
  port: parseInt(new URL(REDIS_URL).port || '6379'),
  password: new URL(REDIS_URL).password || undefined,
  maxRetriesPerRequest: null,
};

// Graceful shutdown
export const closeRedisConnections = async (): Promise<void> => {
  logger.info('[REDIS] Closing connections...');
  
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  
  if (redisSubscriber) {
    await redisSubscriber.quit();
    redisSubscriber = null;
  }
  
  logger.info('[REDIS] All connections closed');
};

// Health check
export const checkRedisHealth = async (): Promise<boolean> => {
  try {
    const client = getRedisClient();
    const result = await client.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('[REDIS] Health check failed:', error);
    return false;
  }
};

export default getRedisClient;

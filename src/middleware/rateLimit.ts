import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterMemory, IRateLimiterRes } from 'rate-limiter-flexible';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

// ============================================
// RATE LIMITING MIDDLEWARE
// Multi-tier rate limiting for API protection
// ============================================

// Rate limiter instances (initialized lazily)
let globalLimiter: RateLimiterRedis | RateLimiterMemory | null = null;
let authLimiter: RateLimiterRedis | RateLimiterMemory | null = null;
let aiUserLimiter: RateLimiterRedis | RateLimiterMemory | null = null;
let heavyOpLimiter: RateLimiterRedis | RateLimiterMemory | null = null;
let connectionLimiter: RateLimiterRedis | RateLimiterMemory | null = null;

// Rate limit configurations
const RATE_LIMITS = {
  // Global: DDoS protection
  global: {
    points: 1000,       // 1000 requests
    duration: 60,       // Per minute
    blockDuration: 60,  // Block for 1 minute if exceeded
  },
  // Auth: Prevent brute force
  auth: {
    points: 10,         // 10 auth attempts
    duration: 60,       // Per minute
    blockDuration: 300, // Block for 5 minutes
  },
  // AI: Prevent abuse of expensive AI operations
  ai: {
    points: 20,         // 20 AI requests
    duration: 60,       // Per minute
    blockDuration: 30,  // Block for 30 seconds
  },
  // Heavy: Schema sync and other heavy operations
  heavy: {
    points: 5,          // 5 heavy operations
    duration: 300,      // Per 5 minutes
    blockDuration: 60,  // Block for 1 minute
  },
  // Connection: Test/create connection
  connection: {
    points: 10,         // 10 connection operations
    duration: 60,       // Per minute
    blockDuration: 30,  // Block for 30 seconds
  },
};

// Initialize rate limiters
async function initializeLimiters(): Promise<void> {
  try {
    const redis = getRedisClient();
    
    // Test Redis connection
    await redis.ping();
    
    // Use Redis-based limiters
    globalLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:global',
      ...RATE_LIMITS.global,
    });
    
    authLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:auth',
      ...RATE_LIMITS.auth,
    });
    
    aiUserLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:ai',
      ...RATE_LIMITS.ai,
    });
    
    heavyOpLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:heavy',
      ...RATE_LIMITS.heavy,
    });
    
    connectionLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:conn',
      ...RATE_LIMITS.connection,
    });
    
    logger.info('[RATE_LIMIT] Redis-based rate limiters initialized');
  } catch (error) {
    logger.warn('[RATE_LIMIT] Redis unavailable, falling back to in-memory rate limiting');
    
    // Fallback to memory-based limiters
    globalLimiter = new RateLimiterMemory(RATE_LIMITS.global);
    authLimiter = new RateLimiterMemory(RATE_LIMITS.auth);
    aiUserLimiter = new RateLimiterMemory(RATE_LIMITS.ai);
    heavyOpLimiter = new RateLimiterMemory(RATE_LIMITS.heavy);
    connectionLimiter = new RateLimiterMemory(RATE_LIMITS.connection);
  }
}

// Get limiter by type
function getLimiter(type: 'global' | 'auth' | 'ai' | 'heavy' | 'connection') {
  const limiters = {
    global: globalLimiter,
    auth: authLimiter,
    ai: aiUserLimiter,
    heavy: heavyOpLimiter,
    connection: connectionLimiter,
  };
  return limiters[type];
}

// Get rate limit key based on type and request
function getRateLimitKey(type: string, req: Request): string {
  // For global limits, use IP
  if (type === 'global') {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }
  
  // For user-specific limits, prefer userId, fall back to IP
  const userId = (req as any).userId;
  if (userId) {
    return userId;
  }
  
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// Send rate limit response
function sendRateLimitResponse(res: Response, retryAfter: number, type: string): void {
  res.set('Retry-After', String(retryAfter));
  res.set('X-RateLimit-Type', type);
  res.status(429).json({
    success: false,
    error: 'Too many requests. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter,
    type,
  });
}

// ============================================
// MIDDLEWARE FACTORY
// ============================================

export type RateLimitType = 'global' | 'auth' | 'ai' | 'heavy' | 'connection';

/**
 * Create rate limiting middleware
 * @param type - The type of rate limit to apply
 */
export function rateLimit(type: RateLimitType) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Initialize limiters if not done yet
    if (!globalLimiter) {
      await initializeLimiters();
    }
    
    const limiter = getLimiter(type);
    if (!limiter) {
      logger.warn(`[RATE_LIMIT] No limiter found for type: ${type}`);
      return next();
    }
    
    const key = getRateLimitKey(type, req);
    
    try {
      const result = await limiter.consume(key);
      
      // Add rate limit headers
      res.set('X-RateLimit-Limit', String(RATE_LIMITS[type].points));
      res.set('X-RateLimit-Remaining', String(result.remainingPoints));
      res.set('X-RateLimit-Reset', String(Math.ceil(result.msBeforeNext / 1000)));
      
      next();
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`[RATE_LIMIT] Error:`, error);
        return next();
      }
      
      // Rate limit exceeded
      const rateLimitError = error as IRateLimiterRes;
      const retryAfter = Math.ceil((rateLimitError.msBeforeNext || 1000) / 1000);
      
      logger.warn(`[RATE_LIMIT] ${type} limit exceeded for ${key}`, { retryAfter });
      
      sendRateLimitResponse(res, retryAfter, type);
    }
  };
}

// ============================================
// CONVENIENCE MIDDLEWARE EXPORTS
// ============================================

/** Global rate limit - Apply to all routes */
export const globalRateLimit = rateLimit('global');

/** Auth rate limit - Apply to login/register routes */
export const authRateLimit = rateLimit('auth');

/** AI rate limit - Apply to AI generation routes */
export const aiRateLimit = rateLimit('ai');

/** Heavy operation rate limit - Apply to schema sync routes */
export const heavyRateLimit = rateLimit('heavy');

/** Connection rate limit - Apply to connection test/create routes */
export const connectionRateLimit = rateLimit('connection');

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Check remaining rate limit for a user/IP
 */
export async function getRateLimitStatus(
  type: RateLimitType, 
  key: string
): Promise<{ remaining: number; resetIn: number } | null> {
  if (!globalLimiter) {
    await initializeLimiters();
  }
  
  const limiter = getLimiter(type);
  if (!limiter) return null;
  
  try {
    const result = await limiter.get(key);
    if (!result) {
      return { remaining: RATE_LIMITS[type].points, resetIn: 0 };
    }
    return {
      remaining: result.remainingPoints,
      resetIn: Math.ceil(result.msBeforeNext / 1000),
    };
  } catch {
    return null;
  }
}

/**
 * Reset rate limit for a specific key (admin use)
 */
export async function resetRateLimit(type: RateLimitType, key: string): Promise<boolean> {
  if (!globalLimiter) {
    await initializeLimiters();
  }
  
  const limiter = getLimiter(type);
  if (!limiter) return false;
  
  try {
    await limiter.delete(key);
    logger.info(`[RATE_LIMIT] Reset ${type} limit for ${key}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Manually consume rate limit points (useful for custom logic)
 */
export async function consumeRateLimit(
  type: RateLimitType, 
  key: string, 
  points: number = 1
): Promise<boolean> {
  if (!globalLimiter) {
    await initializeLimiters();
  }
  
  const limiter = getLimiter(type);
  if (!limiter) return true;
  
  try {
    await limiter.consume(key, points);
    return true;
  } catch {
    return false;
  }
}

// Initialize on module load (async)
initializeLimiters().catch((error) => {
  logger.error('[RATE_LIMIT] Failed to initialize rate limiters:', error);
});

import { getRedisClient } from '../config/redis';
import { logger } from './logger';

// ============================================
// CACHE UTILITY
// Redis caching layer for schema and table data
// ============================================

// Cache TTL settings (in seconds)
export const CACHE_TTL = {
  SCHEMAS: 5 * 60,      // 5 minutes for schema list
  TABLES: 5 * 60,       // 5 minutes for tables in a schema
  CONNECTION: 5 * 60,   // 5 minutes for connection details
};

// Cache key prefixes
export const CACHE_KEYS = {
  schemas: (connectionId: string) => `connection:${connectionId}:schemas`,
  tables: (connectionId: string, schemaName: string) => `connection:${connectionId}:schema:${schemaName}:tables`,
  allTables: (connectionId: string) => `connection:${connectionId}:all-tables`,
};

/**
 * Get data from Redis cache
 */
export async function getFromCache<T>(key: string): Promise<{ data: T; cachedAt: Date } | null> {
  try {
    const redis = getRedisClient();
    const cached = await redis.get(key);
    
    if (!cached) {
      logger.debug(`[CACHE] Cache miss for key: ${key}`);
      return null;
    }
    
    const parsed = JSON.parse(cached);
    logger.debug(`[CACHE] Cache hit for key: ${key}`);
    return {
      data: parsed.data as T,
      cachedAt: new Date(parsed.cachedAt)
    };
  } catch (error: any) {
    logger.error(`[CACHE] Error getting cache for key ${key}:`, error);
    return null;
  }
}

/**
 * Set data in Redis cache with TTL
 */
export async function setCache<T>(key: string, data: T, ttlSeconds: number = CACHE_TTL.SCHEMAS): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const cacheData = JSON.stringify({
      data,
      cachedAt: new Date().toISOString()
    });
    
    await redis.set(key, cacheData, 'EX', ttlSeconds);
    logger.debug(`[CACHE] Cached data for key: ${key} with TTL: ${ttlSeconds}s`);
    return true;
  } catch (error: any) {
    logger.error(`[CACHE] Error setting cache for key ${key}:`, error);
    return false;
  }
}

/**
 * Delete a specific cache key
 */
export async function deleteCache(key: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    await redis.del(key);
    logger.debug(`[CACHE] Deleted cache for key: ${key}`);
    return true;
  } catch (error: any) {
    logger.error(`[CACHE] Error deleting cache for key ${key}:`, error);
    return false;
  }
}

/**
 * Invalidate all caches for a connection
 * Useful when schemas are updated or connection is modified
 */
export async function invalidateConnectionCache(connectionId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    
    // Find and delete all keys for this connection
    const pattern = `connection:${connectionId}:*`;
    const keys = await redis.keys(pattern);
    
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info(`[CACHE] Invalidated ${keys.length} cache keys for connection: ${connectionId}`);
    } else {
      logger.debug(`[CACHE] No cache keys found for connection: ${connectionId}`);
    }
  } catch (error: any) {
    logger.error(`[CACHE] Error invalidating cache for connection ${connectionId}:`, error);
  }
}

/**
 * Invalidate schema-specific cache (all tables in that schema)
 */
export async function invalidateSchemaCache(connectionId: string, schemaName: string): Promise<void> {
  try {
    const key = CACHE_KEYS.tables(connectionId, schemaName);
    await deleteCache(key);
    logger.info(`[CACHE] Invalidated cache for schema: ${schemaName} in connection: ${connectionId}`);
  } catch (error: any) {
    logger.error(`[CACHE] Error invalidating schema cache:`, error);
  }
}

/**
 * Check if cache is healthy (Redis connection working)
 */
export async function isCacheHealthy(): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (error) {
    return false;
  }
}

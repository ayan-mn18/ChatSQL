import { getRedisClient } from '../config/redis';
import { logger } from './logger';

// ============================================
// CACHE UTILITY
// Redis caching layer for schema and table data
// ============================================

// Cache TTL settings (in seconds)
export const CACHE_TTL = {
  // Schema & Table metadata (stable, rarely changes)
  SCHEMAS: 30 * 60,           // 30 minutes for schema list
  TABLES: 30 * 60,            // 30 minutes for tables in a schema
  TABLE_COLUMNS: 30 * 60,     // 30 minutes for table columns/structure
  ERD_RELATIONS: 30 * 60,     // 30 minutes for ERD relationships
  
  // Connection data
  CONNECTION: 10 * 60,        // 10 minutes for connection details
  CONNECTIONS_LIST: 5 * 60,   // 5 minutes for user's connections list
  
  // Table row data (changes frequently)
  TABLE_DATA: 60,             // 1 minute for actual table data
  
  // Analytics
  ANALYTICS: 60,              // 1 minute for connection analytics
  WORKSPACE_ANALYTICS: 2 * 60, // 2 minutes for workspace analytics
  
  // Permissions (moderate TTL, invalidated on change)
  VIEWER_PERMISSIONS: 5 * 60, // 5 minutes for viewer permissions
  
  // AI operations
  AI_RESULT: 5 * 60,          // 5 minutes for AI job results
  AI_CONTEXT: 60 * 60,        // 1 hour for AI schema context (compressed DDL)
};

// Cache key prefixes
export const CACHE_KEYS = {
  // Schema & Tables
  schemas: (connectionId: string) => `connection:${connectionId}:schemas`,
  tables: (connectionId: string, schemaName: string) => `connection:${connectionId}:schema:${schemaName}:tables`,
  allTables: (connectionId: string) => `connection:${connectionId}:all-tables`,
  tableColumns: (connectionId: string, schemaName: string, tableName: string) => 
    `connection:${connectionId}:schema:${schemaName}:table:${tableName}:columns`,
  erdRelations: (connectionId: string) => `connection:${connectionId}:relations`,
  
  // Connection
  connection: (connectionId: string) => `connection:${connectionId}:details`,
  connectionsList: (userId: string) => `user:${userId}:connections`,
  
  // Table data (paginated)
  tableData: (connectionId: string, schema: string, table: string, page: number, pageSize: number, sortKey: string) =>
    `connection:${connectionId}:data:${schema}:${table}:p${page}:s${pageSize}:${sortKey}`,
  
  // Analytics
  analytics: (connectionId: string) => `connection:${connectionId}:analytics`,
  workspaceAnalytics: (userId: string) => `user:${userId}:workspace:analytics`,
  
  // Viewer permission checks (for caching access/permission results)
  viewerConnectionAccess: (userId: string, connectionId: string) => 
    `viewer:${userId}:connection:${connectionId}:access`,
  viewerTablePermission: (userId: string, connectionId: string, schemaName: string, tableName: string, operation: string) => 
    `viewer:${userId}:connection:${connectionId}:schema:${schemaName}:table:${tableName}:${operation}`,
  
  // Viewer-specific (permission-filtered data)
  viewerSchemas: (userId: string, connectionId: string) => 
    `viewer:${userId}:connection:${connectionId}:schemas`,
  viewerTables: (userId: string, connectionId: string, schemaName: string) => 
    `viewer:${userId}:connection:${connectionId}:schema:${schemaName}:tables`,
  viewerPermissions: (userId: string, connectionId: string) => 
    `viewer:${userId}:connection:${connectionId}:permissions`,
  viewerAllPermissions: (userId: string) => `viewer:${userId}:all-permissions`,
  
  // AI
  aiResult: (jobId: string) => `ai_result:${jobId}`,
  aiContext: (connectionId: string) => `connection:${connectionId}:ai-context`,
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
 * Invalidate all viewer-specific caches for a user
 */
export async function invalidateViewerCache(userId: string, connectionId?: string): Promise<void> {
  try {
    const redis = getRedisClient();
    
    // Pattern to match viewer caches
    const pattern = connectionId 
      ? `viewer:${userId}:connection:${connectionId}:*`
      : `viewer:${userId}:*`;
    
    const keys = await redis.keys(pattern);
    
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info(`[CACHE] Invalidated ${keys.length} viewer cache keys for user: ${userId}`);
    }
  } catch (error: any) {
    logger.error(`[CACHE] Error invalidating viewer cache:`, error);
  }
}

/**
 * Invalidate user's connections list cache
 */
export async function invalidateConnectionsListCache(userId: string): Promise<void> {
  try {
    const key = CACHE_KEYS.connectionsList(userId);
    await deleteCache(key);
    logger.info(`[CACHE] Invalidated connections list cache for user: ${userId}`);
  } catch (error: any) {
    logger.error(`[CACHE] Error invalidating connections list cache:`, error);
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

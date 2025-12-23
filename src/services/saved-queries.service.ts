import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { logger } from '../utils/logger';

// ============================================
// SAVED QUERIES SERVICE
// Handles CRUD operations for saved SQL queries
// ============================================

export interface SavedQuery {
  id: string;
  userId: string;
  connectionId: string;
  name: string;
  description?: string;
  queryText: string;
  tags: string[];
  isShared: boolean;
  folder?: string;
  lastUsedAt?: Date;
  useCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSavedQueryParams {
  userId: string;
  connectionId: string;
  name: string;
  queryText: string;
  description?: string;
  tags?: string[];
  isShared?: boolean;
  folder?: string;
}

export interface UpdateSavedQueryParams {
  name?: string;
  description?: string;
  queryText?: string;
  tags?: string[];
  isShared?: boolean;
  folder?: string;
}

/**
 * Create a new saved query
 */
export async function createSavedQuery(params: CreateSavedQueryParams): Promise<SavedQuery | null> {
  try {
    const result = await sequelize.query<SavedQuery>(
      `INSERT INTO saved_queries (
        user_id,
        connection_id,
        name,
        description,
        query_text,
        tags,
        is_shared,
        folder
      ) VALUES (
        :userId,
        :connectionId,
        :name,
        :description,
        :queryText,
        :tags,
        :isShared,
        :folder
      ) RETURNING 
        id,
        user_id as "userId",
        connection_id as "connectionId",
        name,
        description,
        query_text as "queryText",
        tags,
        is_shared as "isShared",
        folder,
        last_used_at as "lastUsedAt",
        use_count as "useCount",
        created_at as "createdAt",
        updated_at as "updatedAt"`,
      {
        replacements: {
          userId: params.userId,
          connectionId: params.connectionId,
          name: params.name,
          description: params.description || null,
          queryText: params.queryText,
          tags: JSON.stringify(params.tags || []),
          isShared: params.isShared || false,
          folder: params.folder || null,
        },
        type: QueryTypes.SELECT,
      }
    );

    const savedQuery = result[0];
    logger.info(`[SAVED_QUERIES] Created saved query: ${savedQuery?.id}`);
    return savedQuery || null;
  } catch (error: any) {
    if (error.original?.code === '23505') {
      // Unique constraint violation
      throw new Error(`A query named "${params.name}" already exists for this connection`);
    }
    logger.error('[SAVED_QUERIES] Failed to create saved query:', error);
    throw error;
  }
}

/**
 * Get all saved queries for a connection (with ownership/sharing logic)
 */
export async function getSavedQueries(
  connectionId: string,
  userId: string,
  isViewer: boolean = false
): Promise<SavedQuery[]> {
  try {
    let query: string;
    
    if (isViewer) {
      // Viewers see only shared queries from the connection owner
      query = `
        SELECT 
          id,
          user_id as "userId",
          connection_id as "connectionId",
          name,
          description,
          query_text as "queryText",
          tags,
          is_shared as "isShared",
          folder,
          last_used_at as "lastUsedAt",
          use_count as "useCount",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM saved_queries
        WHERE connection_id = :connectionId
          AND is_shared = true
        ORDER BY last_used_at DESC NULLS LAST, created_at DESC`;
    } else {
      // Owners see all their own queries
      query = `
        SELECT 
          id,
          user_id as "userId",
          connection_id as "connectionId",
          name,
          description,
          query_text as "queryText",
          tags,
          is_shared as "isShared",
          folder,
          last_used_at as "lastUsedAt",
          use_count as "useCount",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM saved_queries
        WHERE connection_id = :connectionId
          AND user_id = :userId
        ORDER BY last_used_at DESC NULLS LAST, created_at DESC`;
    }

    const savedQueries = await sequelize.query<SavedQuery>(query, {
      replacements: { connectionId, userId },
      type: QueryTypes.SELECT,
    });

    return savedQueries;
  } catch (error) {
    logger.error('[SAVED_QUERIES] Failed to get saved queries:', error);
    return [];
  }
}

/**
 * Get a single saved query by ID
 */
export async function getSavedQueryById(
  queryId: string,
  userId: string,
  isViewer: boolean = false
): Promise<SavedQuery | null> {
  try {
    let whereClause = isViewer
      ? 'WHERE id = :queryId AND is_shared = true'
      : 'WHERE id = :queryId AND user_id = :userId';

    const result = await sequelize.query<SavedQuery>(
      `SELECT 
        id,
        user_id as "userId",
        connection_id as "connectionId",
        name,
        description,
        query_text as "queryText",
        tags,
        is_shared as "isShared",
        folder,
        last_used_at as "lastUsedAt",
        use_count as "useCount",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM saved_queries
      ${whereClause}`,
      {
        replacements: { queryId, userId },
        type: QueryTypes.SELECT,
      }
    );

    return result[0] || null;
  } catch (error) {
    logger.error('[SAVED_QUERIES] Failed to get saved query:', error);
    return null;
  }
}

/**
 * Update a saved query
 */
export async function updateSavedQuery(
  queryId: string,
  userId: string,
  updates: UpdateSavedQueryParams
): Promise<SavedQuery | null> {
  try {
    const setClauses: string[] = [];
    const replacements: Record<string, any> = { queryId, userId };

    if (updates.name !== undefined) {
      setClauses.push('name = :name');
      replacements.name = updates.name;
    }
    if (updates.description !== undefined) {
      setClauses.push('description = :description');
      replacements.description = updates.description;
    }
    if (updates.queryText !== undefined) {
      setClauses.push('query_text = :queryText');
      replacements.queryText = updates.queryText;
    }
    if (updates.tags !== undefined) {
      setClauses.push('tags = :tags');
      replacements.tags = JSON.stringify(updates.tags);
    }
    if (updates.isShared !== undefined) {
      setClauses.push('is_shared = :isShared');
      replacements.isShared = updates.isShared;
    }
    if (updates.folder !== undefined) {
      setClauses.push('folder = :folder');
      replacements.folder = updates.folder;
    }

    if (setClauses.length === 0) {
      return getSavedQueryById(queryId, userId);
    }

    const result = await sequelize.query<SavedQuery>(
      `UPDATE saved_queries 
       SET ${setClauses.join(', ')}
       WHERE id = :queryId AND user_id = :userId
       RETURNING 
        id,
        user_id as "userId",
        connection_id as "connectionId",
        name,
        description,
        query_text as "queryText",
        tags,
        is_shared as "isShared",
        folder,
        last_used_at as "lastUsedAt",
        use_count as "useCount",
        created_at as "createdAt",
        updated_at as "updatedAt"`,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    logger.info(`[SAVED_QUERIES] Updated saved query: ${queryId}`);
    return result[0] || null;
  } catch (error: any) {
    if (error.original?.code === '23505') {
      throw new Error(`A query with this name already exists`);
    }
    logger.error('[SAVED_QUERIES] Failed to update saved query:', error);
    throw error;
  }
}

/**
 * Delete a saved query
 */
export async function deleteSavedQuery(queryId: string, userId: string): Promise<boolean> {
  try {
    const result = await sequelize.query(
      `DELETE FROM saved_queries WHERE id = :queryId AND user_id = :userId`,
      {
        replacements: { queryId, userId },
        type: QueryTypes.DELETE,
      }
    );

    logger.info(`[SAVED_QUERIES] Deleted saved query: ${queryId}`);
    return true;
  } catch (error) {
    logger.error('[SAVED_QUERIES] Failed to delete saved query:', error);
    return false;
  }
}

/**
 * Increment use count and update last used timestamp
 */
export async function recordQueryUsage(queryId: string): Promise<void> {
  try {
    await sequelize.query(
      `UPDATE saved_queries 
       SET use_count = use_count + 1, 
           last_used_at = CURRENT_TIMESTAMP
       WHERE id = :queryId`,
      {
        replacements: { queryId },
        type: QueryTypes.UPDATE,
      }
    );
  } catch (error) {
    logger.error('[SAVED_QUERIES] Failed to record query usage:', error);
  }
}

/**
 * Search saved queries by name or content
 */
export async function searchSavedQueries(
  connectionId: string,
  userId: string,
  searchTerm: string,
  isViewer: boolean = false
): Promise<SavedQuery[]> {
  try {
    const searchPattern = `%${searchTerm.toLowerCase()}%`;
    
    let whereClause = isViewer
      ? `WHERE connection_id = :connectionId AND is_shared = true`
      : `WHERE connection_id = :connectionId AND user_id = :userId`;

    const result = await sequelize.query<SavedQuery>(
      `SELECT 
        id,
        user_id as "userId",
        connection_id as "connectionId",
        name,
        description,
        query_text as "queryText",
        tags,
        is_shared as "isShared",
        folder,
        last_used_at as "lastUsedAt",
        use_count as "useCount",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM saved_queries
      ${whereClause}
        AND (
          LOWER(name) LIKE :searchPattern 
          OR LOWER(description) LIKE :searchPattern
          OR LOWER(query_text) LIKE :searchPattern
        )
      ORDER BY 
        CASE WHEN LOWER(name) LIKE :searchPattern THEN 0 ELSE 1 END,
        last_used_at DESC NULLS LAST`,
      {
        replacements: { connectionId, userId, searchPattern },
        type: QueryTypes.SELECT,
      }
    );

    return result;
  } catch (error) {
    logger.error('[SAVED_QUERIES] Failed to search saved queries:', error);
    return [];
  }
}

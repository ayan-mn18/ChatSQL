import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { logger } from '../utils/logger';

// ============================================
// QUERY HISTORY SERVICE
// Handles storing and retrieving query history
// ============================================

export interface QueryHistoryEntry {
  id: string;
  userId: string;
  connectionId: string;
  queryText: string;
  rowCount?: number;
  executionTimeMs?: number;
  status: 'success' | 'error';
  errorMessage?: string;
  isAiGenerated: boolean;
  aiPrompt?: string;
  createdAt: Date;
}

export interface SaveQueryParams {
  userId: string;
  connectionId: string;
  sqlQuery: string;
  rowCount?: number;
  executionTimeMs?: number;
  success: boolean;
  errorMessage?: string;
  isAiGenerated?: boolean;
  aiPrompt?: string;
  tablesUsed?: string[];
  columnsUsed?: string[];
}

/**
 * Save a regular executed query to history
 */
export async function saveQuery(params: {
  connectionId: string;
  userId: string;
  sqlQuery: string;
  executionTimeMs?: number;
  rowCount?: number;
  success: boolean;
  errorMessage?: string;
}): Promise<string | null> {
  return saveQueryToHistory({
    userId: params.userId,
    connectionId: params.connectionId,
    sqlQuery: params.sqlQuery,
    rowCount: params.rowCount,
    executionTimeMs: params.executionTimeMs,
    success: params.success,
    errorMessage: params.errorMessage,
    isAiGenerated: false,
  });
}

/**
 * Save an AI-generated query to history
 */
export async function saveAIGeneratedQuery(params: {
  connectionId: string;
  userId: string;
  sqlQuery: string;
  aiPrompt: string;
  tablesUsed?: string[];
  columnsUsed?: string[];
}): Promise<string | null> {
  return saveQueryToHistory({
    userId: params.userId,
    connectionId: params.connectionId,
    sqlQuery: params.sqlQuery,
    success: true,
    isAiGenerated: true,
    aiPrompt: params.aiPrompt,
    tablesUsed: params.tablesUsed,
    columnsUsed: params.columnsUsed,
  });
}

/**
 * Internal function to save a query to history
 */
async function saveQueryToHistory(params: SaveQueryParams): Promise<string | null> {
  try {
    const result = await sequelize.query(
      `INSERT INTO queries (
        user_id,
        connection_id,
        query_text,
        row_count,
        execution_time_ms,
        status,
        error_message,
        is_ai_generated,
        ai_prompt,
        tables_used,
        columns_used
      ) VALUES (
        :userId,
        :connectionId,
        :queryText,
        :rowCount,
        :executionTimeMs,
        :status,
        :errorMessage,
        :isAiGenerated,
        :aiPrompt,
        :tablesUsed,
        :columnsUsed
      ) RETURNING id`,
      {
        replacements: {
          userId: params.userId,
          connectionId: params.connectionId,
          queryText: params.sqlQuery,
          rowCount: params.rowCount || null,
          executionTimeMs: params.executionTimeMs || null,
          status: params.success ? 'success' : 'error',
          errorMessage: params.errorMessage || null,
          isAiGenerated: params.isAiGenerated || false,
          aiPrompt: params.aiPrompt || null,
          tablesUsed: params.tablesUsed ? JSON.stringify(params.tablesUsed) : null,
          columnsUsed: params.columnsUsed ? JSON.stringify(params.columnsUsed) : null,
        },
        type: QueryTypes.RAW,
      }
    );

    const rows = result[0] as Array<{ id: string }>;
    const id = rows?.[0]?.id;

    logger.info(`[QUERY_HISTORY] Saved query to history`, {
      queryId: id,
      isAiGenerated: params.isAiGenerated,
    });

    return id || null;
  } catch (error) {
    logger.error('[QUERY_HISTORY] Failed to save query:', error);
    return null;
  }
}

/**
 * Get recent query history for a connection
 * Used as context for AI SQL generation
 */
export async function getRecentQueryHistory(
  connectionId: string,
  limit: number = 20
): Promise<QueryHistoryEntry[]> {
  try {
    const queries = await sequelize.query<QueryHistoryEntry>(
      `SELECT 
        id,
        user_id as "userId",
        connection_id as "connectionId",
        query_text as "queryText",
        row_count as "rowCount",
        execution_time_ms as "executionTimeMs",
        status,
        error_message as "errorMessage",
        is_ai_generated as "isAiGenerated",
        ai_prompt as "aiPrompt",
        created_at as "createdAt"
      FROM queries
      WHERE connection_id = :connectionId
        AND status = 'success'
      ORDER BY created_at DESC
      LIMIT :limit`,
      {
        replacements: { connectionId, limit },
        type: QueryTypes.SELECT,
      }
    );

    return queries;
  } catch (error) {
    logger.error('[QUERY_HISTORY] Failed to get query history:', error);
    return [];
  }
}

/**
 * Get AI-generated queries for a connection (for learning patterns)
 */
export async function getAIGeneratedQueries(
  connectionId: string,
  limit: number = 10
): Promise<Array<{ prompt: string; query: string }>> {
  try {
    const queries = await sequelize.query<{ prompt: string; query: string }>(
      `SELECT 
        ai_prompt as prompt,
        query_text as query
      FROM queries
      WHERE connection_id = :connectionId
        AND is_ai_generated = true
        AND status = 'success'
        AND ai_prompt IS NOT NULL
      ORDER BY created_at DESC
      LIMIT :limit`,
      {
        replacements: { connectionId, limit },
        type: QueryTypes.SELECT,
      }
    );

    return queries;
  } catch (error) {
    logger.error('[QUERY_HISTORY] Failed to get AI queries:', error);
    return [];
  }
}

/**
 * Format query history for AI context
 */
export function formatQueryHistoryForAI(
  queries: QueryHistoryEntry[],
  aiQueries: Array<{ prompt: string; query: string }>
): string {
  if (queries.length === 0 && aiQueries.length === 0) {
    return '';
  }

  let context = '\n### Recent Query History (for reference):\n';

  // Add recent successful queries
  if (queries.length > 0) {
    context += '\n#### Recently executed queries:\n';
    queries.slice(0, 10).forEach((q, i) => {
      context += `${i + 1}. ${q.queryText.substring(0, 200)}${q.queryText.length > 200 ? '...' : ''}\n`;
    });
  }

  // Add AI-generated query examples (prompt -> query pairs)
  if (aiQueries.length > 0) {
    context += '\n#### Previous AI-generated queries (prompt → SQL):\n';
    aiQueries.forEach((q, i) => {
      context += `${i + 1}. "${q.prompt}" → ${q.query.substring(0, 150)}${q.query.length > 150 ? '...' : ''}\n`;
    });
  }

  return context;
}

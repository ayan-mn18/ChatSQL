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
  rawResult?: unknown;
  savedQueryId?: string;
  chatMessageId?: string;
  queryType?: string;
}

let ensuredQueriesTablePromise: Promise<void> | null = null;

async function ensureQueriesTableExists(): Promise<void> {
  if (ensuredQueriesTablePromise) return ensuredQueriesTablePromise;

  ensuredQueriesTablePromise = (async () => {
    // If the table already exists, do NOT attempt any DDL.
    // (Production DB roles often cannot CREATE EXTENSION/TABLE, even if they can INSERT.)
    const tableExists = await sequelize.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'queries'
      ) as "exists"`,
      { type: QueryTypes.SELECT }
    );

    if (tableExists?.[0]?.exists) {
      return;
    }

    // Dev/bootstrap path only: try to create required objects.
    // Best-effort: if this fails due to permissions, history saving will be unavailable.
    try {
      await sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    } catch (e) {
      logger.warn('[QUERY_HISTORY] Skipping uuid-ossp extension creation (insufficient privileges?)');
    }

    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS queries (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        query_text TEXT NOT NULL,
        raw_result JSONB,
        row_count INTEGER,
        execution_time_ms INTEGER,
        status VARCHAR(50) NOT NULL DEFAULT 'success',
        error_message TEXT,
        is_saved BOOLEAN DEFAULT FALSE,
        saved_name VARCHAR(255),
        is_ai_generated BOOLEAN DEFAULT FALSE,
        ai_prompt TEXT,
        tables_used JSONB,
        columns_used JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );`
    );

    // Helpful indexes (safe with IF NOT EXISTS)
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_queries_user_id ON queries(user_id);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_queries_connection_id ON queries(connection_id);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_queries_is_saved ON queries(is_saved);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_queries_created_at ON queries(created_at DESC);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_queries_is_ai_generated ON queries(is_ai_generated) WHERE is_ai_generated = true;');

    // Optional columns used by the SQL editor schema (only add if missing)
    // saved_query_id
    await sequelize.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'queries' AND column_name = 'saved_query_id'
        ) THEN
          -- Add without FK first; later migrations can add/adjust constraints safely
          ALTER TABLE queries ADD COLUMN saved_query_id UUID;
          CREATE INDEX IF NOT EXISTS idx_queries_saved_query_id ON queries(saved_query_id);
        END IF;
      END $$;`
    );

    // chat_message_id
    await sequelize.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'queries' AND column_name = 'chat_message_id'
        ) THEN
          ALTER TABLE queries ADD COLUMN chat_message_id UUID;
          CREATE INDEX IF NOT EXISTS idx_queries_chat_message_id ON queries(chat_message_id);
        END IF;
      END $$;`
    );

    // query_type
    await sequelize.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'queries' AND column_name = 'query_type'
        ) THEN
          ALTER TABLE queries ADD COLUMN query_type VARCHAR(20) DEFAULT 'SELECT';
          CREATE INDEX IF NOT EXISTS idx_queries_query_type ON queries(query_type);
        END IF;
      END $$;`
    );
  })();

  return ensuredQueriesTablePromise;
}

async function getQueriesTableColumns(): Promise<Set<string>> {
  const cols = await sequelize.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'queries'`,
    { type: QueryTypes.SELECT }
  );
  return new Set(cols.map(c => c.column_name));
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
  rawResult?: unknown;
  savedQueryId?: string;
  chatMessageId?: string;
  queryType?: string;
  isAiGenerated?: boolean;
  aiPrompt?: string;
  tablesUsed?: string[];
  columnsUsed?: string[];
}): Promise<string | null> {
  return saveQueryToHistory({
    userId: params.userId,
    connectionId: params.connectionId,
    sqlQuery: params.sqlQuery,
    rowCount: params.rowCount,
    executionTimeMs: params.executionTimeMs,
    success: params.success,
    errorMessage: params.errorMessage,
    isAiGenerated: params.isAiGenerated ?? false,
    aiPrompt: params.aiPrompt,
    tablesUsed: params.tablesUsed,
    columnsUsed: params.columnsUsed,
    rawResult: params.rawResult,
    savedQueryId: params.savedQueryId,
    chatMessageId: params.chatMessageId,
    queryType: params.queryType,
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
  rawResult?: unknown;
  savedQueryId?: string;
  chatMessageId?: string;
  queryType?: string;
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
    rawResult: params.rawResult,
    savedQueryId: params.savedQueryId,
    chatMessageId: params.chatMessageId,
    queryType: params.queryType,
  });
}

/**
 * Internal function to save a query to history
 */
async function saveQueryToHistory(params: SaveQueryParams): Promise<string | null> {
  try {
    await ensureQueriesTableExists();
    const columns = await getQueriesTableColumns();

    const insertCols: string[] = [
      'user_id',
      'connection_id',
      'query_text',
      'row_count',
      'execution_time_ms',
      'status',
      'error_message',
      'is_ai_generated',
      'ai_prompt',
      'tables_used',
      'columns_used',
    ];

    if (columns.has('raw_result')) insertCols.push('raw_result');
    if (columns.has('saved_query_id')) insertCols.push('saved_query_id');
    if (columns.has('chat_message_id')) insertCols.push('chat_message_id');
    if (columns.has('query_type')) insertCols.push('query_type');

    const valuesSql = insertCols.map((c) => {
      switch (c) {
        case 'user_id':
          return ':userId';
        case 'connection_id':
          return ':connectionId';
        case 'query_text':
          return ':queryText';
        case 'row_count':
          return ':rowCount';
        case 'execution_time_ms':
          return ':executionTimeMs';
        case 'status':
          return ':status';
        case 'error_message':
          return ':errorMessage';
        case 'is_ai_generated':
          return ':isAiGenerated';
        case 'ai_prompt':
          return ':aiPrompt';
        case 'tables_used':
          return ':tablesUsed::jsonb';
        case 'columns_used':
          return ':columnsUsed::jsonb';
        case 'raw_result':
          return ':rawResult::jsonb';
        case 'saved_query_id':
          return ':savedQueryId';
        case 'chat_message_id':
          return ':chatMessageId';
        case 'query_type':
          return ':queryType';
        default:
          return 'NULL';
      }
    });

    const result = await sequelize.query(
      `INSERT INTO queries (${insertCols.join(', ')})
       VALUES (${valuesSql.join(', ')})
       RETURNING id`,
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
          rawResult: params.rawResult !== undefined ? JSON.stringify(params.rawResult) : null,
          savedQueryId: params.savedQueryId || null,
          chatMessageId: params.chatMessageId || null,
          queryType: params.queryType || null,
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

export async function recordChatMessageExecutionResult(params: {
  chatMessageId: string;
  success: boolean;
  rowCount?: number;
  executionTimeMs?: number;
  errorMessage?: string;
}): Promise<void> {
  try {
    await sequelize.query(
      `UPDATE chat_messages
       SET execution_result = :executionResult::jsonb,
           is_error = :isError
       WHERE id = :chatMessageId`,
      {
        replacements: {
          chatMessageId: params.chatMessageId,
          isError: !params.success,
          executionResult: JSON.stringify({
            status: params.success ? 'success' : 'error',
            rowCount: params.rowCount ?? null,
            executionTimeMs: params.executionTimeMs ?? null,
            errorMessage: params.errorMessage ?? null,
            recordedAt: new Date().toISOString(),
          }),
        },
        type: QueryTypes.UPDATE,
      }
    );
  } catch (error) {
    // Best-effort; execution result is supplemental
    logger.warn('[QUERY_HISTORY] Failed to record chat message execution result', error);
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
 * Get recent query history for a specific user (across connections)
 */
export async function getRecentQueryHistoryByUser(
  userId: string,
  limit: number = 50
): Promise<QueryHistoryEntry[]> {
  try {
    const safeLimit = Math.max(1, Math.min(200, limit));

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
      WHERE user_id = :userId
      ORDER BY created_at DESC
      LIMIT :limit`,
      {
        replacements: { userId, limit: safeLimit },
        type: QueryTypes.SELECT,
      }
    );

    return queries;
  } catch (error) {
    logger.error('[QUERY_HISTORY] Failed to get user query history:', error);
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

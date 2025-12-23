import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { logger } from '../utils/logger';

// ============================================
// CHAT SERVICE
// Handles AI chat sessions and messages per connection
// ============================================

export interface ChatSession {
  id: string;
  userId: string;
  connectionId: string;
  title: string;
  isActive: boolean;
  messageCount: number;
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  sqlGenerated?: string;
  reasoning?: {
    steps: string[];
    optimization_notes: string[];
  };
  tablesUsed?: string[];
  executionResult?: {
    success: boolean;
    rowCount?: number;
    executionTimeMs?: number;
    error?: string;
  };
  isError: boolean;
  createdAt: Date;
}

export interface CreateMessageParams {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  sqlGenerated?: string;
  reasoning?: {
    steps: string[];
    optimization_notes: string[];
  };
  tablesUsed?: string[];
  isError?: boolean;
}

/**
 * Get or create an active chat session for a user-connection pair
 */
export async function getOrCreateSession(
  userId: string,
  connectionId: string
): Promise<ChatSession> {
  try {
    // First try to find an active session
    const existingSession = await sequelize.query<ChatSession>(
      `SELECT 
        id,
        user_id as "userId",
        connection_id as "connectionId",
        title,
        is_active as "isActive",
        message_count as "messageCount",
        last_message_at as "lastMessageAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM chat_sessions
      WHERE user_id = :userId 
        AND connection_id = :connectionId 
        AND is_active = true
      ORDER BY updated_at DESC
      LIMIT 1`,
      {
        replacements: { userId, connectionId },
        type: QueryTypes.SELECT,
      }
    );

    if (existingSession[0]) {
      return existingSession[0];
    }

    // Create a new session
    const newSession = await sequelize.query<ChatSession>(
      `INSERT INTO chat_sessions (user_id, connection_id, title, is_active)
       VALUES (:userId, :connectionId, 'New Chat', true)
       RETURNING 
        id,
        user_id as "userId",
        connection_id as "connectionId",
        title,
        is_active as "isActive",
        message_count as "messageCount",
        last_message_at as "lastMessageAt",
        created_at as "createdAt",
        updated_at as "updatedAt"`,
      {
        replacements: { userId, connectionId },
        type: QueryTypes.SELECT,
      }
    );

    logger.info(`[CHAT] Created new session: ${newSession[0]?.id}`);
    return newSession[0];
  } catch (error) {
    logger.error('[CHAT] Failed to get/create session:', error);
    throw error;
  }
}

/**
 * Get all chat sessions for a connection
 */
export async function getChatSessions(
  userId: string,
  connectionId: string
): Promise<ChatSession[]> {
  try {
    const sessions = await sequelize.query<ChatSession>(
      `SELECT 
        id,
        user_id as "userId",
        connection_id as "connectionId",
        title,
        is_active as "isActive",
        message_count as "messageCount",
        last_message_at as "lastMessageAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM chat_sessions
      WHERE user_id = :userId AND connection_id = :connectionId
      ORDER BY updated_at DESC`,
      {
        replacements: { userId, connectionId },
        type: QueryTypes.SELECT,
      }
    );

    return sessions;
  } catch (error) {
    logger.error('[CHAT] Failed to get sessions:', error);
    return [];
  }
}

/**
 * Get messages for a chat session
 */
export async function getChatMessages(
  sessionId: string,
  limit: number = 100
): Promise<ChatMessage[]> {
  try {
    const messages = await sequelize.query<ChatMessage>(
      `SELECT 
        id,
        session_id as "sessionId",
        role,
        content,
        sql_generated as "sqlGenerated",
        reasoning,
        tables_used as "tablesUsed",
        execution_result as "executionResult",
        is_error as "isError",
        created_at as "createdAt"
      FROM chat_messages
      WHERE session_id = :sessionId
      ORDER BY created_at ASC
      LIMIT :limit`,
      {
        replacements: { sessionId, limit },
        type: QueryTypes.SELECT,
      }
    );

    return messages;
  } catch (error) {
    logger.error('[CHAT] Failed to get messages:', error);
    return [];
  }
}

/**
 * Add a message to a chat session
 */
export async function addChatMessage(params: CreateMessageParams): Promise<ChatMessage | null> {
  try {
    const result = await sequelize.query<ChatMessage>(
      `INSERT INTO chat_messages (
        session_id,
        role,
        content,
        sql_generated,
        reasoning,
        tables_used,
        is_error
      ) VALUES (
        :sessionId,
        :role,
        :content,
        :sqlGenerated,
        :reasoning,
        :tablesUsed,
        :isError
      ) RETURNING 
        id,
        session_id as "sessionId",
        role,
        content,
        sql_generated as "sqlGenerated",
        reasoning,
        tables_used as "tablesUsed",
        execution_result as "executionResult",
        is_error as "isError",
        created_at as "createdAt"`,
      {
        replacements: {
          sessionId: params.sessionId,
          role: params.role,
          content: params.content,
          sqlGenerated: params.sqlGenerated || null,
          reasoning: params.reasoning ? JSON.stringify(params.reasoning) : null,
          tablesUsed: params.tablesUsed ? JSON.stringify(params.tablesUsed) : null,
          isError: params.isError || false,
        },
        type: QueryTypes.SELECT,
      }
    );

    // Update session message count and last_message_at
    await sequelize.query(
      `UPDATE chat_sessions 
       SET message_count = message_count + 1,
           last_message_at = CURRENT_TIMESTAMP
       WHERE id = :sessionId`,
      {
        replacements: { sessionId: params.sessionId },
        type: QueryTypes.UPDATE,
      }
    );

    // Auto-generate title from first user message
    if (params.role === 'user') {
      await sequelize.query(
        `UPDATE chat_sessions 
         SET title = :title
         WHERE id = :sessionId AND title = 'New Chat'`,
        {
          replacements: {
            sessionId: params.sessionId,
            title: params.content.substring(0, 50) + (params.content.length > 50 ? '...' : ''),
          },
          type: QueryTypes.UPDATE,
        }
      );
    }

    return result[0] || null;
  } catch (error) {
    logger.error('[CHAT] Failed to add message:', error);
    throw error;
  }
}

/**
 * Update message with execution result
 */
export async function updateMessageExecutionResult(
  messageId: string,
  executionResult: {
    success: boolean;
    rowCount?: number;
    executionTimeMs?: number;
    error?: string;
  }
): Promise<void> {
  try {
    await sequelize.query(
      `UPDATE chat_messages 
       SET execution_result = :executionResult
       WHERE id = :messageId`,
      {
        replacements: {
          messageId,
          executionResult: JSON.stringify(executionResult),
        },
        type: QueryTypes.UPDATE,
      }
    );
  } catch (error) {
    logger.error('[CHAT] Failed to update execution result:', error);
  }
}

/**
 * Clear/archive current session and create a new one
 */
export async function clearChatSession(
  userId: string,
  connectionId: string
): Promise<ChatSession> {
  try {
    // Mark current session as inactive
    await sequelize.query(
      `UPDATE chat_sessions 
       SET is_active = false
       WHERE user_id = :userId 
         AND connection_id = :connectionId 
         AND is_active = true`,
      {
        replacements: { userId, connectionId },
        type: QueryTypes.UPDATE,
      }
    );

    // Create new session
    return await getOrCreateSession(userId, connectionId);
  } catch (error) {
    logger.error('[CHAT] Failed to clear session:', error);
    throw error;
  }
}

/**
 * Delete a chat session and all its messages
 */
export async function deleteChatSession(sessionId: string, userId: string): Promise<boolean> {
  try {
    await sequelize.query(
      `DELETE FROM chat_sessions WHERE id = :sessionId AND user_id = :userId`,
      {
        replacements: { sessionId, userId },
        type: QueryTypes.DELETE,
      }
    );

    logger.info(`[CHAT] Deleted session: ${sessionId}`);
    return true;
  } catch (error) {
    logger.error('[CHAT] Failed to delete session:', error);
    return false;
  }
}

/**
 * Get recent AI-generated SQL from chat for learning
 */
export async function getRecentChatGeneratedSQL(
  connectionId: string,
  limit: number = 10
): Promise<Array<{ prompt: string; sql: string }>> {
  try {
    const results = await sequelize.query<{ prompt: string; sql: string }>(
      `SELECT 
        um.content as prompt,
        am.sql_generated as sql
      FROM chat_messages am
      JOIN chat_messages um ON um.session_id = am.session_id 
        AND um.created_at < am.created_at
        AND um.role = 'user'
      JOIN chat_sessions cs ON cs.id = am.session_id
      WHERE cs.connection_id = :connectionId
        AND am.role = 'assistant'
        AND am.sql_generated IS NOT NULL
        AND am.is_error = false
      ORDER BY am.created_at DESC
      LIMIT :limit`,
      {
        replacements: { connectionId, limit },
        type: QueryTypes.SELECT,
      }
    );

    return results;
  } catch (error) {
    logger.error('[CHAT] Failed to get chat generated SQL:', error);
    return [];
  }
}

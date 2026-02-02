// ============================================
// STREAMING CHAT CONTROLLER
// Handles streaming AI chat with intent-based routing
// ============================================

import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { logger } from '../utils/logger';
import * as chatService from '../services/chat.service';
import { viewerHasConnectionAccess } from '../services/viewer.service';
import { streamChatResponse, StreamChatResult } from '../service/streaming-chat.service';
import { getSchemaContextString } from '../service/schema-context.service';
import { logTokenUsage } from '../service/ai.service';

/**
 * @route   POST /api/chat/:connectionId/stream
 * @desc    Stream AI response for chat message (SSE)
 * @access  Private
 */
export const handleStreamChat = async (req: Request, res: Response): Promise<void> => {
  const { connectionId } = req.params;
  const userId = req.userId!;
  const userRole = req.userRole;
  const { message, sessionId, selectedSchemas = ['public'] } = req.body;

  logger.info(`[CHAT_STREAM] Request from user ${userId} for connection ${connectionId}`);

  // Validate input
  if (!message || typeof message !== 'string' || message.trim().length < 2) {
    res.status(400).json({
      success: false,
      error: 'Message is required (min 2 characters)',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  // Verify access
  const hasAccess = await verifyAccess(userId, connectionId, userRole);
  if (!hasAccess) {
    res.status(403).json({
      success: false,
      error: 'Access denied or AI not enabled',
      code: 'FORBIDDEN',
    });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let currentSessionId = sessionId;
  let isEnded = false;

  req.on('close', () => {
    logger.info(`[CHAT_STREAM] Client disconnected for ${connectionId}`);
    isEnded = true;
  });

  try {
    // Get or create session
    if (!currentSessionId) {
      const session = await chatService.getOrCreateSession(userId, connectionId);
      currentSessionId = session.id;
    }

    // Save user message
    await chatService.addChatMessage({
      sessionId: currentSessionId,
      role: 'user',
      content: message.trim(),
    });

    // Send session info
    res.write(`data: ${JSON.stringify({ type: 'session', sessionId: currentSessionId })}\n\n`);

    // Get chat history for context
    const chatHistory = await chatService.getChatMessages(currentSessionId, 10);

    // Get schema context
    let schemaContext = '';
    try {
      schemaContext = await getSchemaContextString(connectionId, selectedSchemas);
    } catch (err) {
      logger.warn(`[CHAT_STREAM] Failed to get schema context: ${err}`);
    }

    // Stream the response
    const result = await streamChatResponse(message.trim(), res, {
      connectionId,
      userId,
      sessionId: currentSessionId,
      selectedSchemas,
      schemaContext,
      chatHistory,
    });

    if (isEnded) return;

    // Save assistant message
    const assistantMessage = await chatService.addChatMessage({
      sessionId: currentSessionId,
      role: 'assistant',
      content: result.content,
      sqlGenerated: result.sql,
      tablesUsed: result.tablesUsed,
    });

    // Log token usage if available
    if (result.tokenUsage) {
      await logTokenUsage(
        userId,
        connectionId,
        result.intent === 'sql_generation' ? 'generate_sql' : 'chat',
        result.tokenUsage,
        'gemini-2.0-flash', // Will be updated to use actual model
        message.substring(0, 200),
        result.content.substring(0, 200)
      );
    }

    // Send completion
    res.write(`data: ${JSON.stringify({
      type: 'done',
      messageId: assistantMessage?.id,
      intent: result.intent,
      sql: result.sql,
      tablesUsed: result.tablesUsed,
    })}\n\n`);

    res.end();
  } catch (error: any) {
    logger.error('[CHAT_STREAM] Failed:', error);
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message || 'Chat failed',
        code: 'SERVER_ERROR',
      });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  }
};

/**
 * Verify user has access to connection and AI features
 */
async function verifyAccess(
  userId: string,
  connectionId: string,
  userRole?: string
): Promise<boolean> {
  if (userRole === 'viewer') {
    const hasConnectionAccess = await viewerHasConnectionAccess(userId, connectionId);
    if (!hasConnectionAccess) return false;

    const [permission] = await sequelize.query<{ can_use_ai: boolean }>(
      `SELECT can_use_ai FROM viewer_permissions 
       WHERE viewer_user_id = :userId AND connection_id = :connectionId
       ORDER BY can_use_ai DESC LIMIT 1`,
      { replacements: { userId, connectionId }, type: QueryTypes.SELECT }
    );
    
    return permission?.can_use_ai === true;
  }

  const [connection] = await sequelize.query<{ id: string }>(
    `SELECT id FROM connections WHERE id = :connectionId AND user_id = :userId`,
    { replacements: { connectionId, userId }, type: QueryTypes.SELECT }
  );
  
  return !!connection;
}

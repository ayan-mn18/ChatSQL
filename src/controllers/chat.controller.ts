import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { generateGeminiText } from '../service/gemini.client';
import * as chatService from '../services/chat.service';
import { viewerHasConnectionAccess } from '../services/viewer.service';
import { generateSqlFromPrompt } from '../service/ai.service';
import { saveAIGeneratedQuery } from '../service/query-history.service';

// ============================================
// CHAT CONTROLLER
// Handles AI chat sessions and streaming responses
// ============================================

/**
 * @route   GET /api/chat/:connectionId/session
 * @desc    Get or create active chat session for connection
 * @access  Private
 */
export const getOrCreateSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole;

    // Verify access
    let hasAccess = false;
    if (userRole === 'viewer') {
      hasAccess = await viewerHasConnectionAccess(userId, connectionId);
      // Check AI permission
      if (hasAccess) {
        const [permission] = await sequelize.query<{ can_use_ai: boolean }>(
          `SELECT can_use_ai FROM viewer_permissions 
           WHERE viewer_user_id = :userId AND connection_id = :connectionId
           ORDER BY can_use_ai DESC LIMIT 1`,
          { replacements: { userId, connectionId }, type: QueryTypes.SELECT }
        );
        hasAccess = permission?.can_use_ai === true;
      }
    } else {
      const [connection] = await sequelize.query<{ id: string }>(
        `SELECT id FROM connections WHERE id = :connectionId AND user_id = :userId`,
        { replacements: { connectionId, userId }, type: QueryTypes.SELECT }
      );
      hasAccess = !!connection;
    }

    if (!hasAccess) {
      res.status(403).json({
        success: false,
        error: 'Access denied or AI not enabled',
        code: 'FORBIDDEN',
      });
      return;
    }

    const session = await chatService.getOrCreateSession(userId, connectionId);
    const messages = await chatService.getChatMessages(session.id);

    res.json({
      success: true,
      data: {
        session,
        messages,
      },
    });
  } catch (error: any) {
    logger.error('[CHAT] Get session failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get chat session',
      code: 'SERVER_ERROR',
    });
  }
};

/**
 * @route   GET /api/chat/:connectionId/sessions
 * @desc    Get all chat sessions for a connection
 * @access  Private
 */
export const getChatSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId!;

    const sessions = await chatService.getChatSessions(userId, connectionId);

    res.json({
      success: true,
      data: sessions,
    });
  } catch (error: any) {
    logger.error('[CHAT] Get sessions failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get chat sessions',
      code: 'SERVER_ERROR',
    });
  }
};

/**
 * @route   GET /api/chat/:connectionId/session/:sessionId/messages
 * @desc    Get messages for a chat session
 * @access  Private
 */
export const getSessionMessages = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;

    const messages = await chatService.getChatMessages(sessionId);

    res.json({
      success: true,
      data: messages,
    });
  } catch (error: any) {
    logger.error('[CHAT] Get messages failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get messages',
      code: 'SERVER_ERROR',
    });
  }
};

/**
 * @route   POST /api/chat/:connectionId/stream
 * @desc    Stream AI response for chat message (SSE)
 * @access  Private
 */
export const streamChatResponse = async (req: Request, res: Response): Promise<void> => {
  const { connectionId } = req.params;
  const userId = req.userId!;
  const userRole = req.userRole;
  const { message, sessionId, selectedSchemas = [] } = req.body;

  logger.info(`[CHAT] Stream request from user ${userId} for connection ${connectionId}`);

  // Validate input
  if (!message || typeof message !== 'string' || message.trim().length < 2) {
    res.status(400).json({
      success: false,
      error: 'Message is required',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  // Verify access
  let hasAccess = false;
  if (userRole === 'viewer') {
    hasAccess = await viewerHasConnectionAccess(userId, connectionId);
    if (hasAccess) {
      const [permission] = await sequelize.query<{ can_use_ai: boolean }>(
        `SELECT can_use_ai FROM viewer_permissions 
         WHERE viewer_user_id = :userId AND connection_id = :connectionId
         ORDER BY can_use_ai DESC LIMIT 1`,
        { replacements: { userId, connectionId }, type: QueryTypes.SELECT }
      );
      hasAccess = permission?.can_use_ai === true;
    }
  } else {
    const [connection] = await sequelize.query<{ id: string }>(
      `SELECT id FROM connections WHERE id = :connectionId AND user_id = :userId`,
      { replacements: { connectionId, userId }, type: QueryTypes.SELECT }
    );
    hasAccess = !!connection;
  }

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

  const cleanup = () => {
    isEnded = true;
  };

  req.on('close', () => {
    logger.info(`[CHAT] Client disconnected for connection ${connectionId}`);
    cleanup();
  });

  try {
    // Get or create session
    if (!currentSessionId) {
      const session = await chatService.getOrCreateSession(userId, connectionId);
      currentSessionId = session.id;
    }

    // Save user message
    const userMessage = await chatService.addChatMessage({
      sessionId: currentSessionId,
      role: 'user',
      content: message.trim(),
    });

    // Send session info
    res.write(`data: ${JSON.stringify({ type: 'session', sessionId: currentSessionId })}\n\n`);

    // Get recent chat history for context (last 10 messages, excluding the current one)
    const chatHistory = await chatService.getChatMessages(currentSessionId, 10);

    // Check if the message is requesting SQL generation
    const sqlKeywords = [
      'query', 'select', 'sql', 'get', 'fetch', 'show', 'find', 'list', 'retrieve',
      'display', 'give me', 'write', 'generate', 'create query', 'database'
    ];
    const shouldGenerateSQL = sqlKeywords.some(keyword => 
      message.toLowerCase().includes(keyword)
    );
    
    logger.info(`[CHAT] Processing message (SQL mode: ${shouldGenerateSQL}): "${message.substring(0, 50)}..."`);
    
    let sqlResult;
    let fullContent = '';
    
    try {
      if (shouldGenerateSQL) {
        // Use existing AI service for SQL generation
        sqlResult = await generateSqlFromPrompt(connectionId, message.trim(), selectedSchemas, {
          chatHistory,
        });
        
        // Format the response as markdown
        fullContent = formatAIResponse(sqlResult);
      } else {
        // Normal conversational response with chat history context
        // Build conversation history for context
        const conversationContext = chatHistory
          .slice(0, -1) // Exclude the current message
          .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
          .join('\n');
        
        const conversationPrompt = `You are a helpful database assistant having a conversation with a user.

Previous conversation:
${conversationContext}

Current user message: "${message}"

Respond naturally and conversationally. Remember the context of previous messages. If they're asking about SQL or database queries, let them know you can help generate SQL queries. Keep your response concise and friendly.`;
        
        fullContent = await generateGeminiText(conversationPrompt);
      }
      
      // Stream the response in chunks to simulate typing
      const chunks = splitIntoChunks(fullContent, 50);
      for (const chunk of chunks) {
        if (isEnded) break;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
        await sleep(20); // Small delay for typing effect
      }

      // Save assistant message
      const assistantMessage = await chatService.addChatMessage({
        sessionId: currentSessionId,
        role: 'assistant',
        content: fullContent,
        sqlGenerated: sqlResult?.query,
        reasoning: sqlResult?.reasoning,
        tablesUsed: sqlResult?.tables_used,
      });

      // Save to query history for AI learning (only if SQL was generated)
      if (sqlResult) {
        await saveAIGeneratedQuery({
          connectionId,
          userId,
          sqlQuery: sqlResult.query,
          aiPrompt: message.trim(),
          tablesUsed: sqlResult.tables_used,
          columnsUsed: sqlResult.columns_used,
        });
      }

      // Send completion with metadata
      res.write(`data: ${JSON.stringify({
        type: 'done',
        messageId: assistantMessage?.id,
        sql: sqlResult?.query,
        reasoning: sqlResult?.reasoning,
        tablesUsed: sqlResult?.tables_used,
      })}\n\n`);

    } catch (aiError: any) {
      logger.error('[CHAT] AI generation failed:', aiError);
      
      const errorContent = `I apologize, but I encountered an error while generating the SQL query:\n\n**Error:** ${aiError.message}\n\nPlease try rephrasing your request or check if the database schema has the tables you're looking for.`;
      
      res.write(`data: ${JSON.stringify({ type: 'content', content: errorContent })}\n\n`);
      
      await chatService.addChatMessage({
        sessionId: currentSessionId,
        role: 'assistant',
        content: errorContent,
        isError: true,
      });

      res.write(`data: ${JSON.stringify({ type: 'error', error: aiError.message })}\n\n`);
    }

    res.end();
  } catch (error: any) {
    logger.error('[CHAT] Stream failed:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message || 'Chat failed',
        code: 'SERVER_ERROR',
      });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  }
};

/**
 * @route   POST /api/chat/:connectionId/clear
 * @desc    Clear current chat session and start new one
 * @access  Private
 */
export const clearChatSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId!;

    const newSession = await chatService.clearChatSession(userId, connectionId);

    res.json({
      success: true,
      data: {
        session: newSession,
        messages: [],
      },
    });
  } catch (error: any) {
    logger.error('[CHAT] Clear session failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to clear session',
      code: 'SERVER_ERROR',
    });
  }
};

/**
 * @route   DELETE /api/chat/:connectionId/session/:sessionId
 * @desc    Delete a chat session
 * @access  Private
 */
export const deleteChatSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const userId = req.userId!;

    const deleted = await chatService.deleteChatSession(sessionId, userId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'Session not found',
        code: 'NOT_FOUND',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Session deleted',
    });
  } catch (error: any) {
    logger.error('[CHAT] Delete session failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete session',
      code: 'SERVER_ERROR',
    });
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatAIResponse(result: {
  query: string;
  reasoning: { steps: string[]; optimization_notes: string[] };
  tables_used: string[];
  columns_used: string[];
  desc: string;
}): string {
  let content = '';
  
  // Description
  if (result.desc) {
    content += `${result.desc}\n\n`;
  }
  
  // SQL Query
  content += `**Generated SQL:**\n\`\`\`sql\n${result.query}\n\`\`\`\n\n`;
  
  // Reasoning steps
  if (result.reasoning?.steps?.length > 0) {
    content += `**Reasoning:**\n`;
    result.reasoning.steps.forEach((step, i) => {
      content += `${i + 1}. ${step}\n`;
    });
    content += '\n';
  }
  
  // Optimization notes
  if (result.reasoning?.optimization_notes?.length > 0) {
    content += `**Optimization Notes:**\n`;
    result.reasoning.optimization_notes.forEach((note) => {
      content += `• ${note}\n`;
    });
    content += '\n';
  }
  
  // Tables used
  if (result.tables_used?.length > 0) {
    content += `**Tables Used:** ${result.tables_used.join(', ')}\n`;
  }
  
  return content;
}

function splitIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

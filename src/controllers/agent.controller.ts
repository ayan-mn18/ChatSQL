// ============================================
// AGENT CONTROLLER
// SSE endpoint for starting agent sessions
// REST endpoints for approve, reject, feedback, stop
// ============================================

import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { logger } from '../utils/logger';
import * as chatService from '../services/chat.service';
import { viewerHasConnectionAccess } from '../services/viewer.service';
import { getSchemaContextString } from '../service/schema-context.service';
import {
  startAgentSession,
  getAgentSession,
  approveStep,
  rejectStep,
  provideExecutionResult,
  stopAgentSession,
  attachSSE,
} from '../service/agent';
import type { AgentStartRequest, AgentApproveRequest, AgentRejectRequest, AgentFeedbackRequest } from '../service/agent';

/**
 * @route   POST /api/chat/:connectionId/agent/start
 * @desc    Start an agent session (SSE — long-lived connection)
 * @access  Private
 */
export const handleAgentStart = async (req: Request, res: Response): Promise<void> => {
  const { connectionId } = req.params;
  const userId = req.userId!;
  const userRole = req.userRole;
  const { message, sessionId, selectedSchemas = ['public'] } = req.body as AgentStartRequest;

  logger.info(`[AGENT_CTRL] Start request from user ${userId} for connection ${connectionId}`);

  // Validate
  if (!message || typeof message !== 'string' || message.trim().length < 2) {
    res.status(400).json({ success: false, error: 'Message is required', code: 'VALIDATION_ERROR' });
    return;
  }

  // Verify access
  const hasAccess = await verifyAccess(userId, connectionId, userRole);
  if (!hasAccess) {
    res.status(403).json({ success: false, error: 'Access denied', code: 'FORBIDDEN' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    // Get or create chat session
    let currentSessionId = sessionId;
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

    // Get chat history
    const chatHistory = await chatService.getChatMessages(currentSessionId, 10);

    // Get schema context
    let schemaContext = '';
    try {
      schemaContext = await getSchemaContextString(connectionId, selectedSchemas);
    } catch (err) {
      logger.warn(`[AGENT_CTRL] Failed to get schema context: ${err}`);
    }

    // Start the agent
    const agentSession = await startAgentSession(res, {
      connectionId,
      userId,
      sessionId: currentSessionId,
      message: message.trim(),
      schemaContext,
      selectedSchemas,
      chatHistory,
    });

    // Send agent session ID so frontend can interact with it
    res.write(`data: ${JSON.stringify({ type: 'agent_session', agentSessionId: agentSession.id })}\n\n`);

    // Handle client disconnect
    req.on('close', () => {
      logger.info(`[AGENT_CTRL] Client disconnected for agent ${agentSession.id}`);
      // Don't stop the session — client might reconnect
    });

  } catch (error: any) {
    logger.error('[AGENT_CTRL] Failed to start agent:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message, code: 'SERVER_ERROR' });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'agent_error', error: error.message, recoverable: false })}\n\n`);
      res.end();
    }
  }
};

/**
 * @route   POST /api/chat/:connectionId/agent/:agentSessionId/approve
 * @desc    Approve the current proposed query
 * @access  Private
 */
export const handleAgentApprove = async (req: Request, res: Response): Promise<void> => {
  const { agentSessionId } = req.params;
  const { modifiedSql } = req.body as AgentApproveRequest;

  logger.info(`[AGENT_CTRL] Approve for agent ${agentSessionId}`);

  const session = getAgentSession(agentSessionId);
  if (!session) {
    res.status(404).json({ success: false, error: 'Agent session not found', code: 'NOT_FOUND' });
    return;
  }

  const success = approveStep(agentSessionId, modifiedSql);
  res.json({ success });
};

/**
 * @route   POST /api/chat/:connectionId/agent/:agentSessionId/reject
 * @desc    Reject the current proposed query
 * @access  Private
 */
export const handleAgentReject = async (req: Request, res: Response): Promise<void> => {
  const { agentSessionId } = req.params;
  const { reason } = req.body as AgentRejectRequest;

  logger.info(`[AGENT_CTRL] Reject for agent ${agentSessionId}`);

  const session = getAgentSession(agentSessionId);
  if (!session) {
    res.status(404).json({ success: false, error: 'Agent session not found', code: 'NOT_FOUND' });
    return;
  }

  const success = rejectStep(agentSessionId, reason);
  res.json({ success });
};

/**
 * @route   POST /api/chat/:connectionId/agent/:agentSessionId/result
 * @desc    Provide execution results after running query on frontend
 * @access  Private
 */
export const handleAgentResult = async (req: Request, res: Response): Promise<void> => {
  const { agentSessionId } = req.params;
  const { result } = req.body as AgentFeedbackRequest;

  logger.info(`[AGENT_CTRL] Result for agent ${agentSessionId}: success=${result?.success}`);

  const session = getAgentSession(agentSessionId);
  if (!session) {
    res.status(404).json({ success: false, error: 'Agent session not found', code: 'NOT_FOUND' });
    return;
  }

  if (!result) {
    res.status(400).json({ success: false, error: 'Result is required', code: 'VALIDATION_ERROR' });
    return;
  }

  const success = provideExecutionResult(agentSessionId, result);
  res.json({ success });
};

/**
 * @route   POST /api/chat/:connectionId/agent/:agentSessionId/stop
 * @desc    Stop the agent session
 * @access  Private
 */
export const handleAgentStop = async (req: Request, res: Response): Promise<void> => {
  const { agentSessionId } = req.params;

  logger.info(`[AGENT_CTRL] Stop for agent ${agentSessionId}`);

  const success = stopAgentSession(agentSessionId);
  res.json({ success });
};

// ============================================
// HELPERS
// ============================================

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

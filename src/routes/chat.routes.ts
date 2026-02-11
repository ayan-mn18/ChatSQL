import { Router } from 'express';
import { authenticate, heavyRateLimit } from '../middleware';
import * as chatController from '../controllers/chat.controller';
import { handleStreamChat } from '../controllers/streaming-chat.controller';
import {
  handleAgentStart,
  handleAgentApprove,
  handleAgentReject,
  handleAgentResult,
  handleAgentStop,
} from '../controllers/agent.controller';

const router = Router();

// ============================================
// CHAT ROUTES
// AI chat sessions per connection
// All routes require authentication
// ============================================

/**
 * @route   GET /api/chat/:connectionId/session
 * @desc    Get or create active chat session for connection
 * @access  Private
 */
router.get(
  '/:connectionId/session',
  authenticate,
  chatController.getOrCreateSession
);

/**
 * @route   GET /api/chat/:connectionId/sessions
 * @desc    Get all chat sessions for a connection
 * @access  Private
 */
router.get(
  '/:connectionId/sessions',
  authenticate,
  chatController.getChatSessions
);

/**
 * @route   GET /api/chat/:connectionId/session/:sessionId/messages
 * @desc    Get messages for a specific session
 * @access  Private
 */
router.get(
  '/:connectionId/session/:sessionId/messages',
  authenticate,
  chatController.getSessionMessages
);

/**
 * @route   POST /api/chat/:connectionId/stream
 * @desc    Stream AI response for chat message (SSE)
 * @access  Private
 * @body    { message: string, sessionId?: string, selectedSchemas?: string[] }
 */
router.post(
  '/:connectionId/stream',
  authenticate,
  heavyRateLimit,
  handleStreamChat
);

/**
 * @route   POST /api/chat/:connectionId/clear
 * @desc    Clear current chat session and start new one
 * @access  Private
 */
router.post(
  '/:connectionId/clear',
  authenticate,
  chatController.clearChatSession
);

/**
 * @route   DELETE /api/chat/:connectionId/session/:sessionId
 * @desc    Delete a chat session
 * @access  Private
 */
router.delete(
  '/:connectionId/session/:sessionId',
  authenticate,
  chatController.deleteChatSession
);

// ============================================
// AGENT MODE ROUTES
// ============================================

/**
 * @route   POST /api/chat/:connectionId/agent/start
 * @desc    Start an agent session (SSE stream)
 * @access  Private
 * @body    { message: string, sessionId?: string, selectedSchemas?: string[] }
 */
router.post(
  '/:connectionId/agent/start',
  authenticate,
  heavyRateLimit,
  handleAgentStart
);

/**
 * @route   POST /api/chat/:connectionId/agent/:agentSessionId/approve
 * @desc    Approve the agent's proposed query
 * @access  Private
 * @body    { modifiedSql?: string }
 */
router.post(
  '/:connectionId/agent/:agentSessionId/approve',
  authenticate,
  handleAgentApprove
);

/**
 * @route   POST /api/chat/:connectionId/agent/:agentSessionId/reject
 * @desc    Reject the agent's proposed query
 * @access  Private
 * @body    { reason?: string }
 */
router.post(
  '/:connectionId/agent/:agentSessionId/reject',
  authenticate,
  handleAgentReject
);

/**
 * @route   POST /api/chat/:connectionId/agent/:agentSessionId/result
 * @desc    Provide query execution results to the agent
 * @access  Private
 * @body    { result: AgentExecutionResult }
 */
router.post(
  '/:connectionId/agent/:agentSessionId/result',
  authenticate,
  handleAgentResult
);

/**
 * @route   POST /api/chat/:connectionId/agent/:agentSessionId/stop
 * @desc    Stop the agent session
 * @access  Private
 */
router.post(
  '/:connectionId/agent/:agentSessionId/stop',
  authenticate,
  handleAgentStop
);

export default router;

import { Router } from 'express';
import { authenticate, heavyRateLimit } from '../middleware';
import * as chatController from '../controllers/chat.controller';

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
  chatController.streamChatResponse
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

export default router;

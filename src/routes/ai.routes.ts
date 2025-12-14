import { Router } from 'express';
import { authenticate, heavyRateLimit } from '../middleware';
import * as aiController from '../controllers/ai.controller';

const router = Router();

// ============================================
// AI ROUTES
// All routes require authentication
// ============================================

/**
 * @route   POST /api/ai/:connectionId/generate
 * @desc    Generate SQL from natural language prompt
 * @access  Private
 * @body    { prompt: string, selectedSchemas?: string[] }
 */
router.post('/:connectionId/generate', authenticate, heavyRateLimit, aiController.generateSql);

/**
 * @route   GET /api/ai/result/:jobId
 * @desc    Get AI job result (polling endpoint)
 * @access  Private
 */
router.get('/result/:jobId', authenticate, aiController.getJobResult);

/**
 * @route   GET /api/ai/stream/:jobId
 * @desc    SSE stream for AI job result (real-time updates)
 * @access  Private
 */
router.get('/stream/:jobId', authenticate, aiController.streamJobResult);

/**
 * @route   POST /api/ai/:connectionId/explain
 * @desc    Explain a SQL query in plain English
 * @access  Private
 * @body    { sql: string }
 */
router.post('/:connectionId/explain', authenticate, heavyRateLimit, aiController.explainQuery);

/**
 * @route   GET /api/ai/:connectionId/status
 * @desc    Get user's pending AI jobs for a connection
 * @access  Private
 */
router.get('/:connectionId/status', authenticate, aiController.getJobStatus);

export default router;

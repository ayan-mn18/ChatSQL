import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import {
  addGenerateSqlJob,
  addExplainQueryJob,
  getAIJobResult,
  getUserPendingJobs,
  hasUserExceededPendingLimit,
  AIJobResult,
} from '../queues/ai-operations.queue';

// ============================================
// AI CONTROLLER
// Handles AI-powered SQL generation and query operations
// ============================================

/**
 * @route   POST /api/ai/:connectionId/generate
 * @desc    Generate SQL from natural language prompt
 * @access  Private
 */
export const generateSql = async (req: Request, res: Response): Promise<void> => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId!;
    const { prompt, selectedSchemas = [] } = req.body;

    logger.info(`[AI] Generate SQL request from user ${userId}`);

    // Validate input
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      res.status(400).json({
        success: false,
        error: 'Prompt is required and must be at least 3 characters',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    // 1. Verify connection exists and belongs to user
    const [connectionResult] = await sequelize.query<{ id: string }>(
      `SELECT id FROM connections WHERE id = :connectionId AND user_id = :userId`,
      {
        replacements: { connectionId, userId },
        type: QueryTypes.SELECT,
      }
    );

    if (!connectionResult) {
      res.status(404).json({
        success: false,
        error: 'Connection not found',
        code: 'CONNECTION_NOT_FOUND',
      });
      return;
    }

    // 2. Check if user has too many pending jobs
    const exceededLimit = await hasUserExceededPendingLimit(userId, 5);
    if (exceededLimit) {
      res.status(429).json({
        success: false,
        error: 'Too many pending AI requests. Please wait for current requests to complete.',
        code: 'RATE_LIMIT_EXCEEDED',
      });
      return;
    }

    // 3. Add job to queue
    const job = await addGenerateSqlJob({
      connectionId,
      userId,
      prompt: prompt.trim(),
      selectedSchemas: Array.isArray(selectedSchemas) ? selectedSchemas : [],
    });

    logger.info(`[AI] Created generate SQL job ${job.id} for user ${userId}`);

    res.status(202).json({
      success: true,
      message: 'SQL generation started',
      jobId: job.id,
    });
  } catch (error: any) {
    logger.error('[AI] Generate SQL failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start SQL generation',
      code: 'AI_ERROR',
    });
  }
};

/**
 * @route   GET /api/ai/result/:jobId
 * @desc    Get AI job result (polling endpoint)
 * @access  Private
 */
export const getJobResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      res.status(400).json({
        success: false,
        error: 'Job ID is required',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const result = await getAIJobResult(jobId);

    if (!result) {
      // Job might still be processing
      res.status(200).json({
        success: true,
        status: 'pending',
        message: 'Job is still processing',
      });
      return;
    }

    res.json({
      success: true,
      status: result.success ? 'completed' : 'failed',
      result,
    });
  } catch (error: any) {
    logger.error('[AI] Get job result failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get job result',
      code: 'AI_ERROR',
    });
  }
};

/**
 * @route   POST /api/ai/:connectionId/explain
 * @desc    Explain a SQL query in plain English
 * @access  Private
 */
export const explainQuery = async (req: Request, res: Response): Promise<void> => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId!;
    const { sql } = req.body;

    logger.info(`[AI] Explain query request from user ${userId}`);

    // Validate input
    if (!sql || typeof sql !== 'string' || sql.trim().length < 5) {
      res.status(400).json({
        success: false,
        error: 'SQL query is required',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    // 1. Verify connection exists and belongs to user
    const [connectionResult] = await sequelize.query<{ id: string }>(
      `SELECT id FROM connections WHERE id = :connectionId AND user_id = :userId`,
      {
        replacements: { connectionId, userId },
        type: QueryTypes.SELECT,
      }
    );

    if (!connectionResult) {
      res.status(404).json({
        success: false,
        error: 'Connection not found',
        code: 'CONNECTION_NOT_FOUND',
      });
      return;
    }

    // 2. Add job to queue
    const job = await addExplainQueryJob({
      connectionId,
      userId,
      sql: sql.trim(),
    });

    logger.info(`[AI] Created explain query job ${job.id} for user ${userId}`);

    res.status(202).json({
      success: true,
      message: 'Query explanation started',
      jobId: job.id,
    });
  } catch (error: any) {
    logger.error('[AI] Explain query failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start query explanation',
      code: 'AI_ERROR',
    });
  }
};

/**
 * @route   GET /api/ai/:connectionId/status
 * @desc    Get user's pending AI jobs for a connection
 * @access  Private
 */
export const getJobStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId!;

    // Get pending jobs for this user
    const pendingJobs = await getUserPendingJobs(userId);
    
    // Filter by connection if specified
    const filteredJobs = connectionId 
      ? pendingJobs.filter(job => job.data.connectionId === connectionId)
      : pendingJobs;

    const jobSummaries = filteredJobs.map(job => ({
      jobId: job.id,
      type: job.data.type,
      createdAt: job.timestamp,
      state: job.processedOn ? 'active' : 'waiting',
    }));

    res.json({
      success: true,
      pendingCount: jobSummaries.length,
      jobs: jobSummaries,
    });
  } catch (error: any) {
    logger.error('[AI] Get job status failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get job status',
      code: 'AI_ERROR',
    });
  }
};

/**
 * @route   GET /api/ai/stream/:jobId
 * @desc    SSE stream for AI job result (real-time updates via Redis Pub/Sub)
 * @access  Private
 */
export const streamJobResult = async (req: Request, res: Response): Promise<void> => {
  const { jobId } = req.params;
  const userId = req.userId!;

  logger.info(`[AI] SSE stream started for job ${jobId} by user ${userId}`);

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', jobId })}\n\n`);

  // Check if result already exists
  const existingResult = await getAIJobResult(jobId);
  if (existingResult) {
    logger.info(`[AI] SSE: Job ${jobId} already completed, sending result`);
    res.write(`data: ${JSON.stringify({ type: 'completed', result: existingResult })}\n\n`);
    res.end();
    return;
  }

  // Create a subscriber Redis connection for Pub/Sub
  const Redis = require('ioredis');
  const subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  
  const channel = `ai_job:${userId}`;
  let isEnded = false;
  let pollInterval: NodeJS.Timeout | null = null;
  let timeout: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (!isEnded) {
      isEnded = true;
      if (pollInterval) clearInterval(pollInterval);
      if (timeout) clearTimeout(timeout);
      try {
        subscriber.unsubscribe(channel);
        subscriber.quit();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  };

  // Handle client disconnect
  req.on('close', () => {
    logger.info(`[AI] SSE: Client disconnected for job ${jobId}`);
    cleanup();
  });

  // Timeout after 60 seconds
  timeout = setTimeout(() => {
    logger.info(`[AI] SSE: Timeout for job ${jobId}`);
    if (!isEnded) {
      res.write(`data: ${JSON.stringify({ type: 'timeout', message: 'Job timed out' })}\n\n`);
      res.end();
      cleanup();
    }
  }, 60000);

  // Subscribe to channel and listen for messages (ioredis pattern)
  subscriber.subscribe(channel, (err: Error | null) => {
    if (err) {
      logger.error('[AI] SSE: Subscribe error:', err);
    } else {
      logger.info(`[AI] SSE: Subscribed to channel ${channel}`);
    }
  });

  subscriber.on('message', (ch: string, message: string) => {
    if (ch === channel && !isEnded) {
      try {
        const data = JSON.parse(message);
        
        // Check if this message is for our job
        if (data.jobId === jobId) {
          logger.info(`[AI] SSE: Received result for job ${jobId}`);
          res.write(`data: ${JSON.stringify({ type: 'completed', result: data })}\n\n`);
          res.end();
          cleanup();
        }
      } catch (e) {
        logger.error('[AI] SSE: Error parsing message:', e);
      }
    }
  });

  // Also poll periodically as backup (in case we missed the pub/sub message)
  pollInterval = setInterval(async () => {
    if (isEnded) return;

    const result = await getAIJobResult(jobId);
    if (result) {
      logger.info(`[AI] SSE: Poll found result for job ${jobId}`);
      res.write(`data: ${JSON.stringify({ type: 'completed', result })}\n\n`);
      res.end();
      cleanup();
    }
  }, 2000); // Poll every 2 seconds as backup
};

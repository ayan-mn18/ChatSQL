import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { getRedisClient, getRedisSubscriber } from '../config/redis';
import { 
  getSchemaSyncQueueStats, 
  getAIOperationsQueueStats,
  getAIJobResult,
  getJobsForConnection,
} from '../queues';
import { logger } from '../utils/logger';

const router = Router();

// ============================================
// JOB PROGRESS & STATUS ROUTES
// SSE endpoint for real-time job updates
// ============================================

/**
 * @route   GET /api/jobs/progress
 * @desc    Server-Sent Events endpoint for real-time job progress
 * @access  Private
 */
router.get('/progress', authenticate, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();
  
  logger.info(`[JOBS_SSE] Client connected: ${userId}`);
  
  // Send initial connection message
  res.write(`event: connected\ndata: ${JSON.stringify({ userId, timestamp: new Date().toISOString() })}\n\n`);
  
  // Create dedicated subscriber for this connection
  const subscriber = getRedisSubscriber().duplicate();
  
  const channels = [
    `job:progress:${userId}`,
    `job:complete:${userId}`,
    `job:error:${userId}`,
    `ai:result:${userId}`,
  ];
  
  // Subscribe to user's channels
  await subscriber.subscribe(...channels);
  
  // Handle messages
  subscriber.on('message', (channel: string, message: string) => {
    try {
      let eventType = 'message';
      
      if (channel.includes('progress')) {
        eventType = 'progress';
      } else if (channel.includes('complete')) {
        eventType = 'complete';
      } else if (channel.includes('error')) {
        eventType = 'error';
      } else if (channel.includes('ai:result')) {
        eventType = 'ai-result';
      }
      
      res.write(`event: ${eventType}\ndata: ${message}\n\n`);
    } catch (error) {
      logger.error('[JOBS_SSE] Error sending message:', error);
    }
  });
  
  // Keep-alive ping every 30 seconds
  const keepAlive = setInterval(() => {
    try {
      res.write(`:ping ${Date.now()}\n\n`);
    } catch {
      // Connection closed
      clearInterval(keepAlive);
    }
  }, 30000);
  
  // Cleanup on disconnect
  req.on('close', () => {
    logger.info(`[JOBS_SSE] Client disconnected: ${userId}`);
    clearInterval(keepAlive);
    subscriber.unsubscribe(...channels);
    subscriber.disconnect();
  });
});

/**
 * @route   GET /api/jobs/status/:jobId
 * @desc    Get status of a specific job
 * @access  Private
 */
router.get('/status/:jobId', authenticate, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    
    // Check AI result cache first
    const aiResult = await getAIJobResult(jobId);
    if (aiResult) {
      res.json({
        success: true,
        data: aiResult,
      });
      return;
    }
    
    // Check job progress in Redis
    const redis = getRedisClient();
    const progress = await redis.get(`job_progress:${jobId}`);
    
    if (progress) {
      res.json({
        success: true,
        data: JSON.parse(progress),
      });
      return;
    }
    
    res.status(404).json({
      success: false,
      error: 'Job not found',
      code: 'JOB_NOT_FOUND',
    });
  } catch (error: any) {
    logger.error('[JOBS] Error fetching job status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'JOB_STATUS_ERROR',
    });
  }
});

/**
 * @route   GET /api/jobs/connection/:connectionId
 * @desc    Get all pending jobs for a connection
 * @access  Private
 */
router.get('/connection/:connectionId', authenticate, async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;
    const jobs = await getJobsForConnection(connectionId);
    
    const jobList = await Promise.all(jobs.map(async (job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      progress: await job.getState(),
      timestamp: job.timestamp,
    })));
    
    res.json({
      success: true,
      data: jobList,
    });
  } catch (error: any) {
    logger.error('[JOBS] Error fetching connection jobs:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'JOBS_FETCH_ERROR',
    });
  }
});

/**
 * @route   GET /api/jobs/stats
 * @desc    Get queue statistics (for monitoring)
 * @access  Private
 */
router.get('/stats', authenticate, async (req: Request, res: Response) => {
  try {
    const [schemaSyncStats, aiOpsStats] = await Promise.all([
      getSchemaSyncQueueStats(),
      getAIOperationsQueueStats(),
    ]);
    
    res.json({
      success: true,
      data: {
        schemaSync: schemaSyncStats,
        aiOperations: aiOpsStats,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    logger.error('[JOBS] Error fetching queue stats:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'STATS_FETCH_ERROR',
    });
  }
});

export default router;

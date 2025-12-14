import { Queue, Worker, Job } from 'bullmq';
import { Sequelize, QueryTypes } from 'sequelize';
import { 
  QUEUE_NAMES, 
  AI_OPERATION_JOBS,
  aiOperationsJobDefaults,
  WORKER_CONCURRENCY,
  WORKER_RATE_LIMITS,
  createQueue,
  createQueueEvents,
  JOB_PRIORITY,
  AIOperationJobType,
} from '../config/queue';
import { bullMQConnection, getRedisClient } from '../config/redis';
import { sequelize } from '../config/db';
import { decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';
import { generateSqlFromPrompt, explainSqlQuery } from '../service/ai.service';

// ============================================
// AI OPERATIONS QUEUE
// Handles AI-related jobs (SQL generation, query explanation, etc.)
// ============================================

// Job data types
export interface GenerateSqlJobData {
  type: typeof AI_OPERATION_JOBS.GENERATE_SQL;
  connectionId: string;
  userId: string;
  prompt: string;
  selectedSchemas: string[];
  conversationId?: string;
}

export interface ExplainQueryJobData {
  type: typeof AI_OPERATION_JOBS.EXPLAIN_QUERY;
  connectionId: string;
  userId: string;
  sql: string;
  includeExecutionPlan?: boolean;
}

export interface OptimizeQueryJobData {
  type: typeof AI_OPERATION_JOBS.OPTIMIZE_QUERY;
  connectionId: string;
  userId: string;
  sql: string;
  executionPlan?: string;
}

export interface SuggestIndexesJobData {
  type: typeof AI_OPERATION_JOBS.SUGGEST_INDEXES;
  connectionId: string;
  userId: string;
  tableName: string;
  schemaName: string;
  queryPatterns?: string[];
}

export type AIOperationJobData = 
  | GenerateSqlJobData 
  | ExplainQueryJobData 
  | OptimizeQueryJobData
  | SuggestIndexesJobData;

// Create the queue
export const aiOperationsQueue = createQueue(
  QUEUE_NAMES.AI_OPERATIONS, 
  aiOperationsJobDefaults
);

// Create queue events for monitoring
export const aiOperationsQueueEvents = createQueueEvents(QUEUE_NAMES.AI_OPERATIONS);

// ============================================
// JOB PRODUCERS (Add jobs to queue)
// ============================================

/**
 * Add a SQL generation job
 */
export async function addGenerateSqlJob(
  data: Omit<GenerateSqlJobData, 'type'>,
  priority: number = JOB_PRIORITY.NORMAL
): Promise<Job<AIOperationJobData>> {
  const jobData: GenerateSqlJobData = {
    ...data,
    type: AI_OPERATION_JOBS.GENERATE_SQL,
  };

  const job = await aiOperationsQueue.add(
    AI_OPERATION_JOBS.GENERATE_SQL,
    jobData,
    {
      priority,
      jobId: `generate-sql-${data.userId}-${Date.now()}`,
    }
  );

  logger.info(`[AI_OPS] Added generate-sql job`, { jobId: job.id, userId: data.userId });
  return job;
}

/**
 * Add a query explanation job
 */
export async function addExplainQueryJob(
  data: Omit<ExplainQueryJobData, 'type'>,
  priority: number = JOB_PRIORITY.NORMAL
): Promise<Job<AIOperationJobData>> {
  const jobData: ExplainQueryJobData = {
    ...data,
    type: AI_OPERATION_JOBS.EXPLAIN_QUERY,
  };

  const job = await aiOperationsQueue.add(
    AI_OPERATION_JOBS.EXPLAIN_QUERY,
    jobData,
    {
      priority,
      jobId: `explain-query-${data.userId}-${Date.now()}`,
    }
  );

  logger.info(`[AI_OPS] Added explain-query job`, { jobId: job.id });
  return job;
}

/**
 * Add a query optimization job
 */
export async function addOptimizeQueryJob(
  data: Omit<OptimizeQueryJobData, 'type'>,
  priority: number = JOB_PRIORITY.NORMAL
): Promise<Job<AIOperationJobData>> {
  const jobData: OptimizeQueryJobData = {
    ...data,
    type: AI_OPERATION_JOBS.OPTIMIZE_QUERY,
  };

  const job = await aiOperationsQueue.add(
    AI_OPERATION_JOBS.OPTIMIZE_QUERY,
    jobData,
    {
      priority,
      jobId: `optimize-query-${data.userId}-${Date.now()}`,
    }
  );

  logger.info(`[AI_OPS] Added optimize-query job`, { jobId: job.id });
  return job;
}

/**
 * Add an index suggestion job
 */
export async function addSuggestIndexesJob(
  data: Omit<SuggestIndexesJobData, 'type'>,
  priority: number = JOB_PRIORITY.LOW
): Promise<Job<AIOperationJobData>> {
  const jobData: SuggestIndexesJobData = {
    ...data,
    type: AI_OPERATION_JOBS.SUGGEST_INDEXES,
  };

  const job = await aiOperationsQueue.add(
    AI_OPERATION_JOBS.SUGGEST_INDEXES,
    jobData,
    {
      priority,
      jobId: `suggest-indexes-${data.userId}-${Date.now()}`,
    }
  );

  logger.info(`[AI_OPS] Added suggest-indexes job`, { jobId: job.id });
  return job;
}

// ============================================
// PROGRESS & RESULT PUBLISHING
// ============================================

export interface AIJobResult {
  jobId: string;
  type: AIOperationJobType;
  success: boolean;
  result?: {
    sql?: string;
    explanation?: string;
    suggestions?: string[];
    confidence?: number;
    reasoning?: {
      steps: string[];
      optimization_notes: string[];
    };
    tables_used?: string[];
    columns_used?: string[];
    desc?: string;
  };
  error?: string;
  executionTime?: number;
}

/**
 * Publish AI job result to Redis for client polling
 */
export async function publishAIJobResult(userId: string, result: AIJobResult): Promise<void> {
  const redis = getRedisClient();
  
  // Store result for polling (expires in 5 minutes)
  const resultKey = `ai_result:${result.jobId}`;
  await redis.setex(resultKey, 300, JSON.stringify(result));
  
  // Also publish to Pub/Sub for real-time updates
  const channel = `ai:result:${userId}`;
  await redis.publish(channel, JSON.stringify(result));
  
  logger.debug(`[AI_OPS] Published result for job ${result.jobId}`);
}

/**
 * Get AI job result (for polling)
 */
export async function getAIJobResult(jobId: string): Promise<AIJobResult | null> {
  const redis = getRedisClient();
  const result = await redis.get(`ai_result:${jobId}`);
  return result ? JSON.parse(result) : null;
}

// ============================================
// WORKER (Job Processor) - Stub Implementation
// ============================================

export function createAIOperationsWorker(): Worker<AIOperationJobData> {
  const worker = new Worker<AIOperationJobData>(
    QUEUE_NAMES.AI_OPERATIONS,
    async (job: Job<AIOperationJobData>) => {
      logger.info(`[AI_OPS_WORKER] Processing job ${job.id}`, { type: job.data.type });
      
      const { type, connectionId, userId } = job.data;
      const startTime = Date.now();

      try {
        switch (type) {
          case AI_OPERATION_JOBS.GENERATE_SQL: {
            const data = job.data as GenerateSqlJobData;
            logger.info(`[AI_OPS_WORKER] Generate SQL for prompt: "${data.prompt.substring(0, 50)}..."`);
            
            job.updateProgress(10);
            
            // Generate SQL using AI service
            const aiResult = await generateSqlFromPrompt(
              connectionId,
              data.prompt,
              data.selectedSchemas
            );
            
            job.updateProgress(90);
            
            const result: AIJobResult = {
              jobId: job.id!,
              type: AI_OPERATION_JOBS.GENERATE_SQL,
              success: true,
              result: {
                sql: aiResult.query,
                explanation: aiResult.desc,
                reasoning: aiResult.reasoning,
                tables_used: aiResult.tables_used,
                columns_used: aiResult.columns_used,
                confidence: 0.9,
              },
              executionTime: Date.now() - startTime,
            };
            
            await publishAIJobResult(userId, result);
            return result;
          }

          case AI_OPERATION_JOBS.EXPLAIN_QUERY: {
            const data = job.data as ExplainQueryJobData;
            logger.info(`[AI_OPS_WORKER] Explain query for connection: ${connectionId}`);
            
            job.updateProgress(10);
            
            // Explain SQL using AI service
            const explanation = await explainSqlQuery(connectionId, data.sql);
            
            job.updateProgress(90);
            
            const result: AIJobResult = {
              jobId: job.id!,
              type: AI_OPERATION_JOBS.EXPLAIN_QUERY,
              success: true,
              result: {
                explanation,
              },
              executionTime: Date.now() - startTime,
            };
            
            await publishAIJobResult(userId, result);
            return result;
          }

          case AI_OPERATION_JOBS.OPTIMIZE_QUERY: {
            logger.info(`[AI_OPS_WORKER] Optimize query - Not implemented yet`);
            
            const result: AIJobResult = {
              jobId: job.id!,
              type: AI_OPERATION_JOBS.OPTIMIZE_QUERY,
              success: true,
              result: {
                suggestions: ['Query optimization not implemented yet.'],
              },
              executionTime: Date.now() - startTime,
            };
            
            await publishAIJobResult(userId, result);
            return result;
          }

          case AI_OPERATION_JOBS.SUGGEST_INDEXES: {
            logger.info(`[AI_OPS_WORKER] Suggest indexes - Not implemented yet`);
            
            const result: AIJobResult = {
              jobId: job.id!,
              type: AI_OPERATION_JOBS.SUGGEST_INDEXES,
              success: true,
              result: {
                suggestions: ['Index suggestions not implemented yet.'],
              },
              executionTime: Date.now() - startTime,
            };
            
            await publishAIJobResult(userId, result);
            return result;
          }

          default:
            throw new Error(`Unknown job type: ${type}`);
        }
      } catch (error: any) {
        logger.error(`[AI_OPS_WORKER] Job ${job.id} failed:`, error);
        
        const errorResult: AIJobResult = {
          jobId: job.id!,
          type,
          success: false,
          error: error.message,
          executionTime: Date.now() - startTime,
        };
        
        await publishAIJobResult(userId, errorResult);
        throw error;
      }
    },
    {
      connection: bullMQConnection,
      concurrency: WORKER_CONCURRENCY.AI_OPERATIONS,
      limiter: WORKER_RATE_LIMITS.AI_OPERATIONS,
    }
  );

  worker.on('completed', (job) => {
    logger.info(`[AI_OPS_WORKER] Job ${job.id} completed`);
  });

  worker.on('failed', (job, error) => {
    logger.error(`[AI_OPS_WORKER] Job ${job?.id} failed:`, error.message);
  });

  worker.on('error', (error) => {
    logger.error('[AI_OPS_WORKER] Worker error:', error);
  });

  logger.info('[AI_OPS_WORKER] Worker started');
  return worker;
}

// ============================================
// QUEUE UTILITIES
// ============================================

/**
 * Get queue stats
 */
export async function getAIOperationsQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    aiOperationsQueue.getWaitingCount(),
    aiOperationsQueue.getActiveCount(),
    aiOperationsQueue.getCompletedCount(),
    aiOperationsQueue.getFailedCount(),
    aiOperationsQueue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * Get user's pending AI jobs
 */
export async function getUserPendingJobs(userId: string) {
  const jobs = await aiOperationsQueue.getJobs(['waiting', 'active', 'delayed']);
  return jobs.filter(job => job.data.userId === userId);
}

/**
 * Check if user has too many pending jobs
 */
export async function hasUserExceededPendingLimit(userId: string, limit: number = 5): Promise<boolean> {
  const pendingJobs = await getUserPendingJobs(userId);
  return pendingJobs.length >= limit;
}

import { Queue, QueueEvents, Worker } from 'bullmq';
import { bullMQConnection } from './redis';
import { logger } from '../utils/logger';

// ============================================
// QUEUE CONFIGURATION
// ============================================

// Queue names
export const QUEUE_NAMES = {
  SCHEMA_SYNC: 'schema-sync',
  AI_OPERATIONS: 'ai-operations',
  DB_OPERATIONS: 'db-operations',
} as const;

// Job types for Schema Sync Queue
export const SCHEMA_SYNC_JOBS = {
  SYNC_FULL_SCHEMA: 'sync-full-schema',
  SYNC_SINGLE_SCHEMA: 'sync-single-schema',
  SYNC_SINGLE_TABLE: 'sync-single-table',
  REFRESH_SCHEMA: 'refresh-schema',
} as const;

// Job types for AI Operations Queue
export const AI_OPERATION_JOBS = {
  GENERATE_SQL: 'generate-sql',
  EXPLAIN_QUERY: 'explain-query',
  OPTIMIZE_QUERY: 'optimize-query',
  SUGGEST_INDEXES: 'suggest-indexes',
} as const;

// Job types for DB Operations Queue
export const DB_OPERATION_JOBS = {
  SELECT_QUERY: 'select-query',
  UPDATE_ROW: 'update-row',
  INSERT_ROW: 'insert-row',
  DELETE_ROW: 'delete-row',
  EXECUTE_RAW_SQL: 'execute-raw-sql',
} as const;

// Default job options for Schema Sync
export const schemaSyncJobDefaults = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000, // 5s, 10s, 20s
  },
  removeOnComplete: {
    age: 3600, // 1 hour
    count: 100,
  },
  removeOnFail: {
    age: 86400, // 24 hours
  },
};

// Default job options for AI Operations
export const aiOperationsJobDefaults = {
  attempts: 2,
  backoff: {
    type: 'fixed' as const,
    delay: 2000,
  },
  removeOnComplete: {
    age: 1800, // 30 minutes
    count: 200,
  },
  removeOnFail: {
    age: 3600, // 1 hour
  },
};

// Default job options for DB Operations
export const dbOperationsJobDefaults = {
  attempts: 2,
  backoff: {
    type: 'fixed' as const,
    delay: 1000,
  },
  removeOnComplete: {
    age: 1800, // 30 minutes
    count: 500,
  },
  removeOnFail: {
    age: 3600, // 1 hour
  },
};

// Worker concurrency settings
export const WORKER_CONCURRENCY = {
  SCHEMA_SYNC: 2, // Don't overload external databases
  AI_OPERATIONS: 5, // Higher concurrency (mostly I/O wait)
  DB_OPERATIONS: 10, // Higher concurrency for quick queries
};

// Rate limiter settings for workers
export const WORKER_RATE_LIMITS = {
  SCHEMA_SYNC: {
    max: 10,
    duration: 60000, // 10 jobs per minute
  },
  AI_OPERATIONS: {
    max: 30,
    duration: 60000, // 30 jobs per minute
  },
  DB_OPERATIONS: {
    max: 100,
    duration: 60000, // 100 jobs per minute per connection
  },
};

// Job priority levels
export const JOB_PRIORITY = {
  CRITICAL: 1,
  HIGH: 3,
  NORMAL: 5,
  LOW: 7,
  BACKGROUND: 10,
} as const;

// Create a queue with standard configuration
export function createQueue(name: string, defaultJobOptions: object): Queue {
  const queue = new Queue(name, {
    connection: bullMQConnection,
    defaultJobOptions,
  });

  queue.on('error', (error) => {
    logger.error(`[QUEUE:${name}] Error:`, error);
  });

  logger.info(`[QUEUE:${name}] Queue created`);
  return queue;
}

// Create queue events listener
export function createQueueEvents(name: string): QueueEvents {
  const queueEvents = new QueueEvents(name, {
    connection: bullMQConnection,
  });

  queueEvents.on('completed', ({ jobId }) => {
    logger.debug(`[QUEUE:${name}] Job ${jobId} completed`);
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(`[QUEUE:${name}] Job ${jobId} failed:`, failedReason);
  });

  queueEvents.on('progress', ({ jobId, data }) => {
    logger.debug(`[QUEUE:${name}] Job ${jobId} progress:`, data);
  });

  return queueEvents;
}

// Export type for queue names
export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];
export type SchemaSyncJobType = typeof SCHEMA_SYNC_JOBS[keyof typeof SCHEMA_SYNC_JOBS];
export type AIOperationJobType = typeof AI_OPERATION_JOBS[keyof typeof AI_OPERATION_JOBS];
export type DBOperationJobType = typeof DB_OPERATION_JOBS[keyof typeof DB_OPERATION_JOBS];

import { Queue, Worker, Job } from 'bullmq';
import { 
  QUEUE_NAMES, 
  SCHEMA_SYNC_JOBS,
  schemaSyncJobDefaults,
  WORKER_CONCURRENCY,
  WORKER_RATE_LIMITS,
  createQueue,
  createQueueEvents,
  JOB_PRIORITY,
  SchemaSyncJobType,
} from '../config/queue';
import { bullMQConnection, getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

// ============================================
// SCHEMA SYNC QUEUE
// Handles database schema fetching jobs
// ============================================

// Job data types
export interface SyncFullSchemaJobData {
  type: typeof SCHEMA_SYNC_JOBS.SYNC_FULL_SCHEMA;
  connectionId: string;
  userId: string;
  connectionName: string;
}

export interface SyncSingleSchemaJobData {
  type: typeof SCHEMA_SYNC_JOBS.SYNC_SINGLE_SCHEMA;
  connectionId: string;
  userId: string;
  schemaName: string;
}

export interface SyncSingleTableJobData {
  type: typeof SCHEMA_SYNC_JOBS.SYNC_SINGLE_TABLE;
  connectionId: string;
  userId: string;
  schemaName: string;
  tableName: string;
}

export interface RefreshSchemaJobData {
  type: typeof SCHEMA_SYNC_JOBS.REFRESH_SCHEMA;
  connectionId: string;
  userId: string;
}

export type SchemaSyncJobData = 
  | SyncFullSchemaJobData 
  | SyncSingleSchemaJobData 
  | SyncSingleTableJobData
  | RefreshSchemaJobData;

// Create the queue
export const schemaSyncQueue = createQueue(
  QUEUE_NAMES.SCHEMA_SYNC, 
  schemaSyncJobDefaults
);

// Create queue events for monitoring
export const schemaSyncQueueEvents = createQueueEvents(QUEUE_NAMES.SCHEMA_SYNC);

// ============================================
// JOB PRODUCERS (Add jobs to queue)
// ============================================

/**
 * Add a full schema sync job (triggered after new connection)
 */
export async function addSyncFullSchemaJob(data: Omit<SyncFullSchemaJobData, 'type'>): Promise<Job<SchemaSyncJobData>> {
  const jobData: SyncFullSchemaJobData = {
    ...data,
    type: SCHEMA_SYNC_JOBS.SYNC_FULL_SCHEMA,
  };

  const job = await schemaSyncQueue.add(
    SCHEMA_SYNC_JOBS.SYNC_FULL_SCHEMA,
    jobData,
    {
      priority: JOB_PRIORITY.HIGH,
      jobId: `sync-full-${data.connectionId}-${Date.now()}`,
    }
  );

  logger.info(`[SCHEMA_SYNC] Added full sync job for connection ${data.connectionId}`, { jobId: job.id });
  return job;
}

/**
 * Add a single schema sync job
 */
export async function addSyncSingleSchemaJob(data: Omit<SyncSingleSchemaJobData, 'type'>): Promise<Job<SchemaSyncJobData>> {
  const jobData: SyncSingleSchemaJobData = {
    ...data,
    type: SCHEMA_SYNC_JOBS.SYNC_SINGLE_SCHEMA,
  };

  const job = await schemaSyncQueue.add(
    SCHEMA_SYNC_JOBS.SYNC_SINGLE_SCHEMA,
    jobData,
    {
      priority: JOB_PRIORITY.NORMAL,
      jobId: `sync-schema-${data.connectionId}-${data.schemaName}-${Date.now()}`,
    }
  );

  logger.info(`[SCHEMA_SYNC] Added schema sync job for ${data.schemaName}`, { jobId: job.id });
  return job;
}

/**
 * Add a single table sync job
 */
export async function addSyncSingleTableJob(data: Omit<SyncSingleTableJobData, 'type'>): Promise<Job<SchemaSyncJobData>> {
  const jobData: SyncSingleTableJobData = {
    ...data,
    type: SCHEMA_SYNC_JOBS.SYNC_SINGLE_TABLE,
  };

  const job = await schemaSyncQueue.add(
    SCHEMA_SYNC_JOBS.SYNC_SINGLE_TABLE,
    jobData,
    {
      priority: JOB_PRIORITY.LOW,
      jobId: `sync-table-${data.connectionId}-${data.schemaName}-${data.tableName}-${Date.now()}`,
    }
  );

  logger.info(`[SCHEMA_SYNC] Added table sync job for ${data.schemaName}.${data.tableName}`, { jobId: job.id });
  return job;
}

/**
 * Add a refresh schema job
 */
export async function addRefreshSchemaJob(data: Omit<RefreshSchemaJobData, 'type'>): Promise<Job<SchemaSyncJobData>> {
  const jobData: RefreshSchemaJobData = {
    ...data,
    type: SCHEMA_SYNC_JOBS.REFRESH_SCHEMA,
  };

  const job = await schemaSyncQueue.add(
    SCHEMA_SYNC_JOBS.REFRESH_SCHEMA,
    jobData,
    {
      priority: JOB_PRIORITY.NORMAL,
      jobId: `refresh-${data.connectionId}-${Date.now()}`,
    }
  );

  logger.info(`[SCHEMA_SYNC] Added refresh job for connection ${data.connectionId}`, { jobId: job.id });
  return job;
}

// ============================================
// PROGRESS PUBLISHING
// ============================================

export interface JobProgressUpdate {
  jobId: string;
  type: 'schema-sync';
  connectionId: string;
  schemaName?: string;
  tableName?: string;
  progress: number;
  message: string;
  status: 'processing' | 'completed' | 'failed';
}

/**
 * Publish job progress to Redis Pub/Sub for real-time UI updates
 */
export async function publishJobProgress(userId: string, update: JobProgressUpdate): Promise<void> {
  const redis = getRedisClient();
  const channel = `job:progress:${userId}`;
  
  await redis.publish(channel, JSON.stringify(update));
  logger.debug(`[SCHEMA_SYNC] Published progress to ${channel}:`, update);
}

/**
 * Publish job completion
 */
export async function publishJobComplete(userId: string, jobId: string, connectionId: string, success: boolean): Promise<void> {
  const redis = getRedisClient();
  const channel = `job:complete:${userId}`;
  
  await redis.publish(channel, JSON.stringify({
    jobId,
    type: 'schema-sync',
    connectionId,
    success,
    completedAt: new Date().toISOString(),
  }));
  
  logger.info(`[SCHEMA_SYNC] Published completion to ${channel}`, { jobId, success });
}

/**
 * Publish job error
 */
export async function publishJobError(userId: string, jobId: string, connectionId: string, error: string): Promise<void> {
  const redis = getRedisClient();
  const channel = `job:error:${userId}`;
  
  await redis.publish(channel, JSON.stringify({
    jobId,
    type: 'schema-sync',
    connectionId,
    error,
    failedAt: new Date().toISOString(),
  }));
  
  logger.error(`[SCHEMA_SYNC] Published error to ${channel}`, { jobId, error });
}

// ============================================
// WORKER (Job Processor) - Stub Implementation
// ============================================

// Note: The actual worker implementation will be in schema-sync.worker.ts
// This is the job processor that will be started separately

export function createSchemaSyncWorker(): Worker<SchemaSyncJobData> {
  const worker = new Worker<SchemaSyncJobData>(
    QUEUE_NAMES.SCHEMA_SYNC,
    async (job: Job<SchemaSyncJobData>) => {
      logger.info(`[SCHEMA_SYNC_WORKER] Processing job ${job.id}`, { type: job.data.type });
      
      const { type, connectionId, userId } = job.data;

      try {
        switch (type) {
          case SCHEMA_SYNC_JOBS.SYNC_FULL_SCHEMA:
            // TODO: Implement in Phase 2
            await publishJobProgress(userId, {
              jobId: job.id!,
              type: 'schema-sync',
              connectionId,
              progress: 0,
              message: 'Starting full schema sync...',
              status: 'processing',
            });
            
            // Placeholder - will be implemented in Phase 2
            logger.info(`[SCHEMA_SYNC_WORKER] Full schema sync for ${connectionId} - Not implemented yet`);
            
            await job.updateProgress(100);
            await publishJobComplete(userId, job.id!, connectionId, true);
            return { success: true, message: 'Schema sync placeholder completed' };

          case SCHEMA_SYNC_JOBS.SYNC_SINGLE_SCHEMA:
            logger.info(`[SCHEMA_SYNC_WORKER] Single schema sync - Not implemented yet`);
            return { success: true, message: 'Single schema sync placeholder' };

          case SCHEMA_SYNC_JOBS.SYNC_SINGLE_TABLE:
            logger.info(`[SCHEMA_SYNC_WORKER] Single table sync - Not implemented yet`);
            return { success: true, message: 'Single table sync placeholder' };

          case SCHEMA_SYNC_JOBS.REFRESH_SCHEMA:
            logger.info(`[SCHEMA_SYNC_WORKER] Refresh schema - Not implemented yet`);
            return { success: true, message: 'Refresh schema placeholder' };

          default:
            throw new Error(`Unknown job type: ${type}`);
        }
      } catch (error: any) {
        logger.error(`[SCHEMA_SYNC_WORKER] Job ${job.id} failed:`, error);
        await publishJobError(userId, job.id!, connectionId, error.message);
        throw error;
      }
    },
    {
      connection: bullMQConnection,
      concurrency: WORKER_CONCURRENCY.SCHEMA_SYNC,
      limiter: WORKER_RATE_LIMITS.SCHEMA_SYNC,
    }
  );

  worker.on('completed', (job) => {
    logger.info(`[SCHEMA_SYNC_WORKER] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, error) => {
    logger.error(`[SCHEMA_SYNC_WORKER] Job ${job?.id} failed:`, error.message);
  });

  worker.on('error', (error) => {
    logger.error('[SCHEMA_SYNC_WORKER] Worker error:', error);
  });

  logger.info('[SCHEMA_SYNC_WORKER] Worker started');
  return worker;
}

// ============================================
// QUEUE UTILITIES
// ============================================

/**
 * Get queue stats
 */
export async function getSchemaSyncQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    schemaSyncQueue.getWaitingCount(),
    schemaSyncQueue.getActiveCount(),
    schemaSyncQueue.getCompletedCount(),
    schemaSyncQueue.getFailedCount(),
    schemaSyncQueue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * Get jobs for a specific connection
 */
export async function getJobsForConnection(connectionId: string) {
  const jobs = await schemaSyncQueue.getJobs(['waiting', 'active', 'delayed']);
  return jobs.filter(job => job.data.connectionId === connectionId);
}

/**
 * Cancel pending jobs for a connection (e.g., when connection is deleted)
 */
export async function cancelJobsForConnection(connectionId: string): Promise<number> {
  const jobs = await getJobsForConnection(connectionId);
  let cancelled = 0;
  
  for (const job of jobs) {
    const state = await job.getState();
    if (state === 'waiting' || state === 'delayed') {
      await job.remove();
      cancelled++;
    }
  }
  
  logger.info(`[SCHEMA_SYNC] Cancelled ${cancelled} jobs for connection ${connectionId}`);
  return cancelled;
}

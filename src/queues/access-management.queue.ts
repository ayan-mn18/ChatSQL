import { Queue, Worker, Job } from 'bullmq';
import { 
  createQueue,
  createQueueEvents,
  JOB_PRIORITY,
} from '../config/queue';
import { bullMQConnection } from '../config/redis';
import { logger } from '../utils/logger';
import * as viewerService from '../services/viewer.service';

// ============================================
// ACCESS MANAGEMENT QUEUE
// Handles viewer expiry and permission management
// ============================================

// Queue name
export const ACCESS_MANAGEMENT_QUEUE_NAME = 'access-management';

// Job types
export const ACCESS_MANAGEMENT_JOBS = {
  CLEANUP_EXPIRED_VIEWERS: 'cleanup-expired-viewers',
  SCHEDULE_VIEWER_EXPIRY: 'schedule-viewer-expiry',
} as const;

// Default job options
const accessManagementJobDefaults = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
  removeOnComplete: {
    age: 3600, // 1 hour
    count: 100,
  },
  removeOnFail: {
    age: 86400, // 24 hours
  },
};

// Job data types
export interface CleanupExpiredViewersJobData {
  type: typeof ACCESS_MANAGEMENT_JOBS.CLEANUP_EXPIRED_VIEWERS;
}

export interface ScheduleViewerExpiryJobData {
  type: typeof ACCESS_MANAGEMENT_JOBS.SCHEDULE_VIEWER_EXPIRY;
  viewerId: string;
  viewerEmail: string;
  expiresAt: Date;
}

export type AccessManagementJobData = 
  | CleanupExpiredViewersJobData 
  | ScheduleViewerExpiryJobData;

// Create the queue
export const accessManagementQueue = createQueue(
  ACCESS_MANAGEMENT_QUEUE_NAME, 
  accessManagementJobDefaults
);

// Create queue events for monitoring
export const accessManagementQueueEvents = createQueueEvents(ACCESS_MANAGEMENT_QUEUE_NAME);

// ============================================
// JOB PRODUCERS (Add jobs to queue)
// ============================================

/**
 * Add a job to cleanup expired viewers
 * This runs periodically (e.g., every 5 minutes)
 */
export async function addCleanupExpiredViewersJob(): Promise<Job<AccessManagementJobData>> {
  const jobData: CleanupExpiredViewersJobData = {
    type: ACCESS_MANAGEMENT_JOBS.CLEANUP_EXPIRED_VIEWERS,
  };
  
  return accessManagementQueue.add(
    ACCESS_MANAGEMENT_JOBS.CLEANUP_EXPIRED_VIEWERS,
    jobData,
    {
      priority: JOB_PRIORITY.LOW,
      jobId: 'cleanup-expired-viewers-periodic', // Prevent duplicates
      repeat: {
        every: 5 * 60 * 1000, // Every 5 minutes
      },
    }
  );
}

/**
 * Schedule a specific viewer's expiry
 * Creates a delayed job that fires when the viewer expires
 */
export async function scheduleViewerExpiry(
  viewerId: string, 
  viewerEmail: string,
  expiresAt: Date
): Promise<Job<AccessManagementJobData> | null> {
  const now = new Date();
  const delay = expiresAt.getTime() - now.getTime();
  
  // Don't schedule if already expired
  if (delay <= 0) {
    logger.warn(`[ACCESS_MGMT] Viewer ${viewerEmail} expiry is in the past, skipping schedule`);
    return null;
  }
  
  const jobData: ScheduleViewerExpiryJobData = {
    type: ACCESS_MANAGEMENT_JOBS.SCHEDULE_VIEWER_EXPIRY,
    viewerId,
    viewerEmail,
    expiresAt,
  };
  
  logger.info(`[ACCESS_MGMT] Scheduling viewer ${viewerEmail} expiry in ${Math.round(delay / 1000 / 60)} minutes`);
  
  return accessManagementQueue.add(
    ACCESS_MANAGEMENT_JOBS.SCHEDULE_VIEWER_EXPIRY,
    jobData,
    {
      priority: JOB_PRIORITY.NORMAL,
      delay,
      jobId: `viewer-expiry-${viewerId}`, // Prevent duplicate jobs for same viewer
    }
  );
}

/**
 * Cancel a scheduled viewer expiry (e.g., when expiry is extended)
 */
export async function cancelViewerExpiryJob(viewerId: string): Promise<boolean> {
  try {
    const jobId = `viewer-expiry-${viewerId}`;
    const job = await accessManagementQueue.getJob(jobId);
    
    if (job) {
      await job.remove();
      logger.info(`[ACCESS_MGMT] Cancelled expiry job for viewer ${viewerId}`);
      return true;
    }
    
    return false;
  } catch (error) {
    logger.error(`[ACCESS_MGMT] Failed to cancel expiry job for viewer ${viewerId}:`, error);
    return false;
  }
}

// ============================================
// WORKER (Process jobs)
// ============================================

export function createAccessManagementWorker(): Worker<AccessManagementJobData> {
  const worker = new Worker<AccessManagementJobData>(
    ACCESS_MANAGEMENT_QUEUE_NAME,
    async (job: Job<AccessManagementJobData>) => {
      const { type } = job.data;
      
      logger.info(`[ACCESS_MGMT] Processing job: ${type} (${job.id})`);
      
      switch (type) {
        case ACCESS_MANAGEMENT_JOBS.CLEANUP_EXPIRED_VIEWERS:
          return processCleanupExpiredViewers(job as Job<CleanupExpiredViewersJobData>);
          
        case ACCESS_MANAGEMENT_JOBS.SCHEDULE_VIEWER_EXPIRY:
          return processScheduledViewerExpiry(job as Job<ScheduleViewerExpiryJobData>);
          
        default:
          throw new Error(`Unknown job type: ${type}`);
      }
    },
    {
      connection: bullMQConnection,
      concurrency: 2,
    }
  );
  
  worker.on('completed', (job) => {
    logger.info(`[ACCESS_MGMT] Job ${job.id} completed`);
  });
  
  worker.on('failed', (job, error) => {
    logger.error(`[ACCESS_MGMT] Job ${job?.id} failed:`, error);
  });
  
  logger.info('[ACCESS_MGMT] Worker started');
  return worker;
}

// ============================================
// JOB PROCESSORS
// ============================================

/**
 * Process cleanup of expired viewers
 */
async function processCleanupExpiredViewers(
  job: Job<CleanupExpiredViewersJobData>
): Promise<{ deactivatedCount: number }> {
  logger.info('[ACCESS_MGMT] Running expired viewers cleanup');
  
  try {
    const deactivatedCount = await viewerService.deactivateExpiredViewers();
    
    return { deactivatedCount };
  } catch (error) {
    logger.error('[ACCESS_MGMT] Failed to cleanup expired viewers:', error);
    throw error;
  }
}

/**
 * Process a scheduled viewer expiry
 */
async function processScheduledViewerExpiry(
  job: Job<ScheduleViewerExpiryJobData>
): Promise<{ success: boolean }> {
  const { viewerId, viewerEmail } = job.data;
  
  logger.info(`[ACCESS_MGMT] Processing scheduled expiry for viewer ${viewerEmail}`);
  
  try {
    // Get expired viewers and check if this one is still supposed to expire
    const expiredViewers = await viewerService.getExpiredViewers();
    const isStillExpired = expiredViewers.some(v => v.id === viewerId);
    
    if (!isStillExpired) {
      // Expiry might have been extended
      logger.info(`[ACCESS_MGMT] Viewer ${viewerEmail} no longer expired (possibly extended)`);
      return { success: true };
    }
    
    // Deactivate the viewer
    await viewerService.deactivateExpiredViewers();
    
    logger.info(`[ACCESS_MGMT] Viewer ${viewerEmail} access expired and deactivated`);
    
    // TODO: Optionally send expiry notification email
    
    return { success: true };
  } catch (error) {
    logger.error(`[ACCESS_MGMT] Failed to process viewer expiry for ${viewerEmail}:`, error);
    throw error;
  }
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the access management queue with periodic cleanup
 */
export async function initializeAccessManagement(): Promise<void> {
  try {
    // Remove any existing repeatable jobs to avoid duplicates
    const repeatableJobs = await accessManagementQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await accessManagementQueue.removeRepeatableByKey(job.key);
    }
    
    // Add the periodic cleanup job
    await addCleanupExpiredViewersJob();
    
    logger.info('[ACCESS_MGMT] Initialized with periodic cleanup job');
  } catch (error) {
    logger.error('[ACCESS_MGMT] Failed to initialize:', error);
    throw error;
  }
}

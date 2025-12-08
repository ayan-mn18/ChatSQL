// ============================================
// QUEUE EXPORTS
// ============================================

// Schema Sync Queue
export {
  schemaSyncQueue,
  schemaSyncQueueEvents,
  addSyncFullSchemaJob,
  addSyncSingleSchemaJob,
  addSyncSingleTableJob,
  addRefreshSchemaJob,
  publishJobProgress,
  publishJobComplete,
  publishJobError,
  createSchemaSyncWorker,
  getSchemaSyncQueueStats,
  getJobsForConnection,
  cancelJobsForConnection,
  type SchemaSyncJobData,
  type SyncFullSchemaJobData,
  type SyncSingleSchemaJobData,
  type SyncSingleTableJobData,
  type RefreshSchemaJobData,
  type JobProgressUpdate,
} from './schema-sync.queue';

// AI Operations Queue
export {
  aiOperationsQueue,
  aiOperationsQueueEvents,
  addGenerateSqlJob,
  addExplainQueryJob,
  addOptimizeQueryJob,
  addSuggestIndexesJob,
  publishAIJobResult,
  getAIJobResult,
  createAIOperationsWorker,
  getAIOperationsQueueStats,
  getUserPendingJobs,
  hasUserExceededPendingLimit,
  type AIOperationJobData,
  type GenerateSqlJobData,
  type ExplainQueryJobData,
  type OptimizeQueryJobData,
  type SuggestIndexesJobData,
  type AIJobResult,
} from './ai-operations.queue';

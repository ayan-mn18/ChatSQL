import { Queue, Worker, Job } from 'bullmq';
import { Sequelize, QueryTypes } from 'sequelize';
import { 
  QUEUE_NAMES, 
  DB_OPERATION_JOBS,
  dbOperationsJobDefaults,
  WORKER_CONCURRENCY,
  WORKER_RATE_LIMITS,
  createQueue,
  createQueueEvents,
  JOB_PRIORITY,
  DBOperationJobType,
} from '../config/queue';
import { bullMQConnection, getRedisClient } from '../config/redis';
import { sequelize } from '../config/db';
import { decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';
import { CACHE_KEYS, deleteCache, invalidateConnectionCache } from '../utils/cache';

// ============================================
// DB OPERATIONS QUEUE
// Handles all SQL operations on user's external databases
// ============================================

// ============================================
// JOB DATA TYPES
// ============================================

export interface SelectQueryJobData {
  type: typeof DB_OPERATION_JOBS.SELECT_QUERY;
  connectionId: string;
  userId: string;
  schemaName: string;
  tableName: string;
  columns?: string[];           // If empty, select all columns
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  filters?: FilterCondition[];
}

export interface UpdateRowJobData {
  type: typeof DB_OPERATION_JOBS.UPDATE_ROW;
  connectionId: string;
  userId: string;
  schemaName: string;
  tableName: string;
  primaryKeyColumn: string;
  primaryKeyValue: string | number;
  updates: ColumnUpdate[];
}

export interface InsertRowJobData {
  type: typeof DB_OPERATION_JOBS.INSERT_ROW;
  connectionId: string;
  userId: string;
  schemaName: string;
  tableName: string;
  values: Record<string, any>;
}

export interface DeleteRowJobData {
  type: typeof DB_OPERATION_JOBS.DELETE_ROW;
  connectionId: string;
  userId: string;
  schemaName: string;
  tableName: string;
  primaryKeyColumn: string;
  primaryKeyValue: string | number;
}

export interface ExecuteRawSQLJobData {
  type: typeof DB_OPERATION_JOBS.EXECUTE_RAW_SQL;
  connectionId: string;
  userId: string;
  query: string;
  parameters?: any[];
  readOnly?: boolean;  // If true, only allows SELECT queries
}

export type DBOperationJobData = 
  | SelectQueryJobData 
  | UpdateRowJobData 
  | InsertRowJobData
  | DeleteRowJobData
  | ExecuteRawSQLJobData;

// Supporting types
export interface FilterCondition {
  column: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in' | 'is_null' | 'is_not_null';
  value: any;
}

export interface ColumnUpdate {
  column: string;
  value: any;
  columnType: string;  // PostgreSQL type for proper casting
}

// Job result types
export interface SelectQueryResult {
  rows: any[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  columns: string[];
}

export interface MutationResult {
  success: boolean;
  affectedRows: number;
  message: string;
}

// ============================================
// CREATE QUEUE
// ============================================

export const dbOperationsQueue = createQueue(
  QUEUE_NAMES.DB_OPERATIONS, 
  dbOperationsJobDefaults
);

export const dbOperationsQueueEvents = createQueueEvents(QUEUE_NAMES.DB_OPERATIONS);

// ============================================
// JOB PRODUCERS
// ============================================

/**
 * Add a SELECT query job
 */
export async function addSelectQueryJob(data: Omit<SelectQueryJobData, 'type'>): Promise<Job<DBOperationJobData>> {
  const jobData: SelectQueryJobData = {
    ...data,
    type: DB_OPERATION_JOBS.SELECT_QUERY,
  };
  
  const job = await dbOperationsQueue.add(
    DB_OPERATION_JOBS.SELECT_QUERY,
    jobData,
    {
      priority: JOB_PRIORITY.HIGH,  // Query results needed quickly
      jobId: `select-${data.connectionId}-${data.schemaName}-${data.tableName}-${Date.now()}`,
    }
  );
  
  logger.info(`[DB_OPS] Added SELECT job ${job.id} for ${data.schemaName}.${data.tableName}`);
  return job;
}

/**
 * Add an UPDATE row job
 */
export async function addUpdateRowJob(data: Omit<UpdateRowJobData, 'type'>): Promise<Job<DBOperationJobData>> {
  const jobData: UpdateRowJobData = {
    ...data,
    type: DB_OPERATION_JOBS.UPDATE_ROW,
  };
  
  const job = await dbOperationsQueue.add(
    DB_OPERATION_JOBS.UPDATE_ROW,
    jobData,
    {
      priority: JOB_PRIORITY.NORMAL,
      jobId: `update-${data.connectionId}-${data.schemaName}-${data.tableName}-${data.primaryKeyValue}-${Date.now()}`,
    }
  );
  
  logger.info(`[DB_OPS] Added UPDATE job ${job.id} for ${data.schemaName}.${data.tableName}`);
  return job;
}

/**
 * Add an INSERT row job
 */
export async function addInsertRowJob(data: Omit<InsertRowJobData, 'type'>): Promise<Job<DBOperationJobData>> {
  const jobData: InsertRowJobData = {
    ...data,
    type: DB_OPERATION_JOBS.INSERT_ROW,
  };
  
  const job = await dbOperationsQueue.add(
    DB_OPERATION_JOBS.INSERT_ROW,
    jobData,
    {
      priority: JOB_PRIORITY.NORMAL,
      jobId: `insert-${data.connectionId}-${data.schemaName}-${data.tableName}-${Date.now()}`,
    }
  );
  
  logger.info(`[DB_OPS] Added INSERT job ${job.id} for ${data.schemaName}.${data.tableName}`);
  return job;
}

/**
 * Add a DELETE row job
 */
export async function addDeleteRowJob(data: Omit<DeleteRowJobData, 'type'>): Promise<Job<DBOperationJobData>> {
  const jobData: DeleteRowJobData = {
    ...data,
    type: DB_OPERATION_JOBS.DELETE_ROW,
  };
  
  const job = await dbOperationsQueue.add(
    DB_OPERATION_JOBS.DELETE_ROW,
    jobData,
    {
      priority: JOB_PRIORITY.NORMAL,
      jobId: `delete-${data.connectionId}-${data.schemaName}-${data.tableName}-${data.primaryKeyValue}-${Date.now()}`,
    }
  );
  
  logger.info(`[DB_OPS] Added DELETE job ${job.id} for ${data.schemaName}.${data.tableName}`);
  return job;
}

/**
 * Add a raw SQL execution job (for AI-generated queries)
 */
export async function addExecuteRawSQLJob(data: Omit<ExecuteRawSQLJobData, 'type'>): Promise<Job<DBOperationJobData>> {
  const jobData: ExecuteRawSQLJobData = {
    ...data,
    type: DB_OPERATION_JOBS.EXECUTE_RAW_SQL,
  };
  
  const job = await dbOperationsQueue.add(
    DB_OPERATION_JOBS.EXECUTE_RAW_SQL,
    jobData,
    {
      priority: data.readOnly ? JOB_PRIORITY.HIGH : JOB_PRIORITY.NORMAL,
      jobId: `raw-sql-${data.connectionId}-${Date.now()}`,
    }
  );
  
  logger.info(`[DB_OPS] Added RAW SQL job ${job.id}`);
  return job;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Create a temporary Sequelize instance for user's external database
 */
async function createUserDBConnection(connectionId: string): Promise<Sequelize | null> {
  try {
    // Fetch connection details from our database
    const [connectionRow] = await sequelize.query<any>(
      `SELECT host, port, db_name, username, password_enc, ssl 
       FROM connections WHERE id = :connectionId`,
      {
        replacements: { connectionId },
        type: QueryTypes.SELECT,
      }
    );
    
    if (!connectionRow) {
      logger.error(`[DB_OPS] Connection not found: ${connectionId}`);
      return null;
    }
    
    // Decrypt password
    const password = decrypt(connectionRow.password_enc);
    
    // Create connection to user's database
    const userDB = new Sequelize({
      dialect: 'postgres',
      host: connectionRow.host,
      port: connectionRow.port,
      database: connectionRow.db_name,
      username: connectionRow.username,
      password,
      ssl: connectionRow.ssl,
      dialectOptions: connectionRow.ssl ? {
        ssl: { require: true, rejectUnauthorized: false }
      } : {},
      logging: false,
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
    });
    
    await userDB.authenticate();
    return userDB;
  } catch (error: any) {
    logger.error(`[DB_OPS] Failed to create user DB connection: ${error.message}`);
    return null;
  }
}

/**
 * Build WHERE clause from filter conditions
 */
function buildWhereClause(filters: FilterCondition[]): { clause: string; replacements: Record<string, any> } {
  if (!filters || filters.length === 0) {
    return { clause: '', replacements: {} };
  }
  
  const conditions: string[] = [];
  const replacements: Record<string, any> = {};
  
  filters.forEach((filter, idx) => {
    const paramName = `filter_${idx}`;
    const quotedColumn = `"${filter.column}"`;
    
    switch (filter.operator) {
      case 'eq':
        conditions.push(`${quotedColumn} = :${paramName}`);
        replacements[paramName] = filter.value;
        break;
      case 'neq':
        conditions.push(`${quotedColumn} != :${paramName}`);
        replacements[paramName] = filter.value;
        break;
      case 'gt':
        conditions.push(`${quotedColumn} > :${paramName}`);
        replacements[paramName] = filter.value;
        break;
      case 'gte':
        conditions.push(`${quotedColumn} >= :${paramName}`);
        replacements[paramName] = filter.value;
        break;
      case 'lt':
        conditions.push(`${quotedColumn} < :${paramName}`);
        replacements[paramName] = filter.value;
        break;
      case 'lte':
        conditions.push(`${quotedColumn} <= :${paramName}`);
        replacements[paramName] = filter.value;
        break;
      case 'like':
        conditions.push(`${quotedColumn} LIKE :${paramName}`);
        replacements[paramName] = `%${filter.value}%`;
        break;
      case 'ilike':
        conditions.push(`${quotedColumn} ILIKE :${paramName}`);
        replacements[paramName] = `%${filter.value}%`;
        break;
      case 'in':
        conditions.push(`${quotedColumn} IN (:${paramName})`);
        replacements[paramName] = filter.value;
        break;
      case 'is_null':
        conditions.push(`${quotedColumn} IS NULL`);
        break;
      case 'is_not_null':
        conditions.push(`${quotedColumn} IS NOT NULL`);
        break;
    }
  });
  
  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    replacements,
  };
}

/**
 * Sanitize identifier (table/column names) to prevent SQL injection
 */
function sanitizeIdentifier(identifier: string): string {
  // Only allow alphanumeric, underscore, and ensure it doesn't start with a number
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

// ============================================
// JOB PROCESSORS
// ============================================

/**
 * Process SELECT query job
 */
async function processSelectQuery(job: Job<SelectQueryJobData>): Promise<SelectQueryResult> {
  const { connectionId, schemaName, tableName, columns, page, pageSize, sortBy, sortOrder, filters } = job.data;
  
  logger.info(`[DB_OPS] Processing SELECT for ${schemaName}.${tableName}`);
  job.updateProgress(10);
  
  const userDB = await createUserDBConnection(connectionId);
  if (!userDB) {
    throw new Error('Failed to connect to database');
  }
  
  try {
    job.updateProgress(30);
    
    // Build column list
    const columnList = columns && columns.length > 0 
      ? columns.map(c => sanitizeIdentifier(c)).join(', ')
      : '*';
    
    // Build WHERE clause
    const { clause: whereClause, replacements } = buildWhereClause(filters || []);
    
    // Build ORDER BY
    const orderClause = sortBy 
      ? `ORDER BY ${sanitizeIdentifier(sortBy)} ${sortOrder === 'DESC' ? 'DESC' : 'ASC'}`
      : '';
    
    // Calculate offset
    const offset = (page - 1) * pageSize;
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM ${sanitizeIdentifier(schemaName)}.${sanitizeIdentifier(tableName)} ${whereClause}`;
    const [countResult] = await userDB.query<any>(countQuery, {
      replacements,
      type: QueryTypes.SELECT,
    });
    const totalCount = parseInt(countResult?.total || '0', 10);
    
    job.updateProgress(60);
    
    // Get data
    const dataQuery = `
      SELECT ${columnList} 
      FROM ${sanitizeIdentifier(schemaName)}.${sanitizeIdentifier(tableName)}
      ${whereClause}
      ${orderClause}
      LIMIT :limit OFFSET :offset
    `;
    
    const rows = await userDB.query<any>(dataQuery, {
      replacements: { ...replacements, limit: pageSize, offset },
      type: QueryTypes.SELECT,
    });
    
    job.updateProgress(90);
    
    // Get column names from first row or metadata
    const resultColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
    
    return {
      rows,
      totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
      columns: resultColumns,
    };
  } finally {
    await userDB.close();
    job.updateProgress(100);
  }
}

/**
 * Process UPDATE row job
 */
async function processUpdateRow(job: Job<UpdateRowJobData>): Promise<MutationResult> {
  const { connectionId, schemaName, tableName, primaryKeyColumn, primaryKeyValue, updates } = job.data;
  
  logger.info(`[DB_OPS] Processing UPDATE for ${schemaName}.${tableName} where ${primaryKeyColumn}=${primaryKeyValue}`);
  job.updateProgress(10);
  
  const userDB = await createUserDBConnection(connectionId);
  if (!userDB) {
    throw new Error('Failed to connect to database');
  }
  
  try {
    job.updateProgress(30);
    
    // Build SET clause
    const setClauses: string[] = [];
    const replacements: Record<string, any> = {};
    
    updates.forEach((update, idx) => {
      const paramName = `val_${idx}`;
      setClauses.push(`${sanitizeIdentifier(update.column)} = :${paramName}`);
      replacements[paramName] = update.value;
    });
    
    replacements['pkValue'] = primaryKeyValue;
    
    const updateQuery = `
      UPDATE ${sanitizeIdentifier(schemaName)}.${sanitizeIdentifier(tableName)}
      SET ${setClauses.join(', ')}
      WHERE ${sanitizeIdentifier(primaryKeyColumn)} = :pkValue
    `;
    
    job.updateProgress(60);
    
    const [, affectedRows] = await userDB.query(updateQuery, {
      replacements,
      type: QueryTypes.UPDATE,
    });
    
    job.updateProgress(90);
    
    // Invalidate cache for this table
    const cacheKey = `connection:${connectionId}:data:${schemaName}:${tableName}:*`;
    const redis = getRedisClient();
    const keys = await redis.keys(cacheKey);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    return {
      success: true,
      affectedRows: affectedRows || 0,
      message: `Updated ${affectedRows || 0} row(s)`,
    };
  } finally {
    await userDB.close();
    job.updateProgress(100);
  }
}

/**
 * Process INSERT row job
 */
async function processInsertRow(job: Job<InsertRowJobData>): Promise<MutationResult> {
  const { connectionId, schemaName, tableName, values } = job.data;
  
  logger.info(`[DB_OPS] Processing INSERT for ${schemaName}.${tableName}`);
  job.updateProgress(10);
  
  const userDB = await createUserDBConnection(connectionId);
  if (!userDB) {
    throw new Error('Failed to connect to database');
  }
  
  try {
    job.updateProgress(30);
    
    const columns = Object.keys(values).map(c => sanitizeIdentifier(c)).join(', ');
    const paramNames = Object.keys(values).map((_, idx) => `:val_${idx}`).join(', ');
    const replacements: Record<string, any> = {};
    
    Object.values(values).forEach((val, idx) => {
      replacements[`val_${idx}`] = val;
    });
    
    const insertQuery = `
      INSERT INTO ${sanitizeIdentifier(schemaName)}.${sanitizeIdentifier(tableName)} (${columns})
      VALUES (${paramNames})
    `;
    
    job.updateProgress(60);
    
    await userDB.query(insertQuery, {
      replacements,
      type: QueryTypes.INSERT,
    });
    
    job.updateProgress(90);
    
    // Invalidate cache
    const redis = getRedisClient();
    const keys = await redis.keys(`connection:${connectionId}:data:${schemaName}:${tableName}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    return {
      success: true,
      affectedRows: 1,
      message: 'Row inserted successfully',
    };
  } finally {
    await userDB.close();
    job.updateProgress(100);
  }
}

/**
 * Process DELETE row job
 */
async function processDeleteRow(job: Job<DeleteRowJobData>): Promise<MutationResult> {
  const { connectionId, schemaName, tableName, primaryKeyColumn, primaryKeyValue } = job.data;
  
  logger.info(`[DB_OPS] Processing DELETE for ${schemaName}.${tableName} where ${primaryKeyColumn}=${primaryKeyValue}`);
  job.updateProgress(10);
  
  const userDB = await createUserDBConnection(connectionId);
  if (!userDB) {
    throw new Error('Failed to connect to database');
  }
  
  try {
    job.updateProgress(30);
    
    const deleteQuery = `
      DELETE FROM ${sanitizeIdentifier(schemaName)}.${sanitizeIdentifier(tableName)}
      WHERE ${sanitizeIdentifier(primaryKeyColumn)} = :pkValue
    `;
    
    job.updateProgress(60);
    
    const result = await userDB.query(deleteQuery, {
      replacements: { pkValue: primaryKeyValue },
      type: QueryTypes.RAW,
    });
    
    // Extract affected rows from metadata
    const affectedRows = Array.isArray(result) && result[1] ? (result[1] as any).rowCount || 1 : 1;
    
    job.updateProgress(90);
    
    // Invalidate cache
    const redis = getRedisClient();
    const keys = await redis.keys(`connection:${connectionId}:data:${schemaName}:${tableName}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    return {
      success: true,
      affectedRows,
      message: `Deleted row(s)`,
    };
  } finally {
    await userDB.close();
    job.updateProgress(100);
  }
}

/**
 * Process raw SQL query job (for AI-generated queries)
 */
async function processExecuteRawSQL(job: Job<ExecuteRawSQLJobData>): Promise<any> {
  const { connectionId, query, parameters, readOnly } = job.data;
  
  logger.info(`[DB_OPS] Processing RAW SQL for connection: ${connectionId}`);
  job.updateProgress(10);
  
  // Security check for read-only mode
  if (readOnly) {
    const upperQuery = query.trim().toUpperCase();
    if (!upperQuery.startsWith('SELECT') && !upperQuery.startsWith('WITH')) {
      throw new Error('Only SELECT queries allowed in read-only mode');
    }
    
    // Check for dangerous keywords
    const dangerousKeywords = ['DROP', 'DELETE', 'TRUNCATE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'GRANT', 'REVOKE'];
    for (const keyword of dangerousKeywords) {
      if (upperQuery.includes(keyword)) {
        throw new Error(`Keyword "${keyword}" not allowed in read-only mode`);
      }
    }
  }
  
  const userDB = await createUserDBConnection(connectionId);
  if (!userDB) {
    throw new Error('Failed to connect to database');
  }
  
  try {
    job.updateProgress(30);
    
    const startTime = Date.now();
    const result = await userDB.query(query, {
      replacements: parameters,
      type: QueryTypes.SELECT,
    });
    const executionTime = Date.now() - startTime;
    
    job.updateProgress(90);
    
    return {
      success: true,
      rows: result,
      rowCount: Array.isArray(result) ? result.length : 0,
      executionTime,
    };
  } finally {
    await userDB.close();
    job.updateProgress(100);
  }
}

// ============================================
// WORKER CREATION
// ============================================

/**
 * Create and start the DB operations worker
 */
export function createDBOperationsWorker(): Worker<DBOperationJobData> {
  const worker = new Worker<DBOperationJobData>(
    QUEUE_NAMES.DB_OPERATIONS,
    async (job: Job<DBOperationJobData>) => {
      logger.info(`[DB_OPS] Processing job ${job.id} - Type: ${job.data.type}`);
      
      try {
        switch (job.data.type) {
          case DB_OPERATION_JOBS.SELECT_QUERY:
            return await processSelectQuery(job as Job<SelectQueryJobData>);
          
          case DB_OPERATION_JOBS.UPDATE_ROW:
            return await processUpdateRow(job as Job<UpdateRowJobData>);
          
          case DB_OPERATION_JOBS.INSERT_ROW:
            return await processInsertRow(job as Job<InsertRowJobData>);
          
          case DB_OPERATION_JOBS.DELETE_ROW:
            return await processDeleteRow(job as Job<DeleteRowJobData>);
          
          case DB_OPERATION_JOBS.EXECUTE_RAW_SQL:
            return await processExecuteRawSQL(job as Job<ExecuteRawSQLJobData>);
          
          default:
            throw new Error(`Unknown job type: ${(job.data as any).type}`);
        }
      } catch (error: any) {
        logger.error(`[DB_OPS] Job ${job.id} failed:`, error);
        throw error;
      }
    },
    {
      connection: bullMQConnection,
      concurrency: WORKER_CONCURRENCY.DB_OPERATIONS,
      limiter: WORKER_RATE_LIMITS.DB_OPERATIONS,
    }
  );
  
  worker.on('completed', (job) => {
    logger.info(`[DB_OPS] Job ${job.id} completed successfully`);
  });
  
  worker.on('failed', (job, err) => {
    logger.error(`[DB_OPS] Job ${job?.id} failed:`, err);
  });
  
  worker.on('error', (err) => {
    logger.error('[DB_OPS] Worker error:', err);
  });
  
  logger.info('[DB_OPS] Worker started');
  return worker;
}

// ============================================
// WAIT FOR JOB RESULT (Synchronous API helper)
// ============================================

/**
 * Wait for a job to complete and return its result
 * Useful for API endpoints that need to return data immediately
 */
export async function waitForJobResult<T>(job: Job<DBOperationJobData>, timeoutMs: number = 30000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Job timed out'));
    }, timeoutMs);
    
    const checkInterval = setInterval(async () => {
      try {
        // Get a fresh copy of the job to get latest state and return value
        const freshJob = await Job.fromId(dbOperationsQueue, job.id!);
        
        if (!freshJob) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          reject(new Error('Job not found'));
          return;
        }
        
        const state = await freshJob.getState();
        logger.debug(`[DB_OPS] Checking job ${job.id} state: ${state}`);
        
        if (state === 'completed') {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          // returnvalue is the synchronous property containing the result
          const result = freshJob.returnvalue;
          logger.debug(`[DB_OPS] Job ${job.id} returnvalue:`, JSON.stringify(result)?.substring(0, 200));
          resolve(result as T);
        } else if (state === 'failed') {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          const failedReason = freshJob.failedReason;
          reject(new Error(failedReason || 'Job failed'));
        }
      } catch (err) {
        logger.error(`[DB_OPS] Error checking job state:`, err);
      }
    }, 100); // Check every 100ms
  });
}

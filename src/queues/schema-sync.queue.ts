import { Queue, Worker, Job } from 'bullmq';
import { Sequelize, QueryTypes } from 'sequelize';
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
import { sequelize } from '../config/db';
import { decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';
import { TableColumnDef, IndexDef } from '../types';
import { setCache, CACHE_TTL, CACHE_KEYS, invalidateConnectionsListCache, invalidateViewerCache } from '../utils/cache';

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
// CACHE WARMING - Pre-populate cache after sync
// ============================================

/**
 * Warm the cache with schema data after sync completes
 * This pre-populates commonly accessed data for faster subsequent requests:
 * - Schema list
 * - Full table data per schema (with columns, indexes, etc.)
 * - Lightweight table-tree (all schemas → table names, for sidebar)
 * - ERD relations
 * Also invalidates stale viewer caches so viewers get fresh data on next request
 */
async function warmSchemaCache(connectionId: string, userId: string): Promise<void> {
  try {
    logger.info(`[CACHE_WARM] Starting cache warming for connection ${connectionId}`);

    // Fetch schemas from the app DB (these were just written by the sync worker)
    const schemas = await sequelize.query<{ id: string; schema_name: string; is_selected: boolean; table_count: number; description: string | null; last_synced_at: string }>(
      `SELECT id, schema_name, is_selected, table_count, description, last_synced_at
       FROM database_schemas 
       WHERE connection_id = $1 
       ORDER BY CASE WHEN schema_name = 'public' THEN 0 ELSE 1 END, schema_name`,
      { bind: [connectionId], type: QueryTypes.SELECT }
    );
    
    await setCache(
      CACHE_KEYS.schemas(connectionId),
      schemas,
      CACHE_TTL.SCHEMAS
    );
    logger.debug(`[CACHE_WARM] Cached ${schemas.length} schemas for connection ${connectionId}`);

    // Build table-tree (lightweight: schema → table names only) AND full table caches
    const tableTree: Array<{ schema_name: string; table_count: number; tables: Array<{ table_name: string; table_type: string }> }> = [];

    for (const schema of schemas) {
      // Full table data (columns, indexes, PKs) for per-schema cache
      const fullTables = await sequelize.query(
        `SELECT id, connection_id, database_schema_id, schema_name, table_name, table_type,
                columns, primary_key_columns, indexes, row_count, table_size_bytes,
                description, last_fetched_at, created_at, updated_at
         FROM table_schemas
         WHERE connection_id = $1 AND schema_name = $2
         ORDER BY table_name`,
        { bind: [connectionId, schema.schema_name], type: QueryTypes.SELECT }
      );
      
      // Cache full table data per schema (used by getTablesBySchema endpoint)
      await setCache(
        CACHE_KEYS.tables(connectionId, schema.schema_name),
        fullTables,
        CACHE_TTL.TABLES
      );

      // Build lightweight tree entry (sidebar only needs name + type)
      tableTree.push({
        schema_name: schema.schema_name,
        table_count: (fullTables as any[]).length,
        tables: (fullTables as any[]).map((t: any) => ({
          table_name: t.table_name,
          table_type: t.table_type,
        })),
      });
    }
    logger.debug(`[CACHE_WARM] Cached tables for all schemas`);

    // Cache the lightweight table-tree (single key for entire sidebar)
    await setCache(
      CACHE_KEYS.tableTree(connectionId),
      tableTree,
      CACHE_TTL.TABLES
    );
    logger.debug(`[CACHE_WARM] Cached table-tree with ${tableTree.length} schemas`);

    // Fetch and cache ERD relations
    const erdRelations = await sequelize.query(
      `SELECT er.*
       FROM erd_relations er
       WHERE er.connection_id = $1`,
      { bind: [connectionId], type: QueryTypes.SELECT }
    );
    
    await setCache(
      CACHE_KEYS.erdRelations(connectionId),
      erdRelations,
      CACHE_TTL.ERD_RELATIONS
    );
    logger.debug(`[CACHE_WARM] Cached ${erdRelations.length} ERD relations`);

    // Invalidate viewer-specific caches so viewers get fresh data on next request
    await invalidateViewerCache(userId, connectionId);

    // Invalidate connections list cache since schema_synced status changed
    await invalidateConnectionsListCache(userId);

    logger.info(`[CACHE_WARM] Cache warming completed for connection ${connectionId}`);
  } catch (error) {
    logger.warn(`[CACHE_WARM] Failed to warm cache for connection ${connectionId}:`, error);
    // Don't throw - cache warming failure shouldn't fail the sync job
  }
}

// ============================================
// WORKER (Job Processor) - Full Implementation
// ============================================

/**
 * Create a temporary Sequelize connection to user's external database
 */
const createUserDbConnection = (config: {
  host: string;
  port: number;
  db_name: string;
  username: string;
  password: string;
  ssl: boolean;
}): Sequelize => {
  return new Sequelize({
    dialect: 'postgres',
    host: config.host,
    port: config.port,
    database: config.db_name,
    username: config.username,
    password: config.password,
    ssl: config.ssl,
    dialectOptions: config.ssl ? {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    } : {},
    logging: false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });
};

/**
 * Fetch connection details from our database
 */
async function fetchConnectionDetails(connectionId: string): Promise<{
  id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  db_name: string;
  username: string;
  password_enc: string;
  ssl: boolean;
} | null> {
  const result = await sequelize.query<{
    id: string;
    user_id: string;
    name: string;
    host: string;
    port: number;
    db_name: string;
    username: string;
    password_enc: string;
    ssl: boolean;
  }>(
    `SELECT id, user_id, name, host, port, db_name, username, password_enc, ssl 
     FROM connections WHERE id = $1`,
    {
      bind: [connectionId],
      type: QueryTypes.SELECT
    }
  );
  
  return result[0] || null;
}

/**
 * Fetch all schemas from user's database
 */
async function fetchSchemas(userDb: Sequelize): Promise<string[]> {
  const schemas = await userDb.query<{ schema_name: string }>(
    `SELECT schema_name 
     FROM information_schema.schemata 
     WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
     ORDER BY schema_name`,
    { type: QueryTypes.SELECT }
  );
  
  return schemas.map(s => s.schema_name);
}

/**
 * Fetch all tables for a schema from user's database
 */
async function fetchTablesForSchema(userDb: Sequelize, schemaName: string): Promise<Array<{
  table_name: string;
  table_type: string;
}>> {
  const tables = await userDb.query<{
    table_name: string;
    table_type: string;
  }>(
    `SELECT table_name, table_type 
     FROM information_schema.tables 
     WHERE table_schema = $1 
       AND table_type IN ('BASE TABLE', 'VIEW')
     ORDER BY table_name`,
    {
      bind: [schemaName],
      type: QueryTypes.SELECT
    }
  );
  
  return tables;
}

/**
 * Fetch columns for a table
 */
async function fetchColumnsForTable(userDb: Sequelize, schemaName: string, tableName: string): Promise<TableColumnDef[]> {
  // Get column info
  const columns = await userDb.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    character_maximum_length: number | null;
    numeric_precision: number | null;
  }>(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default, 
            character_maximum_length, numeric_precision
     FROM information_schema.columns 
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    {
      bind: [schemaName, tableName],
      type: QueryTypes.SELECT
    }
  );

  // Get primary key columns
  const pkResult = await userDb.query<{ column_name: string }>(
    `SELECT a.attname as column_name
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE i.indisprimary = true
       AND n.nspname = $1
       AND c.relname = $2`,
    {
      bind: [schemaName, tableName],
      type: QueryTypes.SELECT
    }
  );
  const pkColumns = new Set(pkResult.map(r => r.column_name));

  // Get foreign key info
  const fkResult = await userDb.query<{
    column_name: string;
    foreign_table_schema: string;
    foreign_table_name: string;
    foreign_column_name: string;
  }>(
    `SELECT 
       kcu.column_name,
       ccu.table_schema AS foreign_table_schema,
       ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name
     FROM information_schema.table_constraints AS tc
     JOIN information_schema.key_column_usage AS kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage AS ccu
       ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = $1
       AND tc.table_name = $2`,
    {
      bind: [schemaName, tableName],
      type: QueryTypes.SELECT
    }
  );
  const fkMap = new Map(fkResult.map(fk => [fk.column_name, {
    table: fk.foreign_table_name,
    column: fk.foreign_column_name,
    schema: fk.foreign_table_schema
  }]));

  // Get enum values for USER-DEFINED enum columns
  const enumUdtNames = columns
    .filter(col => col.data_type === 'USER-DEFINED')
    .map(col => col.udt_name);

  const enumMap = new Map<string, string[]>();

  if (enumUdtNames.length > 0) {
    // Deduplicate type names (multiple columns may share the same enum type)
    const uniqueUdtNames = [...new Set(enumUdtNames)];

    const enumResult = await userDb.query<{
      typname: string;
      enumlabel: string;
    }>(
      `SELECT t.typname, e.enumlabel
       FROM pg_enum e
       JOIN pg_type t ON e.enumtypid = t.oid
       WHERE t.typname = ANY($1)
       ORDER BY t.typname, e.enumsortorder`,
      {
        bind: [uniqueUdtNames],
        type: QueryTypes.SELECT
      }
    );

    for (const row of enumResult) {
      if (!enumMap.has(row.typname)) {
        enumMap.set(row.typname, []);
      }
      enumMap.get(row.typname)!.push(row.enumlabel);
    }
  }

  return columns.map(col => ({
    name: col.column_name,
    data_type: col.character_maximum_length 
      ? `${col.data_type}(${col.character_maximum_length})`
      : col.data_type,
    udt_name: col.udt_name,
    is_nullable: col.is_nullable === 'YES',
    is_primary_key: pkColumns.has(col.column_name),
    is_foreign_key: fkMap.has(col.column_name),
    foreign_key_ref: fkMap.get(col.column_name),
    default_value: col.column_default || undefined,
    max_length: col.character_maximum_length || undefined,
    numeric_precision: col.numeric_precision || undefined,
    enum_values: enumMap.get(col.udt_name) || undefined,
  }));
}

/**
 * Fetch indexes for a table
 */
async function fetchIndexesForTable(userDb: Sequelize, schemaName: string, tableName: string): Promise<IndexDef[]> {
  const indexes = await userDb.query<{
    index_name: string;
    column_name: string;
    is_unique: boolean;
    is_primary: boolean;
    index_type: string;
  }>(
    `SELECT 
       i.relname AS index_name,
       a.attname AS column_name,
       ix.indisunique AS is_unique,
       ix.indisprimary AS is_primary,
       am.amname AS index_type
     FROM pg_class t
     JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN pg_index ix ON t.oid = ix.indrelid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_am am ON i.relam = am.oid
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
     WHERE n.nspname = $1
       AND t.relname = $2
     ORDER BY i.relname, a.attnum`,
    {
      bind: [schemaName, tableName],
      type: QueryTypes.SELECT
    }
  );

  // Group by index name
  const indexMap = new Map<string, IndexDef>();
  for (const idx of indexes) {
    if (!indexMap.has(idx.index_name)) {
      indexMap.set(idx.index_name, {
        name: idx.index_name,
        columns: [],
        is_unique: idx.is_unique,
        is_primary: idx.is_primary,
        type: idx.index_type
      });
    }
    indexMap.get(idx.index_name)!.columns.push(idx.column_name);
  }

  return Array.from(indexMap.values());
}

/**
 * Fetch foreign key relationships for all tables in schema
 */
async function fetchRelationsForSchema(userDb: Sequelize, schemaName: string): Promise<Array<{
  constraint_name: string;
  source_table: string;
  source_column: string;
  target_schema: string;
  target_table: string;
  target_column: string;
}>> {
  const relations = await userDb.query<{
    constraint_name: string;
    source_table: string;
    source_column: string;
    target_schema: string;
    target_table: string;
    target_column: string;
  }>(
    `SELECT 
       tc.constraint_name,
       tc.table_name AS source_table,
       kcu.column_name AS source_column,
       ccu.table_schema AS target_schema,
       ccu.table_name AS target_table,
       ccu.column_name AS target_column
     FROM information_schema.table_constraints AS tc
     JOIN information_schema.key_column_usage AS kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage AS ccu
       ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = $1`,
    {
      bind: [schemaName],
      type: QueryTypes.SELECT
    }
  );

  return relations;
}

/**
 * Process full schema sync job
 */
async function processFullSchemaSync(
  job: Job<SyncFullSchemaJobData>,
  connection: NonNullable<Awaited<ReturnType<typeof fetchConnectionDetails>>>
): Promise<{ tablesProcessed: number; schemasProcessed: number }> {
  const { connectionId, userId } = job.data;
  
  // Decrypt password
  const password = decrypt(connection.password_enc);
  
  // Connect to user's database
  const userDb = createUserDbConnection({
    host: connection.host,
    port: connection.port,
    db_name: connection.db_name,
    username: connection.username,
    password,
    ssl: connection.ssl
  });

  try {
    await userDb.authenticate();
    logger.info(`[SCHEMA_SYNC_WORKER] Connected to user database: ${connection.db_name}`);

    // Fetch all schemas
    const schemas = await fetchSchemas(userDb);
    logger.info(`[SCHEMA_SYNC_WORKER] Found ${schemas.length} schemas`);

    await publishJobProgress(userId, {
      jobId: job.id!,
      type: 'schema-sync',
      connectionId,
      progress: 10,
      message: `Found ${schemas.length} schemas`,
      status: 'processing'
    });

    let totalTablesProcessed = 0;
    let progressPerSchema = 80 / Math.max(schemas.length, 1);
    let currentProgress = 10;

    for (let schemaIndex = 0; schemaIndex < schemas.length; schemaIndex++) {
      const schemaName = schemas[schemaIndex];
      
      // Upsert schema into database_schemas
      await sequelize.query(
        `INSERT INTO database_schemas (connection_id, schema_name, is_selected, last_synced_at)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT (connection_id, schema_name) 
         DO UPDATE SET last_synced_at = NOW(), updated_at = NOW()
         RETURNING id`,
        {
          bind: [connectionId, schemaName],
          type: QueryTypes.INSERT
        }
      );

      // Fetch tables for this schema
      const tables = await fetchTablesForSchema(userDb, schemaName);
      logger.info(`[SCHEMA_SYNC_WORKER] Schema ${schemaName}: found ${tables.length} tables`);

      // Update table_count in database_schemas
      await sequelize.query(
        `UPDATE database_schemas SET table_count = $1 WHERE connection_id = $2 AND schema_name = $3`,
        { bind: [tables.length, connectionId, schemaName], type: QueryTypes.UPDATE }
      );

      // Process each table
      for (const table of tables) {
        const columns = await fetchColumnsForTable(userDb, schemaName, table.table_name);
        const indexes = await fetchIndexesForTable(userDb, schemaName, table.table_name);
        const pkColumns = columns.filter(c => c.is_primary_key).map(c => c.name);

        // Get database_schema_id
        const dbSchemaResult = await sequelize.query<{ id: string }>(
          `SELECT id FROM database_schemas WHERE connection_id = $1 AND schema_name = $2`,
          { bind: [connectionId, schemaName], type: QueryTypes.SELECT }
        );
        const databaseSchemaId = dbSchemaResult[0]?.id;

        // Upsert table into table_schemas
        await sequelize.query(
          `INSERT INTO table_schemas 
             (connection_id, database_schema_id, schema_name, table_name, table_type, columns, primary_key_columns, indexes, last_fetched_at)
           VALUES 
             ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, NOW())
           ON CONFLICT (connection_id, schema_name, table_name) 
           DO UPDATE SET 
             database_schema_id = EXCLUDED.database_schema_id,
             table_type = EXCLUDED.table_type,
             columns = EXCLUDED.columns,
             primary_key_columns = EXCLUDED.primary_key_columns,
             indexes = EXCLUDED.indexes,
             last_fetched_at = NOW(),
             updated_at = NOW()`,
          {
            bind: [
              connectionId,
              databaseSchemaId,
              schemaName,
              table.table_name,
              table.table_type,
              JSON.stringify(columns),
              JSON.stringify(pkColumns),
              JSON.stringify(indexes)
            ],
            type: QueryTypes.INSERT
          }
        );

        totalTablesProcessed++;
      }

      // Fetch and store relations for this schema
      const relations = await fetchRelationsForSchema(userDb, schemaName);
      for (const rel of relations) {
        await sequelize.query(
          `INSERT INTO erd_relations 
             (connection_id, source_schema, source_table, source_column, target_schema, target_table, target_column, constraint_name)
           VALUES 
             ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (connection_id, source_schema, source_table, source_column, target_table, target_column) 
           DO UPDATE SET 
             constraint_name = EXCLUDED.constraint_name`,
          {
            bind: [
              connectionId,
              schemaName,
              rel.source_table,
              rel.source_column,
              rel.target_schema,
              rel.target_table,
              rel.target_column,
              rel.constraint_name
            ],
            type: QueryTypes.INSERT
          }
        );
      }

      currentProgress += progressPerSchema;
      await job.updateProgress(Math.round(currentProgress));
      
      await publishJobProgress(userId, {
        jobId: job.id!,
        type: 'schema-sync',
        connectionId,
        schemaName,
        progress: Math.round(currentProgress),
        message: `Processed schema ${schemaName} (${tables.length} tables)`,
        status: 'processing'
      });
    }

    // Update connection as synced
    await sequelize.query(
      `UPDATE connections SET schema_synced = true, schema_synced_at = NOW(), updated_at = NOW() WHERE id = $1`,
      { bind: [connectionId], type: QueryTypes.UPDATE }
    );

    await job.updateProgress(100);
    
    return {
      tablesProcessed: totalTablesProcessed,
      schemasProcessed: schemas.length
    };

  } finally {
    await userDb.close();
    logger.debug(`[SCHEMA_SYNC_WORKER] Closed connection to user database`);
  }
}

export function createSchemaSyncWorker(): Worker<SchemaSyncJobData> {
  const worker = new Worker<SchemaSyncJobData>(
    QUEUE_NAMES.SCHEMA_SYNC,
    async (job: Job<SchemaSyncJobData>) => {
      logger.info(`[SCHEMA_SYNC_WORKER] Processing job ${job.id}`, { type: job.data.type });
      
      const { type, connectionId, userId } = job.data;

      try {
        // Fetch connection from DB
        const connection = await fetchConnectionDetails(connectionId);
        if (!connection) {
          throw new Error(`Connection ${connectionId} not found`);
        }

        switch (type) {
          case SCHEMA_SYNC_JOBS.SYNC_FULL_SCHEMA: {
            await publishJobProgress(userId, {
              jobId: job.id!,
              type: 'schema-sync',
              connectionId,
              progress: 0,
              message: 'Starting full schema sync...',
              status: 'processing',
            });
            
            const result = await processFullSchemaSync(job as Job<SyncFullSchemaJobData>, connection);
            
            // Warm the cache with new schema data
            await warmSchemaCache(connectionId, userId);
            
            await publishJobComplete(userId, job.id!, connectionId, true);
            
            logger.info(`[SCHEMA_SYNC_WORKER] Full schema sync completed`, {
              connectionId,
              schemasProcessed: result.schemasProcessed,
              tablesProcessed: result.tablesProcessed
            });
            
            return { 
              success: true, 
              message: `Schema sync completed: ${result.schemasProcessed} schemas, ${result.tablesProcessed} tables`,
              ...result
            };
          }

          case SCHEMA_SYNC_JOBS.SYNC_SINGLE_SCHEMA:
            // TODO: Implement single schema sync
            logger.info(`[SCHEMA_SYNC_WORKER] Single schema sync - Not fully implemented yet`);
            return { success: true, message: 'Single schema sync placeholder' };

          case SCHEMA_SYNC_JOBS.SYNC_SINGLE_TABLE:
            // TODO: Implement single table sync
            logger.info(`[SCHEMA_SYNC_WORKER] Single table sync - Not fully implemented yet`);
            return { success: true, message: 'Single table sync placeholder' };

          case SCHEMA_SYNC_JOBS.REFRESH_SCHEMA:
            // Refresh is same as full sync but we don't delete existing data first
            logger.info(`[SCHEMA_SYNC_WORKER] Refresh schema - Using full sync`);
            const refreshResult = await processFullSchemaSync(job as Job<SyncFullSchemaJobData>, connection);
            
            // Warm the cache with refreshed schema data
            await warmSchemaCache(connectionId, userId);
            
            await publishJobComplete(userId, job.id!, connectionId, true);
            return { 
              success: true, 
              message: `Schema refresh completed: ${refreshResult.schemasProcessed} schemas, ${refreshResult.tablesProcessed} tables`,
              ...refreshResult
            };

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

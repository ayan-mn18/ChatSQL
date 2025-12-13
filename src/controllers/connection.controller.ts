import { Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { logger } from '../utils/logger';
import { sequelize } from '../config/db';
import { encrypt, decrypt } from '../utils/encryption';
import { addSyncFullSchemaJob, cancelJobsForConnection } from '../queues/schema-sync.queue';
import { getRedisClient } from '../config/redis';
import { 
  TestConnectionRequest, 
  TestConnectionResponse,
  CreateConnectionRequest,
  UpdateConnectionRequest,
  ConnectionPublic,
  ApiResponse
} from '../types';

// ============================================
// CONNECTION CONTROLLER
// Handles all database connection CRUD operations
// ============================================

/**
 * Create a temporary Sequelize instance for testing connections
 */
const createTempConnection = (config: TestConnectionRequest): Sequelize => {
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
        rejectUnauthorized: false // Allow self-signed certs
      }
    } : {},
    logging: false,
    pool: {
      max: 1,
      min: 0,
      acquire: 10000, // 10 second timeout
      idle: 1000
    }
  });
};

/**
 * Map PostgreSQL error codes to user-friendly messages
 */
const mapPgError = (error: any): { message: string; code: string } => {
  const pgCode = error.parent?.code || error.original?.code;
  
  switch (pgCode) {
    case '28P01': // Invalid password
    case '28000': // Invalid authorization specification
      return {
        message: 'Authentication failed. Please check your username and password.',
        code: 'AUTH_FAILED'
      };
    case '3D000': // Database does not exist
      return {
        message: `Database "${error.parent?.message?.match(/"([^"]+)"/)?.[1] || 'specified'}" does not exist.`,
        code: 'DATABASE_NOT_FOUND'
      };
    case 'ENOTFOUND': // DNS resolution failed
    case 'EAI_AGAIN':
      return {
        message: 'Could not resolve the host address. Please verify the hostname.',
        code: 'HOST_NOT_FOUND'
      };
    case 'ECONNREFUSED':
      return {
        message: 'Connection refused. Please check if the database server is running and the port is correct.',
        code: 'CONNECTION_REFUSED'
      };
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return {
        message: 'Connection timed out. The server might be unreachable or behind a firewall.',
        code: 'CONNECTION_TIMEOUT'
      };
    case 'EHOSTUNREACH':
      return {
        message: 'Host is unreachable. Please check your network connection and firewall settings.',
        code: 'HOST_UNREACHABLE'
      };
    case '42501': // Insufficient privilege
      return {
        message: 'User does not have sufficient privileges to connect.',
        code: 'INSUFFICIENT_PRIVILEGES'
      };
    case '53300': // Too many connections
      return {
        message: 'Too many connections to the database. Please try again later.',
        code: 'TOO_MANY_CONNECTIONS'
      };
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return {
        message: 'SSL certificate verification failed. Try enabling SSL with self-signed certificate support.',
        code: 'SSL_CERT_ERROR'
      };
    default:
      // Check error name/message for common patterns
      if (error.name === 'SequelizeConnectionRefusedError') {
        return {
          message: 'Connection refused. Please check if the database server is running and the port is correct.',
          code: 'CONNECTION_REFUSED'
        };
      }
      if (error.name === 'SequelizeConnectionTimedOutError') {
        return {
          message: 'Connection timed out. The server might be unreachable or behind a firewall.',
          code: 'CONNECTION_TIMEOUT'
        };
      }
      if (error.name === 'SequelizeHostNotFoundError') {
        return {
          message: 'Could not resolve the host address. Please verify the hostname.',
          code: 'HOST_NOT_FOUND'
        };
      }
      if (error.name === 'SequelizeAccessDeniedError') {
        return {
          message: 'Authentication failed. Please check your username and password.',
          code: 'AUTH_FAILED'
        };
      }
      
      return {
        message: error.message || 'Failed to connect to the database.',
        code: 'CONNECTION_ERROR'
      };
  }
};

/**
 * @route   POST /api/connections/test
 * @desc    Test a database connection (without saving)
 * @access  Private
 * 
 * Tests the provided database credentials and returns:
 * - Connection success/failure
 * - Latency in milliseconds
 * - Available PostgreSQL schemas (if successful)
 */
export const testConnection = async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  let sequelize: Sequelize | null = null;
  
  try {
    const { host, port, db_name, username, password, ssl } = req.body as TestConnectionRequest;
    
    logger.info('[CONNECTION] Testing connection', {
      host,
      port,
      db_name,
      username,
      ssl: !!ssl
    });
    
    // Create temporary connection
    sequelize = createTempConnection({ host, port, db_name, username, password, ssl });
    
    // Test authentication
    await sequelize.authenticate();
    
    const latencyMs = Date.now() - startTime;
    logger.info(`[CONNECTION] Connection successful in ${latencyMs}ms`);
    
    // Fetch available schemas (excluding system schemas)
    const schemas = await sequelize.query<{ schema_name: string }>(
      `SELECT schema_name 
       FROM information_schema.schemata 
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       ORDER BY schema_name`,
      { type: QueryTypes.SELECT }
    );
    
    const schemaNames = schemas.map(s => s.schema_name);
    
    const response: TestConnectionResponse = {
      success: true,
      message: 'Connection successful',
      latency_ms: latencyMs,
      schemas: schemaNames
    };
    
    res.status(200).json(response);
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const mappedError = mapPgError(error);
    
    logger.warn('[CONNECTION] Connection test failed', {
      error: error.message,
      code: mappedError.code,
      latency_ms: latencyMs
    });
    
    const response: TestConnectionResponse = {
      success: false,
      message: mappedError.message,
      error: mappedError.message,
      code: mappedError.code,
      latency_ms: latencyMs
    };
    
    res.status(400).json(response);
  } finally {
    // Always close the connection
    if (sequelize) {
      try {
        await sequelize.close();
        logger.debug('[CONNECTION] Temporary connection closed');
      } catch (closeError) {
        logger.warn('[CONNECTION] Failed to close temporary connection', closeError);
      }
    }
  }
};

/**
 * @route   POST /api/connections
 * @desc    Create a new database connection
 * @access  Private
 * 
 * STEPS:
 * 1. Validate request body
 * 2. Test connection first (fail fast if can't connect)
 * 3. Encrypt password using AES-256
 * 4. Insert into `connections` table with user_id from JWT
 * 5. Queue async job to fetch schema metadata (tables, columns, relationships)
 * 6. Return connection object (WITHOUT password)
 * 
 * ASYNC JOB (triggered after save):
 * - Fetch all tables from information_schema
 * - Fetch all columns for each table
 * - Fetch foreign key relationships
 * - Store in table_schemas and erd_relations tables
 * - Update connection.schema_synced = true
 */
export const createConnection = async (req: Request, res: Response): Promise<void> => {
  let testSequelize: Sequelize | null = null;
  
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'UNAUTHORIZED'
      });
      return;
    }

    const { name, host, port, db_name, username, password, ssl = false } = req.body as CreateConnectionRequest;
    
    logger.info('[CONNECTION] Create connection request received', {
      userId,
      name,
      host,
      port,
      db_name,
      ssl
    });

    // Validate required fields
    if (!name || !host || !port || !db_name || !username || !password) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: name, host, port, db_name, username, password',
        code: 'VALIDATION_ERROR'
      });
      return;
    }

    // Check for duplicate connection name
    const existingConnection = await sequelize.query<{ id: string }>(
      `SELECT id FROM connections WHERE user_id = $1 AND name = $2`,
      {
        bind: [userId, name],
        type: QueryTypes.SELECT
      }
    );

    if (existingConnection.length > 0) {
      res.status(409).json({
        success: false,
        error: `A connection named "${name}" already exists`,
        code: 'DUPLICATE_CONNECTION_NAME'
      });
      return;
    }

    // Step 2: Test connection first (fail fast)
    logger.info('[CONNECTION] Testing connection before saving...');
    testSequelize = createTempConnection({ host, port, db_name, username, password, ssl });
    
    try {
      await testSequelize.authenticate();
      logger.info('[CONNECTION] Connection test successful');
    } catch (testError: any) {
      const mappedError = mapPgError(testError);
      logger.warn('[CONNECTION] Connection test failed, not saving', {
        error: mappedError.message,
        code: mappedError.code
      });
      
      res.status(400).json({
        success: false,
        error: mappedError.message,
        code: mappedError.code
      });
      return;
    } finally {
      if (testSequelize) {
        await testSequelize.close();
        testSequelize = null;
      }
    }

    // Step 3: Encrypt password
    const passwordEnc = encrypt(password);
    logger.debug('[CONNECTION] Password encrypted successfully');

    // Step 4: Insert into database
    const insertResult = await sequelize.query<ConnectionPublic>(
      `INSERT INTO connections 
        (user_id, name, host, port, type, db_name, username, password_enc, ssl, is_valid, last_tested_at)
       VALUES 
        ($1, $2, $3, $4, 'postgres', $5, $6, $7, $8, true, NOW())
       RETURNING 
        id, user_id, name, host, port, type, db_name, username, ssl, 
        is_valid, schema_synced, schema_synced_at, last_tested_at, created_at, updated_at`,
      {
        bind: [userId, name, host, port, db_name, username, passwordEnc, ssl],
        type: QueryTypes.SELECT  // Use SELECT for INSERT...RETURNING
      }
    );

    // Get the first row from the result
    const connection = insertResult[0] as ConnectionPublic;
    
    logger.info('[CONNECTION] Connection saved successfully', {
      connectionId: connection.id,
      name: connection.name
    });

    // Step 5: Queue schema sync job
    const job = await addSyncFullSchemaJob({
      connectionId: connection.id,
      userId,
      connectionName: name
    });

    logger.info('[CONNECTION] Schema sync job queued', {
      connectionId: connection.id,
      jobId: job.id
    });

    // Step 6: Return connection (without password)
    const response: ApiResponse<{ connection: ConnectionPublic; jobId: string | undefined }> = {
      success: true,
      message: 'Connection created successfully. Schema sync job queued.',
      data: {
        connection,
        jobId: job.id
      }
    };

    res.status(201).json(response);
  } catch (error: any) {
    logger.error('[CONNECTION] Create connection failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create connection',
      code: 'CONNECTION_CREATE_ERROR'
    });
  }
};

/**
 * @route   GET /api/connections
 * @desc    Get all connections for the authenticated user
 * @access  Private
 * 
 * STEPS:
 * 1. Get user_id from JWT (req.userId)
 * 2. Query connections table WHERE user_id = $1
 * 3. Return list of connections (WITHOUT passwords)
 * 4. Include schema_synced status and last_tested_at
 */
export const getAllConnections = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'UNAUTHORIZED'
      });
      return;
    }

    logger.info('[CONNECTION] Get all connections request', { userId });

    const connections = await sequelize.query<ConnectionPublic>(
      `SELECT id, user_id, name, host, port, type, db_name, username, ssl,
              is_valid, schema_synced, schema_synced_at, last_tested_at, 
              created_at, updated_at
       FROM connections
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      {
        bind: [userId],
        type: QueryTypes.SELECT
      }
    );

    logger.info(`[CONNECTION] Found ${connections.length} connections for user`, { userId });

    res.status(200).json({
      success: true,
      data: connections,
      count: connections.length
    });
  } catch (error: any) {
    logger.error('[CONNECTION] Get all connections failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get connections',
      code: 'CONNECTION_FETCH_ERROR'
    });
  }
};

/**
 * @route   GET /api/connections/:id
 * @desc    Get a single connection by ID
 * @access  Private
 * 
 * STEPS:
 * 1. Get connection_id from params
 * 2. Get user_id from JWT
 * 3. Query connection WHERE id = $1 AND user_id = $2
 * 4. Return 404 if not found or not owned by user
 * 5. Return connection (WITHOUT password)
 */
export const getConnectionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'UNAUTHORIZED'
      });
      return;
    }

    if (!id) {
      res.status(400).json({
        success: false,
        error: 'Connection ID is required',
        code: 'VALIDATION_ERROR'
      });
      return;
    }

    logger.info('[CONNECTION] Get connection by ID request', { id, userId });

    const connections = await sequelize.query<ConnectionPublic>(
      `SELECT id, user_id, name, host, port, type, db_name, username, ssl,
              is_valid, schema_synced, schema_synced_at, last_tested_at, 
              created_at, updated_at
       FROM connections
       WHERE id = $1 AND user_id = $2`,
      {
        bind: [id, userId],
        type: QueryTypes.SELECT
      }
    );

    if (connections.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Connection not found',
        code: 'CONNECTION_NOT_FOUND'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: connections[0]
    });
  } catch (error: any) {
    logger.error('[CONNECTION] Get connection by ID failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get connection',
      code: 'CONNECTION_FETCH_ERROR'
    });
  }
};

/**
 * @route   PUT /api/connections/:id
 * @desc    Update an existing connection
 * @access  Private
 * 
 * STEPS:
 * 1. Get connection_id from params
 * 2. Get user_id from JWT
 * 3. Verify connection exists AND belongs to user
 * 4. If password is provided in update:
 *    - Re-test connection (fail if can't connect)
 *    - Re-encrypt new password
 * 5. If host/port/db_name changed:
 *    - Re-test connection (fail if can't connect)
 *    - Queue schema re-sync job
 * 6. Update connection in DB
 * 7. Return updated connection (WITHOUT password)
 * 
 * WHAT CAN BE UPDATED:
 * - name (display name) - no re-test needed
 * - host - needs re-test + schema re-sync
 * - port - needs re-test + schema re-sync
 * - db_name - needs re-test + schema re-sync
 * - username - needs re-test
 * - password - needs re-encrypt + re-test
 * - ssl options - needs re-test
 */
export const updateConnection = async (req: Request, res: Response): Promise<void> => {
  let testSequelize: Sequelize | null = null;
  
  try {
    const { id } = req.params;
    const userId = req.userId;
    
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'UNAUTHORIZED'
      });
      return;
    }

    if (!id) {
      res.status(400).json({
        success: false,
        error: 'Connection ID is required',
        code: 'VALIDATION_ERROR'
      });
      return;
    }

    const { name, host, port, db_name, username, password, ssl } = req.body as UpdateConnectionRequest;

    logger.info('[CONNECTION] Update connection request', { id, userId, name });

    // Fetch existing connection (including encrypted password for re-test)
    const existingConnections = await sequelize.query<{
      id: string;
      name: string;
      host: string;
      port: number;
      db_name: string;
      username: string;
      password_enc: string;
      ssl: boolean;
    }>(
      `SELECT id, name, host, port, db_name, username, password_enc, ssl
       FROM connections
       WHERE id = $1 AND user_id = $2`,
      {
        bind: [id, userId],
        type: QueryTypes.SELECT
      }
    );

    if (existingConnections.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Connection not found',
        code: 'CONNECTION_NOT_FOUND'
      });
      return;
    }

    const existing = existingConnections[0];
    
    // Check if connection-critical fields changed
    const connectionFieldsChanged = 
      (host !== undefined && host !== existing.host) ||
      (port !== undefined && port !== existing.port) ||
      (db_name !== undefined && db_name !== existing.db_name) ||
      (username !== undefined && username !== existing.username) ||
      (password !== undefined) ||
      (ssl !== undefined && ssl !== existing.ssl);

    // Check if name is being changed to one that already exists
    if (name && name !== existing.name) {
      const duplicateCheck = await sequelize.query<{ id: string }>(
        `SELECT id FROM connections WHERE user_id = $1 AND name = $2 AND id != $3`,
        {
          bind: [userId, name, id],
          type: QueryTypes.SELECT
        }
      );

      if (duplicateCheck.length > 0) {
        res.status(409).json({
          success: false,
          error: `A connection named "${name}" already exists`,
          code: 'DUPLICATE_CONNECTION_NAME'
        });
        return;
      }
    }

    // If connection params changed, re-test the connection
    if (connectionFieldsChanged) {
      const testConfig = {
        host: host ?? existing.host,
        port: port ?? existing.port,
        db_name: db_name ?? existing.db_name,
        username: username ?? existing.username,
        password: password ?? decrypt(existing.password_enc),
        ssl: ssl ?? existing.ssl
      };

      logger.info('[CONNECTION] Connection fields changed, re-testing...');
      testSequelize = createTempConnection(testConfig);
      
      try {
        await testSequelize.authenticate();
        logger.info('[CONNECTION] Connection re-test successful');
      } catch (testError: any) {
        const mappedError = mapPgError(testError);
        logger.warn('[CONNECTION] Connection re-test failed', {
          error: mappedError.message,
          code: mappedError.code
        });
        
        res.status(400).json({
          success: false,
          error: mappedError.message,
          code: mappedError.code
        });
        return;
      } finally {
        if (testSequelize) {
          await testSequelize.close();
          testSequelize = null;
        }
      }
    }

    // Build dynamic UPDATE query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (host !== undefined) {
      updates.push(`host = $${paramIndex++}`);
      values.push(host);
    }
    if (port !== undefined) {
      updates.push(`port = $${paramIndex++}`);
      values.push(port);
    }
    if (db_name !== undefined) {
      updates.push(`db_name = $${paramIndex++}`);
      values.push(db_name);
    }
    if (username !== undefined) {
      updates.push(`username = $${paramIndex++}`);
      values.push(username);
    }
    if (password !== undefined) {
      updates.push(`password_enc = $${paramIndex++}`);
      values.push(encrypt(password));
    }
    if (ssl !== undefined) {
      updates.push(`ssl = $${paramIndex++}`);
      values.push(ssl);
    }

    // If connection params changed, update is_valid and last_tested_at
    if (connectionFieldsChanged) {
      updates.push(`is_valid = true`);
      updates.push(`last_tested_at = NOW()`);
      // Reset schema_synced if database connection changed
      if ((host !== undefined && host !== existing.host) ||
          (port !== undefined && port !== existing.port) ||
          (db_name !== undefined && db_name !== existing.db_name)) {
        updates.push(`schema_synced = false`);
        updates.push(`schema_synced_at = NULL`);
      }
    }

    updates.push(`updated_at = NOW()`);

    // Add id and user_id to values
    values.push(id);
    values.push(userId);

    const updateResult = await sequelize.query<ConnectionPublic>(
      `UPDATE connections 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
       RETURNING id, user_id, name, host, port, type, db_name, username, ssl,
                 is_valid, schema_synced, schema_synced_at, last_tested_at, 
                 created_at, updated_at`,
      {
        bind: values,
        type: QueryTypes.SELECT
      }
    );

    const updatedConnection = updateResult[0];

    // Queue schema re-sync if database connection changed
    const databaseChanged = 
      (host !== undefined && host !== existing.host) ||
      (port !== undefined && port !== existing.port) ||
      (db_name !== undefined && db_name !== existing.db_name);

    let jobId: string | undefined;
    if (databaseChanged) {
      const job = await addSyncFullSchemaJob({
        connectionId: id,
        userId,
        connectionName: updatedConnection.name
      });
      jobId = job.id;
      logger.info('[CONNECTION] Schema re-sync job queued', { connectionId: id, jobId });
    }

    logger.info('[CONNECTION] Connection updated successfully', { connectionId: id });

    res.status(200).json({
      success: true,
      message: databaseChanged 
        ? 'Connection updated. Schema sync job queued.' 
        : 'Connection updated successfully.',
      data: {
        connection: updatedConnection,
        ...(jobId && { jobId })
      }
    });
  } catch (error: any) {
    logger.error('[CONNECTION] Update connection failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update connection',
      code: 'CONNECTION_UPDATE_ERROR'
    });
  }
};

/**
 * @route   DELETE /api/connections/:id
 * @desc    Delete a connection
 * @access  Private
 * 
 * STEPS:
 * 1. Get connection_id from params
 * 2. Get user_id from JWT
 * 3. Verify connection exists AND belongs to user
 * 4. Delete connection (CASCADE will delete related schemas, queries, etc.)
 * 5. Clean up any Redis cached data for this connection
 * 6. Return success
 */
export const deleteConnection = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
        code: 'UNAUTHORIZED'
      });
      return;
    }

    if (!id) {
      res.status(400).json({
        success: false,
        error: 'Connection ID is required',
        code: 'VALIDATION_ERROR'
      });
      return;
    }

    logger.info('[CONNECTION] Delete connection request', { id, userId });

    // Verify ownership and get connection name for logging
    const existingConnections = await sequelize.query<{ id: string; name: string }>(
      `SELECT id, name FROM connections WHERE id = $1 AND user_id = $2`,
      {
        bind: [id, userId],
        type: QueryTypes.SELECT
      }
    );

    if (existingConnections.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Connection not found',
        code: 'CONNECTION_NOT_FOUND'
      });
      return;
    }

    const connectionName = existingConnections[0].name;

    // Cancel any pending schema sync jobs for this connection
    try {
      const cancelledJobs = await cancelJobsForConnection(id);
      if (cancelledJobs > 0) {
        logger.info(`[CONNECTION] Cancelled ${cancelledJobs} pending jobs for connection`, { id });
      }
    } catch (cancelError) {
      logger.warn('[CONNECTION] Failed to cancel pending jobs', { id, error: cancelError });
      // Continue with deletion even if job cancellation fails
    }

    // Delete connection (CASCADE will handle related tables)
    await sequelize.query(
      `DELETE FROM connections WHERE id = $1 AND user_id = $2`,
      {
        bind: [id, userId],
        type: QueryTypes.DELETE
      }
    );

    // Clear Redis cache for this connection (if redis is available)
    try {
      const redis = getRedisClient();
      const keys = await redis.keys(`connection:${id}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.debug(`[CONNECTION] Cleared ${keys.length} cached keys for connection`, { id });
      }
    } catch (redisError) {
      logger.warn('[CONNECTION] Failed to clear Redis cache', { id, error: redisError });
      // Continue even if cache clear fails
    }

    logger.info('[CONNECTION] Connection deleted successfully', { id, name: connectionName });

    res.status(200).json({
      success: true,
      message: `Connection "${connectionName}" deleted successfully`
    });
  } catch (error: any) {
    logger.error('[CONNECTION] Delete connection failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete connection',
      code: 'CONNECTION_DELETE_ERROR'
    });
  }
};

/**
 * @route   POST /api/connections/:id/sync-schema
 * @desc    Manually trigger schema sync for a connection
 * @access  Private
 * 
 * STEPS:
 * 1. Verify connection exists and belongs to user
 * 2. Connect to the external database
 * 3. Fetch all PostgreSQL schemas (public, analytics, etc.)
 * 4. For each schema: fetch all tables
 * 5. For each table: fetch columns with types, constraints
 * 6. Fetch all foreign key relationships
 * 7. Upsert into database_schemas table
 * 8. Upsert into table_schemas table
 * 9. Upsert into erd_relations table
 * 10. Update connection.schema_synced = true, schema_synced_at = NOW()
 * 11. Cache in Redis for fast access
 * 12. Return schema summary
 */
export const syncSchema = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('[CONNECTION] Sync schema request received');
    const { id } = req.params;
    const userId = req.userId;
    
    // TODO: Implement schema sync logic
    // This can be called manually or triggered automatically after connection save
    // 
    // QUERIES TO RUN ON EXTERNAL DB:
    // 
    // 1. Get all PostgreSQL schemas:
    //    SELECT schema_name 
    //    FROM information_schema.schemata 
    //    WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    //      AND schema_name NOT LIKE 'pg_temp%'
    //
    // 2. Get all tables with their schemas:
    //    SELECT table_schema, table_name, table_type
    //    FROM information_schema.tables 
    //    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    //      AND table_type IN ('BASE TABLE', 'VIEW')
    // 
    // 3. Get columns for each table:
    //    SELECT 
    //      column_name, data_type, udt_name, is_nullable, 
    //      column_default, character_maximum_length, numeric_precision
    //    FROM information_schema.columns
    //    WHERE table_schema = $1 AND table_name = $2
    //    ORDER BY ordinal_position
    //
    // 4. Get primary keys:
    //    SELECT kcu.column_name
    //    FROM information_schema.table_constraints tc
    //    JOIN information_schema.key_column_usage kcu 
    //      ON tc.constraint_name = kcu.constraint_name
    //    WHERE tc.table_schema = $1 AND tc.table_name = $2 
    //      AND tc.constraint_type = 'PRIMARY KEY'
    // 
    // 5. Get foreign keys:
    //    SELECT
    //      tc.table_schema AS source_schema,
    //      tc.table_name AS source_table, 
    //      kcu.column_name AS source_column,
    //      ccu.table_schema AS target_schema,
    //      ccu.table_name AS target_table,
    //      ccu.column_name AS target_column,
    //      tc.constraint_name
    //    FROM information_schema.table_constraints AS tc
    //    JOIN information_schema.key_column_usage AS kcu 
    //      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    //    JOIN information_schema.constraint_column_usage AS ccu 
    //      ON ccu.constraint_name = tc.constraint_name
    //    WHERE tc.constraint_type = 'FOREIGN KEY'
    //
    // 6. Get table sizes and row counts (optional, can be expensive):
    //    SELECT 
    //      schemaname, relname, 
    //      pg_size_pretty(pg_relation_size(relid)) as size,
    //      n_live_tup as row_count
    //    FROM pg_stat_user_tables

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
    });
  } catch (error: any) {
    logger.error('[CONNECTION] Sync schema failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sync schema',
      code: 'SCHEMA_SYNC_ERROR'
    });
  }
};

/**
 * @route   GET /api/connections/:id/schemas
 * @desc    Get all PostgreSQL schemas for a connection
 * @access  Private
 * 
 * STEPS:
 * 1. Verify connection exists and belongs to user
 * 2. Query database_schemas WHERE connection_id = $1
 * 3. Return list with table counts and selection status
 */
export const getSchemas = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('[CONNECTION] Get schemas request received');
    const { id } = req.params;
    const userId = req.userId;
    
    // TODO: Implement get schemas logic
    // SELECT schema_name, is_selected, table_count, last_synced_at
    // FROM database_schemas
    // WHERE connection_id = $1
    // ORDER BY schema_name

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
    });
  } catch (error: any) {
    logger.error('[CONNECTION] Get schemas failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get schemas',
      code: 'SCHEMAS_FETCH_ERROR'
    });
  }
};

/**
 * @route   PUT /api/connections/:id/schemas
 * @desc    Update which schemas are selected for use
 * @access  Private
 * 
 * STEPS:
 * 1. Verify connection exists and belongs to user
 * 2. Validate request body (array of schema selections)
 * 3. Update is_selected for each schema in database_schemas
 * 4. Invalidate Redis cache for this connection
 * 5. Return updated schemas list
 */
export const updateSchemas = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('[CONNECTION] Update schemas request received');
    const { id } = req.params;
    const userId = req.userId;
    const { schemas } = req.body; // [{ schema_name: 'public', is_selected: true }, ...]
    
    // TODO: Implement update schemas logic
    // For each schema in request:
    //   UPDATE database_schemas 
    //   SET is_selected = $1, updated_at = NOW()
    //   WHERE connection_id = $2 AND schema_name = $3

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
    });
  } catch (error: any) {
    logger.error('[CONNECTION] Update schemas failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update schemas',
      code: 'SCHEMAS_UPDATE_ERROR'
    });
  }
};

/**
 * @route   GET /api/connections/:id/schemas/:schemaName/tables
 * @desc    Get all tables for a specific PostgreSQL schema
 * @access  Private
 * 
 * STEPS:
 * 1. Verify connection exists and belongs to user
 * 2. Query table_schemas WHERE connection_id = $1 AND schema_name = $2
 * 3. Include columns, primary keys, and foreign key refs
 * 4. Return tables with full metadata
 */
export const getTablesBySchema = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('[CONNECTION] Get tables by schema request received');
    const { id, schemaName } = req.params;
    const userId = req.userId;
    
    // TODO: Implement get tables by schema logic
    // SELECT id, table_name, table_type, columns, primary_key_columns, 
    //        row_count, table_size_bytes, description
    // FROM table_schemas
    // WHERE connection_id = $1 AND schema_name = $2
    // ORDER BY table_name

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
    });
  } catch (error: any) {
    logger.error('[CONNECTION] Get tables by schema failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get tables',
      code: 'TABLES_FETCH_ERROR'
    });
  }
};

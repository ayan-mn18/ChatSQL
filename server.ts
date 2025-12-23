import dotenv from 'dotenv';
dotenv.config();
// Import the 'express' module
import express, { Request, Response } from 'express';
import morgan from 'morgan';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { getQuery } from './src/service/openai';
import { getTables, getTableData } from './src/service/dataApiService';
import { Sequelize } from 'sequelize';
import { connectDatabase } from './src/config/db';

// Import routes
import { authRoutes, connectionRoutes, jobsRoutes, adminRoutes, aiRoutes, viewerRoutes, savedQueriesRoutes, chatRoutes } from './src/routes';

// Import middleware
import { errorHandler, notFoundHandler, globalRateLimit } from './src/middleware';
import { corsConfig, env, checkRedisHealth, closeRedisConnections } from './src/config';

// Import queue workers
import { createSchemaSyncWorker, createAIOperationsWorker, createDBOperationsWorker, createAccessManagementWorker, initializeAccessManagement } from './src/queues';

import { logger } from './src/utils/logger';

// Create an Express application
const app = express();

// Middleware
// Skip logging for Bull Board polling requests
app.use(morgan('dev', {
  skip: (req) => req.originalUrl.startsWith('/admin/queues')
}));
app.use(express.json());
app.use(cookieParser());
app.use(corsConfig);

// Apply global rate limiting
app.use(globalRateLimit);

// Set the port number for the server
const { PORT } = process.env;

// Define a route for the root path ('/')
app.post('/api/getResult', async (req: Request, res: Response) => {
  try {
    const {query, uri, model} = req.body;

  const resp = await getQuery(query, "", uri);
  logger.info("query: ", resp)

  if(resp === "" || resp === undefined || resp === null) {
    res.json({
      "data": resp
    })
  }

  const sequelize = new Sequelize(uri);
 
  const data = await sequelize.query(resp.query);
  res.status(200).json({
    "data": data[0],
    "info": resp
  })
  
  } catch (err) {
    logger.error("Error in getResult:", err);
    res.status(401).json({
      err: "Invalid Prompt"
    })
  }
  
});

// New API endpoint to get database tables with metadata
app.post('/api/getTables', async (req: Request, res: Response): Promise<void> => {
  try {
    const { uri } = req.body;
    
    if (!uri) {
      res.status(400).json({ 
        success: false, 
        error: 'Database URI is required', 
        code: 'INVALID_PARAMS' 
      });
      return;
    }

    const { tables, totalTables } = await getTables(uri);
    
    res.status(200).json({
      success: true,
      tables,
      totalTables,
      error: null,
    });
  } catch (err: any) {
    logger.error('Error fetching tables:', err);
    
    let errorCode = 'CONNECTION_ERROR';
    if (err.message.includes('connect')) {
      errorCode = 'CONNECTION_ERROR';
    } else if (err.message.includes('authentication')) {
      errorCode = 'AUTH_ERROR';
    } else if (err.message.includes('timeout')) {
      errorCode = 'TIMEOUT_ERROR';
    }
    
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch tables',
      code: errorCode,
    });
  }
});

// New API endpoint to get table data with pagination, filtering, and sorting
app.post('/api/getTableData', async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      uri, 
      tableName, 
      page = 1, 
      pageSize = 10, 
      sortBy, 
      sortOrder = 'asc', 
      filterValue, 
      columns 
    } = req.body;

    if (!uri || !tableName) {
      res.status(400).json({ 
        success: false, 
        error: 'URI and tableName are required', 
        code: 'INVALID_PARAMS' 
      });
      return;
    }

    // Validate pagination parameters
    if (page < 1) {
      res.status(400).json({
        success: false,
        error: 'Page number must be greater than 0',
        code: 'INVALID_PARAMS'
      });
      return;
    }

    if (pageSize < 1 || pageSize > 100) {
      res.status(400).json({
        success: false,
        error: 'Page size must be between 1 and 100',
        code: 'INVALID_PARAMS'
      });
      return;
    }

    // Validate sort order
    if (sortOrder && !['asc', 'desc'].includes(sortOrder)) {
      res.status(400).json({
        success: false,
        error: 'Sort order must be either "asc" or "desc"',
        code: 'INVALID_PARAMS'
      });
      return;
    }

    const result = await getTableData(
      uri, 
      tableName, 
      page, 
      pageSize, 
      sortBy, 
      sortOrder, 
      filterValue, 
      columns
    );

    res.status(200).json({
      success: true,
      ...result,
      error: null,
    });
  } catch (err: any) {
    logger.error('Error fetching table data:', err);
    
    let errorCode = 'QUERY_ERROR';
    if (err.message.includes('not found')) {
      errorCode = 'TABLE_NOT_FOUND';
    } else if (err.message.includes('Invalid table name')) {
      errorCode = 'INVALID_TABLE_NAME';
    } else if (err.message.includes('Invalid columns')) {
      errorCode = 'INVALID_COLUMNS';
    } else if (err.message.includes('connect')) {
      errorCode = 'CONNECTION_ERROR';
    }
    
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch table data',
      code: errorCode,
    });
  }
});

app.post('/api/testConnection', async (req: Request, res: Response) => {
  try {
    const { uri } = req.body;
    if(!uri) {
      res.status(401).json({
        "connection": false
      })
    }
    const conn = await testDbConnection(uri);
    res.status(200).json({
      "connection": conn
    })
  } catch (error) {
    res.status(401).json({
      "connection": false
    })
  }
})

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'ChatSQL API',
    version: '1.0.0'
  });
});

// ============================================
// ROUTES
// ============================================

// Auth routes
app.use('/api/auth', authRoutes);

// Connection routes
app.use('/api/connections', connectionRoutes);

// AI routes (SQL generation, query explanation)
app.use('/api/ai', aiRoutes);

// Jobs routes (SSE progress, job status)
app.use('/api/jobs', jobsRoutes);

// Admin routes (Bull Board dashboard)
app.use('/admin/queues', adminRoutes);

// Viewer routes (user management)
app.use('/api/viewers', viewerRoutes);

// Saved queries routes
app.use('/api/connections', savedQueriesRoutes);

// Chat routes (AI chat sessions)
app.use('/api/chat', chatRoutes);

// Future routes - uncomment when implemented
// app.use('/api/query', queryRoutes);
// app.use('/api/schema', schemaRoutes);
// app.use('/api/data', dataRoutes);
// app.use('/api/dashboards', dashboardRoutes);
// app.use('/api/ai', aiRoutes);

async function testDbConnection(uri: string): Promise<boolean> {
  const sequelize = new Sequelize(uri);
  try {
      await sequelize.authenticate();
      await sequelize.close();
      return true;
  } catch (error) {
      logger.error('Database connection failed:', error);
      return false;
  }
}

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Queue workers (will be started after server starts)
let schemaSyncWorker: ReturnType<typeof createSchemaSyncWorker> | null = null;
let aiOperationsWorker: ReturnType<typeof createAIOperationsWorker> | null = null;
let dbOperationsWorker: ReturnType<typeof createDBOperationsWorker> | null = null;
let accessManagementWorker: ReturnType<typeof createAccessManagementWorker> | null = null;

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  logger.info(`[SERVER] ${signal} received, shutting down gracefully...`);
  
  // Close workers
  if (schemaSyncWorker) {
    logger.info('[SERVER] Closing schema sync worker...');
    await schemaSyncWorker.close();
  }
  
  if (aiOperationsWorker) {
    logger.info('[SERVER] Closing AI operations worker...');
    await aiOperationsWorker.close();
  }
  
  if (dbOperationsWorker) {
    logger.info('[SERVER] Closing DB operations worker...');
    await dbOperationsWorker.close();
  }
  
  if (accessManagementWorker) {
    logger.info('[SERVER] Closing access management worker...');
    await accessManagementWorker.close();
  }
  
  // Close Redis connections
  await closeRedisConnections();
  
  logger.info('[SERVER] Shutdown complete');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the server and listen on the specified port
app.listen(PORT, async () => {
  // Log a message when the server is successfully running
  logger.info('Cors allowed for:', env.CORS_ORIGIN || "https://sql.bizer.dev");
  logger.info(`🚀 Server is running on http://localhost:${PORT}`);
  logger.info(`📚 Environment: ${env.NODE_ENV || 'development'}`);
  
  // Connect to database
  await connectDatabase();
  
  // Check Redis and start workers
  const redisHealthy = await checkRedisHealth();
  if (redisHealthy) {
    logger.info('[SERVER] ✅ Redis connected, starting queue workers...');
    
    // Start workers
    schemaSyncWorker = createSchemaSyncWorker();
    aiOperationsWorker = createAIOperationsWorker();
    dbOperationsWorker = createDBOperationsWorker();
    accessManagementWorker = createAccessManagementWorker();
    
    // Initialize access management (periodic cleanup job)
    await initializeAccessManagement();
    
    logger.info('[SERVER] ✅ Queue workers started');
    logger.info('[SERVER] 📊 Bull Board available at http://localhost:' + PORT + '/admin/queues');
  } else {
    logger.warn('[SERVER] ⚠️ Redis not available, queue workers not started');
    logger.warn('[SERVER] Schema sync and AI operations will not work');
  }
});
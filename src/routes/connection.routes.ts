import { Router } from 'express';
import { authenticate, connectionRateLimit, heavyRateLimit, validate } from '../middleware';
import { testConnectionSchema, createConnectionSchema, updateConnectionSchema, uuidParamSchema } from '../middleware/validator';
import * as connectionController from '../controllers/connection.controller';

const router = Router();

// ============================================
// CONNECTION ROUTES
// All routes require authentication
// ============================================

/**
 * @route   POST /api/connections/test
 * @desc    Test a database connection (without saving)
 * @access  Private
 * @body    { host, port, db_name, username, password, ssl? }
 */
router.post('/test', authenticate, connectionRateLimit, validate(testConnectionSchema), connectionController.testConnection);

/**
 * @route   POST /api/connections
 * @desc    Create a new database connection
 * @access  Private
 * @body    { name, host, port, db_name, username, password, ssl? }
 */
router.post('/', authenticate, connectionRateLimit, validate(createConnectionSchema), connectionController.createConnection);

/**
 * @route   GET /api/connections
 * @desc    Get all user connections
 * @access  Private
 */
router.get('/', authenticate, connectionController.getAllConnections);

/**
 * @route   GET /api/connections/:id
 * @desc    Get single connection by ID
 * @access  Private
 */
router.get('/:id', authenticate, validate(uuidParamSchema), connectionController.getConnectionById);

/**
 * @route   PUT /api/connections/:id
 * @desc    Update connection
 * @access  Private
 * @body    { name?, host?, port?, db_name?, username?, password?, ssl? }
 */
router.put('/:id', authenticate, validate(uuidParamSchema), validate(updateConnectionSchema), connectionController.updateConnection);

/**
 * @route   DELETE /api/connections/:id
 * @desc    Delete connection
 * @access  Private
 */
router.delete('/:id', authenticate, validate(uuidParamSchema), connectionController.deleteConnection);

/**
 * @route   POST /api/connections/:id/sync-schema
 * @desc    Manually trigger schema sync for a connection
 * @access  Private
 */
router.post('/:id/sync-schema', authenticate, heavyRateLimit, validate(uuidParamSchema), connectionController.syncSchema);

// ============================================
// DATABASE SCHEMA ROUTES (PostgreSQL schemas: public, analytics, etc.)
// ============================================

/**
 * @route   GET /api/connections/:id/schemas
 * @desc    Get all PostgreSQL schemas for a connection
 * @access  Private
 * @returns List of schemas with table counts and selection status
 */
router.get('/:id/schemas', authenticate, connectionController.getSchemas);

/**
 * @route   PUT /api/connections/:id/schemas
 * @desc    Update which schemas are selected for use
 * @access  Private
 * @body    { schemas: [{ schema_name: string, is_selected: boolean }] }
 */
router.put('/:id/schemas', authenticate, connectionController.updateSchemas);

/**
 * @route   GET /api/connections/:id/schemas/:schemaName/tables
 * @desc    Get all tables for a specific schema
 * @access  Private
 * @returns List of tables with columns for the specified schema
 */
router.get('/:id/schemas/:schemaName/tables', authenticate, connectionController.getTablesBySchema);

/**
 * @route   GET /api/connections/:id/relations
 * @desc    Get all ERD relations (foreign keys) for a connection
 * @access  Private
 * @returns List of foreign key relationships for ERD visualization
 */
router.get('/:id/relations', authenticate, connectionController.getRelations);

export default router;

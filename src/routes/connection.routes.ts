import { Router } from 'express';
import { authenticate, connectionRateLimit, heavyRateLimit } from '../middleware';
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
router.post('/test', authenticate, connectionRateLimit, connectionController.testConnection);

/**
 * @route   POST /api/connections
 * @desc    Create a new database connection
 * @access  Private
 * @body    { name, host, port, db_name, username, password, ssl? }
 */
router.post('/', authenticate, connectionRateLimit, connectionController.createConnection);

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
router.get('/:id', authenticate, connectionController.getConnectionById);

/**
 * @route   PUT /api/connections/:id
 * @desc    Update connection
 * @access  Private
 * @body    { name?, host?, port?, db_name?, username?, password?, ssl? }
 */
router.put('/:id', authenticate, connectionController.updateConnection);

/**
 * @route   DELETE /api/connections/:id
 * @desc    Delete connection
 * @access  Private
 */
router.delete('/:id', authenticate, connectionController.deleteConnection);

/**
 * @route   POST /api/connections/:id/sync-schema
 * @desc    Manually trigger schema sync for a connection
 * @access  Private
 */
router.post('/:id/sync-schema', authenticate, heavyRateLimit, connectionController.syncSchema);

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

export default router;

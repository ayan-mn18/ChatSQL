import { Router } from 'express';
import { authenticate } from '../middleware';
import * as savedQueriesController from '../controllers/saved-queries.controller';

const router = Router();

// ============================================
// SAVED QUERIES ROUTES
// All routes require authentication
// ============================================

/**
 * @route   POST /api/connections/:connectionId/saved-queries
 * @desc    Create a new saved query
 * @access  Private (connection owner only)
 */
router.post(
  '/:connectionId/saved-queries',
  authenticate,
  savedQueriesController.createSavedQuery
);

/**
 * @route   GET /api/connections/:connectionId/saved-queries
 * @desc    Get all saved queries for a connection
 * @access  Private (owner sees all, viewer sees shared)
 * @query   search - Optional search term
 */
router.get(
  '/:connectionId/saved-queries',
  authenticate,
  savedQueriesController.getSavedQueries
);

/**
 * @route   GET /api/connections/:connectionId/saved-queries/:queryId
 * @desc    Get a single saved query
 * @access  Private
 */
router.get(
  '/:connectionId/saved-queries/:queryId',
  authenticate,
  savedQueriesController.getSavedQuery
);

/**
 * @route   PUT /api/connections/:connectionId/saved-queries/:queryId
 * @desc    Update a saved query
 * @access  Private (owner only)
 */
router.put(
  '/:connectionId/saved-queries/:queryId',
  authenticate,
  savedQueriesController.updateSavedQuery
);

/**
 * @route   DELETE /api/connections/:connectionId/saved-queries/:queryId
 * @desc    Delete a saved query
 * @access  Private (owner only)
 */
router.delete(
  '/:connectionId/saved-queries/:queryId',
  authenticate,
  savedQueriesController.deleteSavedQuery
);

/**
 * @route   POST /api/connections/:connectionId/saved-queries/:queryId/use
 * @desc    Record usage of a saved query
 * @access  Private
 */
router.post(
  '/:connectionId/saved-queries/:queryId/use',
  authenticate,
  savedQueriesController.recordQueryUsage
);

export default router;

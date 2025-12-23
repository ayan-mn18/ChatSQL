import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { logger } from '../utils/logger';
import * as savedQueriesService from '../services/saved-queries.service';
import { viewerHasConnectionAccess } from '../services/viewer.service';

// ============================================
// SAVED QUERIES CONTROLLER
// Handles CRUD operations for saved SQL queries
// ============================================

/**
 * @route   POST /api/connections/:connectionId/saved-queries
 * @desc    Create a new saved query
 * @access  Private (connection owner only)
 */
export const createSavedQuery = async (req: Request, res: Response): Promise<void> => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole;
    const { name, queryText, description, tags, isShared, folder } = req.body;

    // Viewers cannot create saved queries
    if (userRole === 'viewer') {
      res.status(403).json({
        success: false,
        error: 'Viewers cannot create saved queries',
        code: 'FORBIDDEN',
      });
      return;
    }

    // Verify connection ownership
    const [connection] = await sequelize.query<{ id: string }>(
      `SELECT id FROM connections WHERE id = :connectionId AND user_id = :userId`,
      { replacements: { connectionId, userId }, type: QueryTypes.SELECT }
    );

    if (!connection) {
      res.status(404).json({
        success: false,
        error: 'Connection not found',
        code: 'NOT_FOUND',
      });
      return;
    }

    // Validate input
    if (!name || !queryText) {
      res.status(400).json({
        success: false,
        error: 'Name and queryText are required',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const savedQuery = await savedQueriesService.createSavedQuery({
      userId,
      connectionId,
      name,
      queryText,
      description,
      tags,
      isShared,
      folder,
    });

    res.status(201).json({
      success: true,
      data: savedQuery,
    });
  } catch (error: any) {
    logger.error('[SAVED_QUERIES] Create failed:', error);
    res.status(error.message?.includes('already exists') ? 409 : 500).json({
      success: false,
      error: error.message || 'Failed to create saved query',
      code: error.message?.includes('already exists') ? 'DUPLICATE' : 'SERVER_ERROR',
    });
  }
};

/**
 * @route   GET /api/connections/:connectionId/saved-queries
 * @desc    Get all saved queries for a connection
 * @access  Private (owner sees all, viewer sees shared only)
 */
export const getSavedQueries = async (req: Request, res: Response): Promise<void> => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole;
    const { search } = req.query;

    // Verify access
    let hasAccess = false;
    let isViewer = userRole === 'viewer';

    if (isViewer) {
      hasAccess = await viewerHasConnectionAccess(userId, connectionId);
    } else {
      const [connection] = await sequelize.query<{ id: string }>(
        `SELECT id FROM connections WHERE id = :connectionId AND user_id = :userId`,
        { replacements: { connectionId, userId }, type: QueryTypes.SELECT }
      );
      hasAccess = !!connection;
    }

    if (!hasAccess) {
      res.status(404).json({
        success: false,
        error: 'Connection not found',
        code: 'NOT_FOUND',
      });
      return;
    }

    let savedQueries;
    if (search && typeof search === 'string') {
      savedQueries = await savedQueriesService.searchSavedQueries(
        connectionId,
        userId,
        search,
        isViewer
      );
    } else {
      savedQueries = await savedQueriesService.getSavedQueries(connectionId, userId, isViewer);
    }

    res.json({
      success: true,
      data: savedQueries,
      count: savedQueries.length,
    });
  } catch (error: any) {
    logger.error('[SAVED_QUERIES] Get all failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get saved queries',
      code: 'SERVER_ERROR',
    });
  }
};

/**
 * @route   GET /api/connections/:connectionId/saved-queries/:queryId
 * @desc    Get a single saved query
 * @access  Private
 */
export const getSavedQuery = async (req: Request, res: Response): Promise<void> => {
  try {
    const { connectionId, queryId } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole;
    const isViewer = userRole === 'viewer';

    const savedQuery = await savedQueriesService.getSavedQueryById(queryId, userId, isViewer);

    if (!savedQuery || savedQuery.connectionId !== connectionId) {
      res.status(404).json({
        success: false,
        error: 'Saved query not found',
        code: 'NOT_FOUND',
      });
      return;
    }

    res.json({
      success: true,
      data: savedQuery,
    });
  } catch (error: any) {
    logger.error('[SAVED_QUERIES] Get one failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get saved query',
      code: 'SERVER_ERROR',
    });
  }
};

/**
 * @route   PUT /api/connections/:connectionId/saved-queries/:queryId
 * @desc    Update a saved query
 * @access  Private (owner only)
 */
export const updateSavedQuery = async (req: Request, res: Response): Promise<void> => {
  try {
    const { connectionId, queryId } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole;
    const { name, queryText, description, tags, isShared, folder } = req.body;

    // Viewers cannot update saved queries
    if (userRole === 'viewer') {
      res.status(403).json({
        success: false,
        error: 'Viewers cannot update saved queries',
        code: 'FORBIDDEN',
      });
      return;
    }

    const savedQuery = await savedQueriesService.updateSavedQuery(queryId, userId, {
      name,
      queryText,
      description,
      tags,
      isShared,
      folder,
    });

    if (!savedQuery) {
      res.status(404).json({
        success: false,
        error: 'Saved query not found',
        code: 'NOT_FOUND',
      });
      return;
    }

    res.json({
      success: true,
      data: savedQuery,
    });
  } catch (error: any) {
    logger.error('[SAVED_QUERIES] Update failed:', error);
    res.status(error.message?.includes('already exists') ? 409 : 500).json({
      success: false,
      error: error.message || 'Failed to update saved query',
      code: error.message?.includes('already exists') ? 'DUPLICATE' : 'SERVER_ERROR',
    });
  }
};

/**
 * @route   DELETE /api/connections/:connectionId/saved-queries/:queryId
 * @desc    Delete a saved query
 * @access  Private (owner only)
 */
export const deleteSavedQuery = async (req: Request, res: Response): Promise<void> => {
  try {
    const { queryId } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole;

    // Viewers cannot delete saved queries
    if (userRole === 'viewer') {
      res.status(403).json({
        success: false,
        error: 'Viewers cannot delete saved queries',
        code: 'FORBIDDEN',
      });
      return;
    }

    const deleted = await savedQueriesService.deleteSavedQuery(queryId, userId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'Saved query not found',
        code: 'NOT_FOUND',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Saved query deleted',
    });
  } catch (error: any) {
    logger.error('[SAVED_QUERIES] Delete failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete saved query',
      code: 'SERVER_ERROR',
    });
  }
};

/**
 * @route   POST /api/connections/:connectionId/saved-queries/:queryId/use
 * @desc    Record usage of a saved query
 * @access  Private
 */
export const recordQueryUsage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { queryId } = req.params;
    
    await savedQueriesService.recordQueryUsage(queryId);

    res.json({
      success: true,
      message: 'Usage recorded',
    });
  } catch (error: any) {
    logger.error('[SAVED_QUERIES] Record usage failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to record usage',
      code: 'SERVER_ERROR',
    });
  }
};

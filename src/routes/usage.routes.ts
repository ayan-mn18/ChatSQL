import { Router } from 'express';
import { authenticate } from '../middleware';
import * as usageController from '../controllers/usage.controller';

const router = Router();

// ============================================
// USAGE ROUTES
// All routes require authentication
// ============================================

/**
 * GET /api/usage/dashboard
 * Get user's complete usage dashboard data
 */
router.get('/dashboard', authenticate, usageController.getUsageDashboard);

/**
 * GET /api/usage/plans
 * Get all available subscription plans
 */
router.get('/plans', authenticate, usageController.getAvailablePlans);

/**
 * GET /api/usage/tokens
 * Get token usage history with pagination
 */
router.get('/tokens', authenticate, usageController.getTokenHistory);

export default router;

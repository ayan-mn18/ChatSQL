import { Router } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { schemaSyncQueue } from '../queues/schema-sync.queue';
import { aiOperationsQueue } from '../queues/ai-operations.queue';
import { dbOperationsQueue } from '../queues/db-operations.queue';
import { accessManagementQueue } from '../queues/access-management.queue';
import { logger } from '../utils/logger';

// ============================================
// BULL BOARD ADMIN DASHBOARD
// View and manage queues at /admin/queues
// ============================================

// Create Express adapter for Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

// Create Bull Board with all queues
createBullBoard({
  queues: [
    new BullMQAdapter(schemaSyncQueue),
    new BullMQAdapter(aiOperationsQueue),
    new BullMQAdapter(dbOperationsQueue),
    new BullMQAdapter(accessManagementQueue),
  ],
  serverAdapter,
});

// Create router
const router = Router();

// Simple auth middleware for admin routes (in production, use proper auth)
const adminAuth = (req: any, res: any, next: any) => {
  // In development, allow access
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  
  // In production, require admin secret header
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret === process.env.ADMIN_SECRET) {
    return next();
  }
  
  logger.warn('[BULL_BOARD] Unauthorized access attempt');
  res.status(401).json({ error: 'Unauthorized' });
};

// Mount Bull Board UI
router.use('/', adminAuth, serverAdapter.getRouter());

logger.info('[BULL_BOARD] Admin dashboard available at /admin/queues');

export default router;

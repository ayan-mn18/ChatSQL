import { Router } from 'express';
import { authenticate } from '../middleware';
import * as contactController from '../controllers/contact.controller';

const router = Router();

// ============================================
// CONTACT ROUTES
// ============================================

/**
 * POST /api/contact
 * Submit a general contact form (no auth required)
 * Body: { name, email, message, company?, phone?, subject?, requestType?, planInterest? }
 */
router.post('/', contactController.submitContactForm);

/**
 * POST /api/contact/enterprise
 * Submit an enterprise inquiry (no auth required)
 * Body: { name, email, message, company?, phone? }
 */
router.post('/enterprise', contactController.submitEnterpriseInquiry);

/**
 * GET /api/contact/list
 * Get contact requests (admin only)
 * Query: page, pageSize, status, requestType
 */
router.get('/list', authenticate, contactController.getContactRequests);

/**
 * PATCH /api/contact/:id
 * Update contact request status (admin only)
 * Body: { status?, assignedTo?, responseNotes? }
 */
router.patch('/:id', authenticate, contactController.updateContactRequest);

export default router;

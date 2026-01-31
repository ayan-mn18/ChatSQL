import { Router } from 'express';
import { authenticate } from '../middleware';
import * as paymentController from '../controllers/payment.controller';

const router = Router();

// ============================================
// PAYMENT ROUTES
// ============================================

/**
 * POST /api/payments/checkout
 * Create a checkout session for plan upgrade
 * Body: { planType: 'pro' | 'lifetime' }
 */
router.post('/checkout', authenticate, paymentController.createCheckout);

/**
 * GET /api/payments/subscription
 * Get user's current subscription status
 */
router.get('/subscription', authenticate, paymentController.getSubscription);

/**
 * POST /api/payments/cancel
 * Cancel current subscription (at period end)
 */
router.post('/cancel', authenticate, paymentController.cancelSubscription);

/**
 * GET /api/payments/history
 * Get payment history with pagination
 * Query: page, pageSize
 */
router.get('/history', authenticate, paymentController.getPaymentHistory);

/**
 * GET /api/payments/read-only-status
 * Check if user is in read-only mode (free tier exhausted)
 */
router.get('/read-only-status', authenticate, paymentController.getReadOnlyStatus);

/**
 * POST /api/payments/webhook
 * Dodo Payments webhook handler (no auth required)
 */
router.post('/webhook', paymentController.handleWebhook);

export default router;

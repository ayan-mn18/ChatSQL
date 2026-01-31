import { Request, Response } from 'express';
import { Webhook } from 'standardwebhooks';
import { logger } from '../utils/logger';
import { DODO_WEBHOOK_SECRET } from '../config/env';
import * as paymentService from '../service/payment.service';
import { sendPaymentFailedEmail } from '../services/email.service';

// ============================================
// PAYMENT CONTROLLER
// Handles payment endpoints and Dodo webhooks
// ============================================

/**
 * Create a checkout session for upgrading to a paid plan
 * POST /api/payments/checkout
 */
export const createCheckout = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { planType } = req.body;

    if (!planType || !['pro_monthly', 'pro_yearly', 'lifetime'].includes(planType)) {
      res.status(400).json({ 
        success: false, 
        message: 'Invalid plan type. Must be "pro_monthly", "pro_yearly", or "lifetime"' 
      });
      return;
    }

    // Get user email from database
    const { sequelize } = await import('../config/db');
    const { QueryTypes } = await import('sequelize');
    
    const [user] = await sequelize.query<any>(
      `SELECT email, username FROM users WHERE id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const result = await paymentService.createCheckoutSession({
      userId,
      email: user.email,
      username: user.username,
      planType,
    });

    if (!result.success) {
      res.status(500).json({ success: false, message: result.error });
      return;
    }

    res.json({
      success: true,
      data: {
        checkoutUrl: result.checkoutUrl,
        sessionId: result.sessionId,
      },
    });
  } catch (error: any) {
    logger.error('[PAYMENT_CONTROLLER] Checkout creation failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create checkout session',
      error: error.message,
    });
  }
};

/**
 * Get user's current subscription
 * GET /api/payments/subscription
 */
export const getSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const subscription = await paymentService.getUserSubscription(userId);
    const readOnlyStatus = await paymentService.checkUserReadOnly(userId);

    res.json({
      success: true,
      data: {
        subscription,
        ...readOnlyStatus,
      },
    });
  } catch (error: any) {
    logger.error('[PAYMENT_CONTROLLER] Failed to get subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subscription',
      error: error.message,
    });
  }
};

/**
 * Cancel user's subscription
 * POST /api/payments/cancel
 */
export const cancelSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const result = await paymentService.cancelSubscription(userId);

    if (!result.success) {
      res.status(400).json({ success: false, message: result.error });
      return;
    }

    res.json({
      success: true,
      message: 'Subscription will be cancelled at the end of the current billing period',
    });
  } catch (error: any) {
    logger.error('[PAYMENT_CONTROLLER] Failed to cancel subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel subscription',
      error: error.message,
    });
  }
};

/**
 * Get payment history
 * GET /api/payments/history
 */
export const getPaymentHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 50);

    const result = await paymentService.getPaymentHistory(userId, page, pageSize);

    res.json({
      success: true,
      data: result.payments,
      pagination: {
        page,
        pageSize,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
      },
    });
  } catch (error: any) {
    logger.error('[PAYMENT_CONTROLLER] Failed to get payment history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history',
      error: error.message,
    });
  }
};

/**
 * Check if user is in read-only mode
 * GET /api/payments/read-only-status
 */
export const getReadOnlyStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const status = await paymentService.checkUserReadOnly(userId);

    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    logger.error('[PAYMENT_CONTROLLER] Failed to get read-only status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get read-only status',
      error: error.message,
    });
  }
};

/**
 * Handle Dodo Payments webhooks
 * POST /api/payments/webhook
 */
export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get raw body for signature verification
    const rawBody = JSON.stringify(req.body);
    
    // Verify webhook signature if secret is configured
    if (DODO_WEBHOOK_SECRET) {
      const webhook = new Webhook(DODO_WEBHOOK_SECRET);
      const webhookHeaders = {
        'webhook-id': req.headers['webhook-id'] as string,
        'webhook-timestamp': req.headers['webhook-timestamp'] as string,
        'webhook-signature': req.headers['webhook-signature'] as string,
      };
      
      try {
        await webhook.verify(rawBody, webhookHeaders);
      } catch (verifyError) {
        logger.error('[PAYMENT_CONTROLLER] Webhook signature verification failed');
        res.status(401).json({ success: false, message: 'Invalid webhook signature' });
        return;
      }
    } else {
      logger.warn('[PAYMENT_CONTROLLER] Webhook secret not configured - skipping signature verification');
    }

    const event = req.body;
    const eventType = event.type;
    
    logger.info(`[PAYMENT_CONTROLLER] Received webhook event: ${eventType}`);

    switch (eventType) {
      case 'payment.succeeded':
      case 'payment_succeeded': {
        const { payment_id, customer_id, amount, metadata } = event.data || event;
        await paymentService.handlePaymentSucceeded(
          payment_id,
          customer_id,
          amount,
          metadata || {}
        );
        break;
      }

      case 'payment.failed':
      case 'payment_failed': {
        const { payment_id, customer_id, amount, failure_reason, metadata } = event.data || event;
        const { userId, email } = await paymentService.handlePaymentFailed(
          payment_id,
          customer_id,
          amount,
          failure_reason || 'Unknown error',
          metadata || {}
        );
        
        // Send email notification for failed payment
        if (email) {
          await sendPaymentFailedEmail(email, failure_reason || 'Payment could not be processed', userId);
        }
        break;
      }

      case 'subscription.active':
      case 'subscription_active': {
        // Subscription activated - already handled in payment.succeeded
        logger.info('[PAYMENT_CONTROLLER] Subscription activated');
        break;
      }

      case 'subscription.cancelled':
      case 'subscription_cancelled': {
        const { subscription_id, customer_id } = event.data || event;
        await paymentService.handleSubscriptionCancelled(subscription_id, customer_id);
        break;
      }

      case 'subscription.renewed':
      case 'subscription_renewed': {
        const { subscription_id, customer_id, current_period_end } = event.data || event;
        await paymentService.handleSubscriptionRenewed(
          subscription_id,
          customer_id,
          new Date(current_period_end)
        );
        break;
      }

      case 'subscription.on_hold':
      case 'subscription_on_hold': {
        // Subscription paused due to payment issues
        const { subscription_id, customer_id } = event.data || event;
        logger.warn(`[PAYMENT_CONTROLLER] Subscription on hold: ${subscription_id}`);
        // Could send a notification email here
        break;
      }

      default:
        logger.info(`[PAYMENT_CONTROLLER] Unhandled webhook event type: ${eventType}`);
    }

    // Always respond 200 to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error('[PAYMENT_CONTROLLER] Webhook handling failed:', error);
    // Still return 200 to prevent retries for handling errors
    res.status(200).json({ received: true, error: error.message });
  }
};

export default {
  createCheckout,
  getSubscription,
  cancelSubscription,
  getPaymentHistory,
  getReadOnlyStatus,
  handleWebhook,
};

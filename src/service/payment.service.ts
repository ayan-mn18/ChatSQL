import DodoPayments from 'dodopayments';
import { sequelize } from '../config/db';
import { QueryTypes } from 'sequelize';
import { logger } from '../utils/logger';
import { 
  DODO_PAYMENTS_API_KEY, 
  DODO_PRODUCT_ID_PRO_MONTHLY,
  DODO_PRODUCT_ID_PRO_YEARLY,
  DODO_PRODUCT_ID_LIFETIME,
  DODO_PAYMENTS_MODE,
  APP_URL,
  API_URL
} from '../config/env';

// ============================================
// PAYMENT SERVICE
// Handles Dodo Payments integration for subscriptions
// ============================================

// Initialize Dodo Payments client
const getDodoClient = (): DodoPayments | null => {
  if (!DODO_PAYMENTS_API_KEY) {
    logger.warn('[PAYMENT_SERVICE] Dodo Payments API key not configured');
    return null;
  }
  
  return new DodoPayments({
    bearerToken: DODO_PAYMENTS_API_KEY,
    environment: DODO_PAYMENTS_MODE,
  });
};

// ============================================
// TYPES
// ============================================

export interface CreateCheckoutParams {
  userId: string;
  email: string;
  username?: string;
  planType: 'pro_monthly' | 'pro_yearly' | 'lifetime';
}

export interface CheckoutResult {
  success: boolean;
  checkoutUrl?: string;
  sessionId?: string;
  error?: string;
}

export interface SubscriptionInfo {
  id: string;
  userId: string;
  planType: string;
  status: string;
  isLifetime: boolean;
  amount: number;
  currency: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  dodoSubscriptionId?: string;
  dodoCustomerId?: string;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  status: string;
  planType: string;
  description?: string;
  paymentMethod?: string;
  receiptUrl?: string;
  createdAt: Date;
}

// ============================================
// CHECKOUT FUNCTIONS
// ============================================

/**
 * Create a checkout session for a subscription or one-time payment
 */
export async function createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutResult> {
  const { userId, email, username, planType } = params;
  
  const client = getDodoClient();
  if (!client) {
    return { success: false, error: 'Payment service not configured' };
  }
  
  try {
    // Determine product ID based on plan type
    let productId: string | undefined;
    let isSubscription = false;
    
    if (planType === 'pro_monthly') {
      productId = DODO_PRODUCT_ID_PRO_MONTHLY;
      isSubscription = true;
    } else if (planType === 'pro_yearly') {
      productId = DODO_PRODUCT_ID_PRO_YEARLY;
      isSubscription = true;
    } else if (planType === 'lifetime') {
      productId = DODO_PRODUCT_ID_LIFETIME;
      isSubscription = false;
    }
    
    if (!productId) {
      return { success: false, error: `Product ID not configured for plan: ${planType}` };
    }
    
    // Check if user already has a Dodo customer ID
    const [existingPlan] = await sequelize.query<any>(
      `SELECT dodo_customer_id FROM user_plans WHERE user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    
    // Build the checkout session request
    const checkoutRequest = {
      product_cart: [
        {
          product_id: productId,
          quantity: 1,
        },
      ],
      customer: {
        email,
        name: username || email.split('@')[0],
      },
      return_url: `${APP_URL}/dashboard/checkout/success?plan=${planType}`,
      metadata: {
        user_id: userId,
        plan_type: planType,
      },
    };
    
    logger.info(`[PAYMENT_SERVICE] Creating checkout session with payload:`, {
      productId,
      planType,
      isSubscription,
      email,
      returnUrl: checkoutRequest.return_url,
      apiKeyConfigured: !!DODO_PAYMENTS_API_KEY,
      dodoMode: DODO_PAYMENTS_MODE,
    });
    
    // Create checkout session with Dodo (use checkoutSessions.create instead of deprecated payments.create)
    const checkoutSession = await client.checkoutSessions.create(checkoutRequest);
    
    logger.info(`[PAYMENT_SERVICE] Checkout session created for user ${userId}, plan: ${planType}, sessionId: ${checkoutSession.session_id}`);
    
    return {
      success: true,
      checkoutUrl: checkoutSession.checkout_url || '',
      sessionId: checkoutSession.session_id,
    };
  } catch (error: any) {
    logger.error(`[PAYMENT_SERVICE] Failed to create checkout session: ${error.message}`);
    logger.error(`[PAYMENT_SERVICE] Error details:`, {
      name: error.name,
      status: error.status,
      statusCode: error.statusCode,
      code: error.code,
      body: error.body,
      response: error.response?.data || error.response,
      stack: error.stack,
    });
    
    // Log the full error object for debugging
    logger.error(`[PAYMENT_SERVICE] Full error object: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`);
    
    // Check for common issues
    if (error.message?.includes('401') || error.status === 401 || error.statusCode === 401) {
      logger.error(`[PAYMENT_SERVICE] 401 Unauthorized - Check if DODO_PAYMENTS_API_KEY is correct and has proper permissions`);
      logger.error(`[PAYMENT_SERVICE] API Key configured: ${DODO_PAYMENTS_API_KEY ? 'Yes (length: ' + DODO_PAYMENTS_API_KEY.length + ')' : 'No'}`);
      logger.error(`[PAYMENT_SERVICE] API Key prefix: ${DODO_PAYMENTS_API_KEY ? DODO_PAYMENTS_API_KEY.substring(0, 10) + '...' : 'N/A'}`);
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Get or create Dodo customer for a user
 */
export async function getOrCreateCustomer(userId: string, email: string, name?: string): Promise<string | null> {
  const client = getDodoClient();
  if (!client) return null;
  
  try {
    // Check if customer already exists
    const [existingPlan] = await sequelize.query<any>(
      `SELECT dodo_customer_id FROM user_plans WHERE user_id = :userId AND dodo_customer_id IS NOT NULL`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    
    if (existingPlan?.dodo_customer_id) {
      return existingPlan.dodo_customer_id;
    }
    
    // Create new customer
    const customer = await client.customers.create({
      email,
      name: name || email.split('@')[0],
    });
    
    // Store customer ID
    await sequelize.query(
      `UPDATE user_plans SET dodo_customer_id = :customerId WHERE user_id = :userId`,
      { replacements: { customerId: customer.customer_id, userId }, type: QueryTypes.UPDATE }
    );
    
    return customer.customer_id;
  } catch (error: any) {
    logger.error(`[PAYMENT_SERVICE] Failed to get/create customer: ${error.message}`);
    return null;
  }
}

// ============================================
// SUBSCRIPTION MANAGEMENT
// ============================================

/**
 * Get user's active subscription
 */
export async function getUserSubscription(userId: string): Promise<SubscriptionInfo | null> {
  try {
    const [subscription] = await sequelize.query<any>(
      `SELECT 
        s.id,
        s.user_id,
        s.plan_type,
        s.status,
        s.is_lifetime,
        s.amount,
        s.currency,
        s.current_period_start,
        s.current_period_end,
        s.cancel_at_period_end,
        s.dodo_subscription_id,
        s.dodo_customer_id
       FROM subscriptions s
       WHERE s.user_id = :userId AND s.status = 'active'
       ORDER BY s.created_at DESC
       LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    
    if (!subscription) return null;
    
    return {
      id: subscription.id,
      userId: subscription.user_id,
      planType: subscription.plan_type,
      status: subscription.status,
      isLifetime: subscription.is_lifetime,
      amount: parseFloat(subscription.amount),
      currency: subscription.currency,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      dodoSubscriptionId: subscription.dodo_subscription_id,
      dodoCustomerId: subscription.dodo_customer_id,
    };
  } catch (error: any) {
    logger.error(`[PAYMENT_SERVICE] Failed to get subscription: ${error.message}`);
    return null;
  }
}

/**
 * Cancel a subscription (at period end)
 */
export async function cancelSubscription(userId: string): Promise<{ success: boolean; error?: string }> {
  const client = getDodoClient();
  if (!client) {
    return { success: false, error: 'Payment service not configured' };
  }
  
  try {
    const subscription = await getUserSubscription(userId);
    
    if (!subscription) {
      return { success: false, error: 'No active subscription found' };
    }
    
    if (subscription.isLifetime) {
      return { success: false, error: 'Lifetime subscriptions cannot be cancelled' };
    }
    
    if (subscription.dodoSubscriptionId) {
      // Cancel in Dodo Payments
      await client.subscriptions.update(subscription.dodoSubscriptionId, {
        status: 'cancelled',
      });
    }
    
    // Update our database
    await sequelize.query(
      `UPDATE subscriptions 
       SET cancel_at_period_end = TRUE, 
           cancelled_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :subscriptionId`,
      { replacements: { subscriptionId: subscription.id }, type: QueryTypes.UPDATE }
    );
    
    logger.info(`[PAYMENT_SERVICE] Subscription cancelled for user ${userId}`);
    return { success: true };
  } catch (error: any) {
    logger.error(`[PAYMENT_SERVICE] Failed to cancel subscription: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================
// PAYMENT HISTORY
// ============================================

/**
 * Get user's payment history
 */
export async function getPaymentHistory(userId: string, page = 1, pageSize = 20): Promise<{
  payments: PaymentRecord[];
  totalCount: number;
  totalPages: number;
}> {
  try {
    const offset = (page - 1) * pageSize;
    
    const [countResult] = await sequelize.query<any>(
      `SELECT COUNT(*) as count FROM payments WHERE user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    
    const payments = await sequelize.query<any>(
      `SELECT 
        id,
        amount,
        currency,
        status,
        plan_type,
        description,
        payment_method,
        receipt_url,
        created_at
       FROM payments
       WHERE user_id = :userId
       ORDER BY created_at DESC
       LIMIT :pageSize OFFSET :offset`,
      { replacements: { userId, pageSize, offset }, type: QueryTypes.SELECT }
    );
    
    const totalCount = parseInt(countResult.count);
    
    return {
      payments: payments.map(p => ({
        id: p.id,
        amount: parseFloat(p.amount),
        currency: p.currency,
        status: p.status,
        planType: p.plan_type,
        description: p.description,
        paymentMethod: p.payment_method,
        receiptUrl: p.receipt_url,
        createdAt: p.created_at,
      })),
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    };
  } catch (error: any) {
    logger.error(`[PAYMENT_SERVICE] Failed to get payment history: ${error.message}`);
    return { payments: [], totalCount: 0, totalPages: 0 };
  }
}

// ============================================
// WEBHOOK HANDLERS
// ============================================

/**
 * Handle successful payment webhook
 */
export async function handlePaymentSucceeded(
  paymentId: string,
  customerId: string,
  amount: number,
  metadata: Record<string, any>,
  subscriptionId?: string
): Promise<void> {
  const { user_id, plan_type } = metadata;
  
  if (!user_id || !plan_type) {
    logger.error('[PAYMENT_SERVICE] Missing user_id or plan_type in payment metadata');
    return;
  }
  
  try {
    // Create subscription record first
    const isLifetime = plan_type === 'lifetime';
    
    const subscriptionResult = await sequelize.query<any>(
      `INSERT INTO subscriptions (
        user_id, plan_type, dodo_customer_id, dodo_subscription_id, status, is_lifetime, amount, 
        billing_interval, current_period_start, current_period_end
      ) VALUES (
        :userId, :planType, :customerId, :subscriptionId, 'active', :isLifetime, :amount,
        :billingInterval, CURRENT_TIMESTAMP, 
        CASE WHEN :isLifetime THEN NULL 
             WHEN :planType = 'pro_yearly' THEN CURRENT_TIMESTAMP + INTERVAL '1 year'
             ELSE CURRENT_TIMESTAMP + INTERVAL '1 month' END
      ) RETURNING id`,
      {
        replacements: {
          userId: user_id,
          planType: plan_type,
          customerId,
          subscriptionId,
          isLifetime,
          amount: amount / 100,
          billingInterval: isLifetime ? 'one_time' : (plan_type === 'pro_yearly' ? 'yearly' : 'monthly'),
        },
        type: QueryTypes.SELECT,
      }
    );
    
    const subscriptionId_db = (subscriptionResult[0] as any)?.id;
    
    // Record the payment linked to the subscription
    await sequelize.query(
      `INSERT INTO payments (
        user_id, subscription_id, dodo_payment_id, dodo_customer_id, 
        amount, currency, status, plan_type, description, payment_method
      ) VALUES (
        :userId, :subscriptionId, :paymentId, :customerId,
        :amount, :currency, 'succeeded', :planType, :description, 'card'
      )`,
      {
        replacements: {
          userId: user_id,
          subscriptionId: subscriptionId_db,
          paymentId,
          customerId,
          amount: amount / 100,
          currency: 'INR', // Based on webhook payload
          planType: plan_type,
          description: `Payment for ${plan_type} plan`,
        },
        type: QueryTypes.INSERT,
      }
    );
    
    // Upgrade user plan
    await sequelize.query(
      `SELECT upgrade_user_plan(:userId, :planType, :customerId, NULL, :isLifetime)`,
      {
        replacements: {
          userId: user_id,
          planType: plan_type,
          customerId,
          isLifetime,
        },
        type: QueryTypes.SELECT,
      }
    );
    
    logger.info(`[PAYMENT_SERVICE] Payment succeeded for user ${user_id}, plan: ${plan_type}`);
  } catch (error: any) {
    logger.error(`[PAYMENT_SERVICE] Failed to handle payment success: ${error.message}`);
    throw error;
  }
}

/**
 * Handle failed payment webhook
 */
export async function handlePaymentFailed(
  paymentId: string,
  customerId: string,
  amount: number,
  failureReason: string,
  metadata: Record<string, any>
): Promise<{ userId?: string; email?: string }> {
  const { user_id, plan_type } = metadata;
  
  try {
    // Record the failed payment
    await sequelize.query(
      `INSERT INTO payments (user_id, dodo_payment_id, dodo_customer_id, amount, status, plan_type, failure_reason)
       VALUES (:userId, :paymentId, :customerId, :amount, 'failed', :planType, :failureReason)`,
      {
        replacements: {
          userId: user_id || null,
          paymentId,
          customerId,
          amount: amount / 100,
          planType: plan_type || null,
          failureReason,
        },
        type: QueryTypes.INSERT,
      }
    );
    
    // Get user email for notification
    if (user_id) {
      const [user] = await sequelize.query<any>(
        `SELECT email FROM users WHERE id = :userId`,
        { replacements: { userId: user_id }, type: QueryTypes.SELECT }
      );
      
      logger.warn(`[PAYMENT_SERVICE] Payment failed for user ${user_id}: ${failureReason}`);
      return { userId: user_id, email: user?.email };
    }
    
    return {};
  } catch (error: any) {
    logger.error(`[PAYMENT_SERVICE] Failed to handle payment failure: ${error.message}`);
    return {};
  }
}

/**
 * Handle subscription cancelled webhook
 */
export async function handleSubscriptionCancelled(
  subscriptionId: string,
  customerId: string
): Promise<void> {
  try {
    // Find subscription by Dodo subscription ID
    const [subscription] = await sequelize.query<any>(
      `SELECT user_id FROM subscriptions WHERE dodo_subscription_id = :subscriptionId`,
      { replacements: { subscriptionId }, type: QueryTypes.SELECT }
    );
    
    if (!subscription) {
      // Try finding by customer ID
      const [byCustomer] = await sequelize.query<any>(
        `SELECT user_id FROM subscriptions WHERE dodo_customer_id = :customerId AND status = 'active'`,
        { replacements: { customerId }, type: QueryTypes.SELECT }
      );
      
      if (!byCustomer) {
        logger.warn(`[PAYMENT_SERVICE] Subscription not found for cancellation: ${subscriptionId}`);
        return;
      }
    }
    
    const userId = subscription?.user_id;
    
    // Update subscription status
    await sequelize.query(
      `UPDATE subscriptions 
       SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE dodo_subscription_id = :subscriptionId OR (dodo_customer_id = :customerId AND status = 'active')`,
      { replacements: { subscriptionId, customerId }, type: QueryTypes.UPDATE }
    );
    
    // Downgrade user to free tier
    if (userId) {
      await sequelize.query(
        `SELECT downgrade_user_to_free(:userId)`,
        { replacements: { userId }, type: QueryTypes.SELECT }
      );
    }
    
    logger.info(`[PAYMENT_SERVICE] Subscription cancelled: ${subscriptionId}`);
  } catch (error: any) {
    logger.error(`[PAYMENT_SERVICE] Failed to handle subscription cancellation: ${error.message}`);
    throw error;
  }
}

/**
 * Handle subscription renewed webhook
 */
export async function handleSubscriptionRenewed(
  subscriptionId: string,
  customerId: string,
  periodEnd: Date
): Promise<void> {
  try {
    logger.info(`[PAYMENT_SERVICE] Handling subscription renewal: sub=${subscriptionId}, cust=${customerId}`);
    
    // Update subscription period
    await sequelize.query(
      `UPDATE subscriptions 
       SET current_period_start = CURRENT_TIMESTAMP,
           current_period_end = :periodEnd,
           updated_at = CURRENT_TIMESTAMP
       WHERE dodo_subscription_id = :subscriptionId OR dodo_customer_id = :customerId`,
      { replacements: { subscriptionId, customerId, periodEnd }, type: QueryTypes.UPDATE }
    );
    
    // Get user ID to reset usage
    const [subscription] = await sequelize.query<any>(
      `SELECT user_id FROM subscriptions WHERE dodo_subscription_id = :subscriptionId OR dodo_customer_id = :customerId`,
      { replacements: { subscriptionId, customerId }, type: QueryTypes.SELECT }
    );
    
    if (subscription?.user_id) {
      // Reset usage counters for new billing period
      await sequelize.query(
        `UPDATE user_plans 
         SET ai_tokens_used = 0, 
             queries_used = 0,
             billing_cycle_start = CURRENT_TIMESTAMP,
             billing_cycle_end = :periodEnd,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = :userId`,
        { replacements: { userId: subscription.user_id, periodEnd }, type: QueryTypes.UPDATE }
      );
    }
    
    logger.info(`[PAYMENT_SERVICE] Subscription renewed: ${subscriptionId}`);
  } catch (error: any) {
    logger.error(`[PAYMENT_SERVICE] Failed to handle subscription renewal: ${error.message}`);
    throw error;
  }
}

// ============================================
// PLAN LIMIT CHECKING
// ============================================

/**
 * Check if user is in read-only mode (free tier exhausted)
 */
export async function checkUserReadOnly(userId: string): Promise<{
  isReadOnly: boolean;
  planType: string;
  tokensUsed: number;
  tokensLimit: number;
  queriesUsed: number;
  queriesLimit: number;
}> {
  try {
    const [plan] = await sequelize.query<any>(
      `SELECT 
        plan_type, 
        ai_tokens_used, 
        ai_tokens_limit, 
        queries_used, 
        queries_limit,
        is_lifetime,
        check_user_read_only(:userId) as is_read_only
       FROM user_plans 
       WHERE user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    
    if (!plan) {
      return {
        isReadOnly: false,
        planType: 'free',
        tokensUsed: 0,
        tokensLimit: 10000,
        queriesUsed: 0,
        queriesLimit: 500,
      };
    }
    
    return {
      isReadOnly: plan.is_read_only,
      planType: plan.plan_type,
      tokensUsed: plan.ai_tokens_used,
      tokensLimit: plan.ai_tokens_limit,
      queriesUsed: plan.queries_used,
      queriesLimit: plan.queries_limit,
    };
  } catch (error: any) {
    logger.error(`[PAYMENT_SERVICE] Failed to check read-only status: ${error.message}`);
    return {
      isReadOnly: false,
      planType: 'free',
      tokensUsed: 0,
      tokensLimit: 10000,
      queriesUsed: 0,
      queriesLimit: 500,
    };
  }
}

export default {
  createCheckoutSession,
  getOrCreateCustomer,
  getUserSubscription,
  cancelSubscription,
  getPaymentHistory,
  handlePaymentSucceeded,
  handlePaymentFailed,
  handleSubscriptionCancelled,
  handleSubscriptionRenewed,
  checkUserReadOnly,
};

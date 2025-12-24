import { Request, Response } from 'express';
import { sequelize } from '../config/db';
import { QueryTypes } from 'sequelize';
import { logger } from '../utils/logger';

// ============================================
// USAGE CONTROLLER
// Handles user usage statistics and plan information
// ============================================

/**
 * Get user's usage dashboard data
 * Returns plan info, token usage, query stats, connections
 */
export const getUsageDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // Get plan and usage summary using the database function
    const [planData] = await sequelize.query<any>(
      `SELECT * FROM get_user_usage_dashboard(:userId)`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
      }
    );

    // If no plan exists, create default
    if (!planData) {
      await sequelize.query(
        `INSERT INTO user_plans (user_id, plan_type, ai_tokens_limit, queries_limit, connections_limit, storage_limit_mb)
         SELECT :userId, 'free', ai_tokens_limit, queries_limit, connections_limit, storage_limit_mb
         FROM plan_configurations WHERE plan_type = 'free'
         ON CONFLICT (user_id) DO NOTHING`,
        {
          replacements: { userId },
          type: QueryTypes.INSERT,
        }
      );
      
      // Re-fetch
      const [newPlanData] = await sequelize.query<any>(
        `SELECT * FROM get_user_usage_dashboard(:userId)`,
        {
          replacements: { userId },
          type: QueryTypes.SELECT,
        }
      );
      
      if (newPlanData) {
        Object.assign(planData || {}, newPlanData);
      }
    }

    // Get query statistics for this billing period
    const billingStart = planData?.billing_cycle_start || new Date(new Date().setDate(1));
    
    const [queryStats] = await sequelize.query<any>(
      `SELECT 
        COUNT(*) as total_queries,
        COUNT(CASE WHEN is_ai_generated = true THEN 1 END) as ai_queries,
        COUNT(CASE WHEN is_ai_generated = false OR is_ai_generated IS NULL THEN 1 END) as manual_queries,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_queries,
        COUNT(CASE WHEN status = 'error' THEN 1 END) as failed_queries,
        COALESCE(AVG(execution_time_ms), 0)::INTEGER as avg_execution_time
       FROM queries
       WHERE user_id = :userId
         AND created_at >= :billingStart`,
      {
        replacements: { userId, billingStart },
        type: QueryTypes.SELECT,
      }
    );

    // Get token usage breakdown by operation type
    const tokenBreakdown = await sequelize.query<any>(
      `SELECT 
        operation_type,
        SUM(total_tokens) as total_tokens,
        COUNT(*) as operation_count
       FROM ai_token_usage
       WHERE user_id = :userId
         AND created_at >= :billingStart
       GROUP BY operation_type
       ORDER BY total_tokens DESC`,
      {
        replacements: { userId, billingStart },
        type: QueryTypes.SELECT,
      }
    );

    // Get daily token usage for the last 30 days
    const dailyTokenUsage = await sequelize.query<any>(
      `SELECT 
        DATE(created_at) as date,
        SUM(total_tokens) as tokens,
        COUNT(*) as operations
       FROM ai_token_usage
       WHERE user_id = :userId
         AND created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
      }
    );

    // Get daily query count for the last 30 days
    const dailyQueries = await sequelize.query<any>(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        COUNT(CASE WHEN is_ai_generated = true THEN 1 END) as ai_count
       FROM queries
       WHERE user_id = :userId
         AND created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
      }
    );

    // Get recent AI operations
    const recentOperations = await sequelize.query<any>(
      `SELECT 
        id,
        operation_type,
        model,
        input_tokens,
        output_tokens,
        total_tokens,
        prompt_preview,
        execution_time_ms,
        created_at
       FROM ai_token_usage
       WHERE user_id = :userId
       ORDER BY created_at DESC
       LIMIT 10`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
      }
    );

    // Calculate usage percentages
    const tokenUsagePercent = planData?.ai_tokens_limit > 0 && planData?.ai_tokens_limit !== -1
      ? Math.round((planData.ai_tokens_used / planData.ai_tokens_limit) * 100)
      : 0;

    const queryUsagePercent = planData?.queries_limit > 0 && planData?.queries_limit !== -1
      ? Math.round((planData.queries_used / planData.queries_limit) * 100)
      : 0;

    const connectionUsagePercent = planData?.connections_limit > 0 && planData?.connections_limit !== -1
      ? Math.round((Number(planData.connections_used) / planData.connections_limit) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        plan: {
          type: planData?.plan_type || 'free',
          displayName: planData?.plan_display_name || 'Free',
          billingCycleStart: planData?.billing_cycle_start,
          billingCycleEnd: planData?.billing_cycle_end,
          daysRemaining: planData?.days_remaining || 0,
        },
        tokens: {
          limit: planData?.ai_tokens_limit || 10000,
          used: planData?.ai_tokens_used || 0,
          remaining: planData?.ai_tokens_remaining || 10000,
          usagePercent: tokenUsagePercent,
          isUnlimited: planData?.ai_tokens_limit === -1,
        },
        queries: {
          limit: planData?.queries_limit || 1000,
          used: planData?.queries_used || 0,
          remaining: planData?.queries_remaining || 1000,
          usagePercent: queryUsagePercent,
          isUnlimited: planData?.queries_limit === -1,
          stats: queryStats || {},
        },
        connections: {
          limit: planData?.connections_limit || 3,
          used: Number(planData?.connections_used) || 0,
          usagePercent: connectionUsagePercent,
          isUnlimited: planData?.connections_limit === -1,
        },
        tokenBreakdown: tokenBreakdown || [],
        dailyTokenUsage: dailyTokenUsage || [],
        dailyQueries: dailyQueries || [],
        recentOperations: recentOperations || [],
      },
    });
  } catch (error: any) {
    logger.error('[USAGE_CONTROLLER] Error fetching dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch usage dashboard',
      error: error.message,
    });
  }
};

/**
 * Get available plans
 */
export const getAvailablePlans = async (_req: Request, res: Response): Promise<void> => {
  try {
    const plans = await sequelize.query<any>(
      `SELECT 
        plan_type,
        display_name,
        description,
        price_monthly,
        price_yearly,
        ai_tokens_limit,
        queries_limit,
        connections_limit,
        storage_limit_mb,
        features
       FROM plan_configurations
       WHERE is_active = true
       ORDER BY sort_order ASC`,
      {
        type: QueryTypes.SELECT,
      }
    );

    res.json({
      success: true,
      data: plans.map(plan => ({
        ...plan,
        features: typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features,
      })),
    });
  } catch (error: any) {
    logger.error('[USAGE_CONTROLLER] Error fetching plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch plans',
      error: error.message,
    });
  }
};

/**
 * Get token usage history with pagination
 */
export const getTokenHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
    const offset = (page - 1) * pageSize;

    const [countResult] = await sequelize.query<any>(
      `SELECT COUNT(*) as count FROM ai_token_usage WHERE user_id = :userId`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
      }
    );

    const history = await sequelize.query<any>(
      `SELECT 
        atu.id,
        atu.operation_type,
        atu.model,
        atu.input_tokens,
        atu.output_tokens,
        atu.total_tokens,
        atu.prompt_preview,
        atu.response_preview,
        atu.execution_time_ms,
        atu.created_at,
        c.name as connection_name
       FROM ai_token_usage atu
       LEFT JOIN connections c ON atu.connection_id = c.id
       WHERE atu.user_id = :userId
       ORDER BY atu.created_at DESC
       LIMIT :pageSize OFFSET :offset`,
      {
        replacements: { userId, pageSize, offset },
        type: QueryTypes.SELECT,
      }
    );

    res.json({
      success: true,
      data: history,
      pagination: {
        page,
        pageSize,
        totalCount: parseInt(countResult.count),
        totalPages: Math.ceil(parseInt(countResult.count) / pageSize),
      },
    });
  } catch (error: any) {
    logger.error('[USAGE_CONTROLLER] Error fetching token history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch token history',
      error: error.message,
    });
  }
};

/**
 * Increment user's query count (called after query execution)
 */
export const incrementQueryCount = async (userId: string): Promise<void> => {
  try {
    await sequelize.query(
      `UPDATE user_plans 
       SET queries_used = queries_used + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = :userId`,
      {
        replacements: { userId },
        type: QueryTypes.UPDATE,
      }
    );
  } catch (error: any) {
    logger.error('[USAGE_CONTROLLER] Error incrementing query count:', error);
  }
};

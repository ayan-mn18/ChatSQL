import { Request, Response, NextFunction } from 'express';
import { sequelize } from '../config/db';
import { QueryTypes } from 'sequelize';
import { logger } from '../utils/logger';

// ============================================
// PLAN LIMITS MIDDLEWARE
// Enforces usage limits based on user's subscription plan
// Free tier users get read-only access when limits exhausted
// ============================================

/**
 * Extended request type with plan info
 */
declare global {
  namespace Express {
    interface Request {
      planInfo?: {
        planType: string;
        isReadOnly: boolean;
        tokensUsed: number;
        tokensLimit: number;
        tokensRemaining: number;
        queriesUsed: number;
        queriesLimit: number;
        queriesRemaining: number;
        connectionsUsed: number;
        connectionsLimit: number;
        isLifetime: boolean;
      };
    }
  }
}

/**
 * Middleware to check and attach user's plan information
 * Does not block requests, just attaches plan info to request
 */
export const attachPlanInfo = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      next();
      return;
    }

    const [planData] = await sequelize.query<any>(
      `SELECT 
        up.plan_type,
        up.ai_tokens_used,
        up.ai_tokens_limit,
        up.queries_used,
        up.queries_limit,
        up.connections_limit,
        up.is_lifetime,
        check_user_read_only(:userId) as is_read_only,
        (SELECT COUNT(*) FROM connections c WHERE c.user_id = :userId) as connections_used
       FROM user_plans up
       WHERE up.user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    if (planData) {
      const tokensLimit = planData.ai_tokens_limit;
      const queriesLimit = planData.queries_limit;
      
      req.planInfo = {
        planType: planData.plan_type,
        isReadOnly: planData.is_read_only,
        tokensUsed: planData.ai_tokens_used,
        tokensLimit,
        tokensRemaining: tokensLimit === -1 ? -1 : Math.max(0, tokensLimit - planData.ai_tokens_used),
        queriesUsed: planData.queries_used,
        queriesLimit,
        queriesRemaining: queriesLimit === -1 ? -1 : Math.max(0, queriesLimit - planData.queries_used),
        connectionsUsed: parseInt(planData.connections_used),
        connectionsLimit: planData.connections_limit,
        isLifetime: planData.is_lifetime,
      };
    } else {
      // Default free tier info for users without plan record
      req.planInfo = {
        planType: 'free',
        isReadOnly: false,
        tokensUsed: 0,
        tokensLimit: 10000,
        tokensRemaining: 10000,
        queriesUsed: 0,
        queriesLimit: 500,
        queriesRemaining: 500,
        connectionsUsed: 0,
        connectionsLimit: 2,
        isLifetime: false,
      };
    }

    next();
  } catch (error: any) {
    logger.error('[PLAN_LIMITS] Error attaching plan info:', error);
    next(); // Don't block on errors
  }
};

/**
 * Middleware to enforce read-only mode for exhausted free tier users
 * Blocks INSERT, UPDATE, DELETE operations
 */
export const enforceReadOnly = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      next();
      return;
    }

    // Get or use attached plan info
    if (!req.planInfo) {
      const [planData] = await sequelize.query<any>(
        `SELECT check_user_read_only(:userId) as is_read_only, plan_type
         FROM user_plans WHERE user_id = :userId`,
        { replacements: { userId }, type: QueryTypes.SELECT }
      );

      if (planData?.is_read_only) {
        res.status(403).json({
          success: false,
          message: 'Your free tier limits have been exhausted. Please upgrade to continue making changes.',
          code: 'READ_ONLY_MODE',
          readOnly: true,
          upgradeUrl: '/dashboard/pricing',
        });
        return;
      }
    } else if (req.planInfo.isReadOnly) {
      res.status(403).json({
        success: false,
        message: 'Your free tier limits have been exhausted. Please upgrade to continue making changes.',
        code: 'READ_ONLY_MODE',
        readOnly: true,
        upgradeUrl: '/dashboard/pricing',
      });
      return;
    }

    next();
  } catch (error: any) {
    logger.error('[PLAN_LIMITS] Error enforcing read-only:', error);
    next(); // Don't block on errors
  }
};

/**
 * Middleware to check if user can make AI requests
 * Blocks if token limit is exhausted
 */
export const checkAITokenLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const [planData] = await sequelize.query<any>(
      `SELECT 
        plan_type,
        ai_tokens_used,
        ai_tokens_limit,
        is_lifetime
       FROM user_plans 
       WHERE user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    if (!planData) {
      // No plan found - allow with default limits
      next();
      return;
    }

    const { ai_tokens_limit, ai_tokens_used, is_lifetime, plan_type } = planData;

    // Unlimited tokens for lifetime and enterprise
    if (ai_tokens_limit === -1 || is_lifetime || plan_type === 'enterprise') {
      next();
      return;
    }

    // Check if tokens are exhausted
    if (ai_tokens_used >= ai_tokens_limit) {
      res.status(403).json({
        success: false,
        message: 'You have used all your AI tokens for this billing period. Please upgrade your plan to continue using AI features.',
        code: 'TOKEN_LIMIT_EXCEEDED',
        readOnly: true,
        tokensUsed: ai_tokens_used,
        tokensLimit: ai_tokens_limit,
        upgradeUrl: '/dashboard/pricing',
      });
      return;
    }

    // Add remaining tokens to request for logging
    req.planInfo = {
      ...req.planInfo,
      planType: plan_type,
      tokensUsed: ai_tokens_used,
      tokensLimit: ai_tokens_limit,
      tokensRemaining: ai_tokens_limit - ai_tokens_used,
    } as any;

    next();
  } catch (error: any) {
    logger.error('[PLAN_LIMITS] Error checking AI token limit:', error);
    next(); // Don't block on errors
  }
};

/**
 * Middleware to check if user can execute more queries
 * Blocks if query limit is exhausted
 */
export const checkQueryLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const [planData] = await sequelize.query<any>(
      `SELECT 
        plan_type,
        queries_used,
        queries_limit,
        is_lifetime
       FROM user_plans 
       WHERE user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    if (!planData) {
      next();
      return;
    }

    const { queries_limit, queries_used, is_lifetime, plan_type } = planData;

    // Unlimited queries for lifetime and enterprise
    if (queries_limit === -1 || is_lifetime || plan_type === 'enterprise') {
      next();
      return;
    }

    // Check if queries are exhausted
    if (queries_used >= queries_limit) {
      res.status(403).json({
        success: false,
        message: 'You have used all your queries for this billing period. Please upgrade your plan to continue executing queries.',
        code: 'QUERY_LIMIT_EXCEEDED',
        readOnly: true,
        queriesUsed: queries_used,
        queriesLimit: queries_limit,
        upgradeUrl: '/dashboard/pricing',
      });
      return;
    }

    next();
  } catch (error: any) {
    logger.error('[PLAN_LIMITS] Error checking query limit:', error);
    next();
  }
};

/**
 * Middleware to check if user can add more connections
 */
export const checkConnectionLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const [planData] = await sequelize.query<any>(
      `SELECT 
        up.connections_limit,
        up.is_lifetime,
        up.plan_type,
        (SELECT COUNT(*) FROM connections c WHERE c.user_id = :userId) as connections_used
       FROM user_plans up
       WHERE up.user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    if (!planData) {
      next();
      return;
    }

    const { connections_limit, is_lifetime, plan_type, connections_used } = planData;

    // Unlimited connections for lifetime and enterprise
    if (connections_limit === -1 || is_lifetime || plan_type === 'enterprise') {
      next();
      return;
    }

    // Check if connection limit reached
    if (parseInt(connections_used) >= connections_limit) {
      res.status(403).json({
        success: false,
        message: `You have reached your limit of ${connections_limit} database connections. Please upgrade your plan to add more connections.`,
        code: 'CONNECTION_LIMIT_EXCEEDED',
        connectionsUsed: parseInt(connections_used),
        connectionsLimit: connections_limit,
        upgradeUrl: '/dashboard/pricing',
      });
      return;
    }

    next();
  } catch (error: any) {
    logger.error('[PLAN_LIMITS] Error checking connection limit:', error);
    next();
  }
};

/**
 * Middleware to validate query type for read-only mode
 * Only allows SELECT queries when in read-only mode
 */
export const enforceSelectOnly = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      next();
      return;
    }

    // Check if in read-only mode
    const [planData] = await sequelize.query<any>(
      `SELECT check_user_read_only(:userId) as is_read_only FROM user_plans WHERE user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    if (!planData?.is_read_only) {
      next();
      return;
    }

    // Get query from request body
    const query = req.body.query || req.body.sql || req.body.queryText || '';
    const normalizedQuery = query.trim().toUpperCase();

    // Only allow SELECT queries
    const allowedOperations = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'WITH'];
    const isAllowed = allowedOperations.some(op => normalizedQuery.startsWith(op));

    if (!isAllowed) {
      res.status(403).json({
        success: false,
        message: 'Your free tier limits have been exhausted. Only SELECT queries are allowed in read-only mode. Please upgrade to perform INSERT, UPDATE, or DELETE operations.',
        code: 'READ_ONLY_MODE',
        readOnly: true,
        upgradeUrl: '/dashboard/pricing',
      });
      return;
    }

    next();
  } catch (error: any) {
    logger.error('[PLAN_LIMITS] Error enforcing select-only:', error);
    next();
  }
};

export default {
  attachPlanInfo,
  enforceReadOnly,
  checkAITokenLimit,
  checkQueryLimit,
  checkConnectionLimit,
  enforceSelectOnly,
};

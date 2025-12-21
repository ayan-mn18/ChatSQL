import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWTPayload, UserPublic } from '../types';
import { logger } from '../utils/logger';
import { sequelize } from '../config/db';
import { QueryTypes } from 'sequelize';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: UserPublic;
      userId?: string;
      userRole?: 'super_admin' | 'viewer';
    }
  }
}

const { JWT_SECRET } = process.env;

/**
 * Authentication middleware
 * Verifies JWT token from cookies and attaches user to request
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Check cookie first, then Authorization header, then query param (for SSE)
    const token = req.cookies?.['chatsql-access-token'] || 
                  req.headers.authorization?.replace('Bearer ', '') ||
                  (req.query.token as string);

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    if (!JWT_SECRET) {
      logger.error('JWT_SECRET is not configured');
      res.status(500).json({
        success: false,
        error: 'Server configuration error',
        code: 'CONFIG_ERROR'
      });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    
    req.userId = decoded.userId;
    
    // Fetch user role from database
    try {
      const [user] = await sequelize.query<{ role: string; is_active: boolean }>(
        `SELECT role, is_active FROM users WHERE id = :userId LIMIT 1`,
        { replacements: { userId: decoded.userId }, type: QueryTypes.SELECT }
      );
      
      if (!user || !user.is_active) {
        res.status(401).json({
          success: false,
          error: 'User account is not active',
          code: 'ACCOUNT_INACTIVE'
        });
        return;
      }
      
      req.userRole = (user.role || 'super_admin') as 'super_admin' | 'viewer';
    } catch (dbError) {
      logger.error('Failed to fetch user role:', dbError);
      // Default to super_admin for backward compatibility
      req.userRole = 'super_admin';
    }
    
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
      return;
    }

    logger.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Optional authentication middleware
 * Attaches user to request if token exists, but doesn't block if not
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.cookies?.['chatsql-access-token'] || 
                  req.headers.authorization?.replace('Bearer ', '');

    if (token && JWT_SECRET) {
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
      req.userId = decoded.userId;
    }

    next();
  } catch (error) {
    // Silently continue without auth for optional routes
    next();
  }
};

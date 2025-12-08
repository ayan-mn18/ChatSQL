import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Global error handler middleware
 * Catches all unhandled errors and returns consistent error responses
 */
export const errorHandler = (
  err: Error & { statusCode?: number; code?: string },
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';

  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal server error',
    code,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

/**
 * Not found handler
 * Catches all requests to undefined routes
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND'
  });
};

/**
 * Custom error class with status code
 */
export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Common error factory functions
export const BadRequestError = (message: string) => new AppError(message, 400, 'BAD_REQUEST');
export const UnauthorizedError = (message: string) => new AppError(message, 401, 'UNAUTHORIZED');
export const ForbiddenError = (message: string) => new AppError(message, 403, 'FORBIDDEN');
export const NotFoundError = (message: string) => new AppError(message, 404, 'NOT_FOUND');
export const ConflictError = (message: string) => new AppError(message, 409, 'CONFLICT');
export const ValidationError = (message: string) => new AppError(message, 422, 'VALIDATION_ERROR');

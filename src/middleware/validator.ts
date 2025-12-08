import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

/**
 * Request validation middleware factory
 * Validates request body, query, and params against Zod schemas
 */
export const validate = (schema: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schema.body) {
        req.body = schema.body.parse(req.body);
      }
      if (schema.query) {
        req.query = schema.query.parse(req.query);
      }
      if (schema.params) {
        req.params = schema.params.parse(req.params);
      }
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));

        res.status(400).json({
          success: false,
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: errors
        });
        return;
      }
      next(error);
    }
  };
};

// ============================================
// AUTH VALIDATION SCHEMAS
// ============================================
export const registerSchema = {
  body: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string()
      .min(8, 'Password must be at least 8 characters')
      .max(100, 'Password must be less than 100 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    username: z.string()
      .min(3, 'Username must be at least 3 characters')
      .max(50, 'Username must be less than 50 characters')
      .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
      .optional()
  })
};

export const loginSchema = {
  body: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required')
  })
};

export const verifyEmailSchema = {
  body: z.object({
    email: z.string().email('Invalid email format'),
    otp: z.string()
      .length(6, 'OTP must be 6 digits')
      .regex(/^\d{6}$/, 'OTP must contain only digits')
  })
};

export const resendOtpSchema = {
  body: z.object({
    email: z.string().email('Invalid email format')
  })
};

export const forgotPasswordSchema = {
  body: z.object({
    email: z.string().email('Invalid email format')
  })
};

export const resetPasswordSchema = {
  body: z.object({
    token: z.string().min(1, 'Reset token is required'),
    newPassword: z.string()
      .min(8, 'Password must be at least 8 characters')
      .max(100, 'Password must be less than 100 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number')
  })
};

export const changePasswordSchema = {
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string()
      .min(8, 'Password must be at least 8 characters')
      .max(100, 'Password must be less than 100 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number')
  })
};

export const deleteAccountSchema = {
  body: z.object({
    password: z.string().min(1, 'Password is required')
  })
};

export const updateProfileSchema = {
  body: z.object({
    username: z.string()
      .min(3, 'Username must be at least 3 characters')
      .max(50, 'Username must be less than 50 characters')
      .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
      .optional(),
    profile_url: z.string().url('Invalid URL format').optional()
  })
};

// ============================================
// CONNECTION VALIDATION SCHEMAS
// ============================================
export const testConnectionSchema = {
  body: z.object({
    host: z.string()
      .min(1, 'Host is required')
      .max(255, 'Host must be less than 255 characters'),
    port: z.number()
      .int('Port must be an integer')
      .min(1, 'Port must be at least 1')
      .max(65535, 'Port must be at most 65535'),
    db_name: z.string()
      .min(1, 'Database name is required')
      .max(128, 'Database name must be less than 128 characters'),
    username: z.string()
      .min(1, 'Username is required')
      .max(128, 'Username must be less than 128 characters'),
    password: z.string()
      .min(1, 'Password is required'),
    ssl: z.boolean().optional().default(false)
  })
};

export const createConnectionSchema = {
  body: z.object({
    name: z.string()
      .min(1, 'Connection name is required')
      .max(100, 'Connection name must be less than 100 characters'),
    host: z.string()
      .min(1, 'Host is required')
      .max(255, 'Host must be less than 255 characters'),
    port: z.number()
      .int('Port must be an integer')
      .min(1, 'Port must be at least 1')
      .max(65535, 'Port must be at most 65535'),
    db_name: z.string()
      .min(1, 'Database name is required')
      .max(128, 'Database name must be less than 128 characters'),
    username: z.string()
      .min(1, 'Username is required')
      .max(128, 'Username must be less than 128 characters'),
    password: z.string()
      .min(1, 'Password is required'),
    ssl: z.boolean().optional().default(false)
  })
};

export const updateConnectionSchema = {
  body: z.object({
    name: z.string()
      .min(1, 'Connection name is required')
      .max(100, 'Connection name must be less than 100 characters')
      .optional(),
    host: z.string()
      .min(1, 'Host is required')
      .max(255, 'Host must be less than 255 characters')
      .optional(),
    port: z.number()
      .int('Port must be an integer')
      .min(1, 'Port must be at least 1')
      .max(65535, 'Port must be at most 65535')
      .optional(),
    db_name: z.string()
      .min(1, 'Database name is required')
      .max(128, 'Database name must be less than 128 characters')
      .optional(),
    username: z.string()
      .min(1, 'Username is required')
      .max(128, 'Username must be less than 128 characters')
      .optional(),
    password: z.string()
      .min(1, 'Password is required')
      .optional(),
    ssl: z.boolean().optional()
  })
};

// ============================================
// COMMON VALIDATION SCHEMAS
// ============================================
export const paginationSchema = {
  query: z.object({
    page: z.string().transform(Number).pipe(z.number().min(1)).optional().default('1'),
    pageSize: z.string().transform(Number).pipe(z.number().min(1).max(100)).optional().default('10')
  })
};

export const uuidParamSchema = {
  params: z.object({
    id: z.string().uuid('Invalid ID format')
  })
};

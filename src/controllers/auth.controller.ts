import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import * as emailService from '../services/email.service';
import { generateAccessToken, getAccessTokenCookieOptions, generateRandomToken } from '../utils/auth';
import { logger } from '../utils/logger';
import { logViewerActivity } from '../services/viewer-activity.service';

/**
 * Register a new user (Step 1: Send OTP)
 * POST /api/auth/register
 */
export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, username } = req.body;
    
    // 1. Check if email already exists
    const existingUser = await authService.findByEmail(email);
    
    if (existingUser) {
      // 2. If user exists and is verified, return error
      if (existingUser.is_verified) {
        res.status(409).json({
          success: false,
          error: 'Email is already registered',
          code: 'EMAIL_EXISTS'
        });
        return;
      }
      
      // 3. If user exists but not verified, update password and resend OTP
      await authService.updatePassword(existingUser.id, password);
      
      // Generate new OTP
      const otp = authService.generateOtp();
      await authService.storeEmailVerificationOtp(email, otp);
      
      // Send OTP email
      await emailService.sendVerificationEmail(email, otp);
      
      res.status(200).json({
        success: true,
        message: 'Verification code sent to your email',
        data: {
          email,
          expiresIn: 600 // 10 minutes in seconds
        }
      });
      return;
    }
    
    // 4. Check if username is taken (if provided)
    if (username) {
      const existingUsername = await authService.findByUsername(username);
      if (existingUsername) {
        res.status(409).json({
          success: false,
          error: 'Username is already taken',
          code: 'USERNAME_EXISTS'
        });
        return;
      }
    }
    
    // 5. Create new user (unverified) and generate OTP
    const { user, otp } = await authService.registerUser({ email, password, username });
    
    // 6. Send OTP email
    await emailService.sendVerificationEmail(email, otp);
    
    // 7. Return success message
    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email.',
      data: {
        email: user.email,
        expiresIn: 600 // 10 minutes in seconds
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify email with OTP (Step 2)
 * POST /api/auth/verify-email
 */
export const verifyEmail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, otp } = req.body;

    // 1. Check if user exists
    const user = await authService.findByEmail(email);
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    // 2. Check if already verified
    if (user.is_verified) {
      res.status(400).json({
        success: false,
        error: 'Email is already verified',
        code: 'ALREADY_VERIFIED'
      });
      return;
    }

    // 3. Verify OTP (checks expiry, attempts, and hash match)
    const otpResult = await authService.verifyEmailOtp(email, otp);
    
    if (!otpResult.valid) {
      res.status(400).json({
        success: false,
        error: otpResult.error || 'Invalid OTP',
        code: 'INVALID_OTP'
      });
      return;
    }

    // 4. Mark email as verified
    const verifiedUser = await authService.markEmailAsVerified(email);
    
    if (!verifiedUser) {
      res.status(500).json({
        success: false,
        error: 'Failed to verify email',
        code: 'VERIFICATION_FAILED'
      });
      return;
    }

    // 5. Generate JWT token
    const accessToken = generateAccessToken({
      userId: verifiedUser.id,
      email: verifiedUser.email
    });

    // 6. Set cookie
    res.cookie('chatsql-access-token', accessToken, getAccessTokenCookieOptions());

    // 7. Send welcome email (non-blocking)
    emailService.sendWelcomeEmail(email, verifiedUser.username || undefined);

    // 8. Update last login
    await authService.updateLastLogin(verifiedUser.id);

    // 9. Trigger schema refresh for all user connections
    try {
      const { addRefreshSchemaJob } = await import('../queues/schema-sync.queue');
      const { QueryTypes } = await import('sequelize');
      const { sequelize } = await import('../config/db');
      
      const connections = await sequelize.query<{ id: string }>(
        `SELECT id FROM connections WHERE user_id = $1`,
        {
          bind: [verifiedUser.id],
          type: QueryTypes.SELECT
        }
      );

      for (const conn of connections) {
        await addRefreshSchemaJob({
          connectionId: conn.id,
          userId: verifiedUser.id
        });
      }
      logger.info(`[AUTH] Triggered schema refresh for ${connections.length} connections on verification`, { userId: verifiedUser.id });
    } catch (refreshError) {
      logger.error('[AUTH] Failed to trigger schema refresh on verification:', refreshError);
    }

    // 10. Return user data
    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      data: {
        user: authService.toPublicUser(verifiedUser),
        accessToken
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Resend OTP
 * POST /api/auth/resend-otp
 */
export const resendOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;

    // 1. Check if user exists
    const user = await authService.findByEmail(email);
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'No account found with this email',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    // 2. Check if user is already verified
    if (user.is_verified) {
      res.status(400).json({
        success: false,
        error: 'Email is already verified',
        code: 'ALREADY_VERIFIED'
      });
      return;
    }

    // 3. Check rate limiting - count OTPs sent in last hour
    const recentOtpCount = await authService.countRecentOtps(email, 60); // 60 minutes
    if (recentOtpCount >= 3) {
      res.status(429).json({
        success: false,
        error: 'Too many OTP requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
      });
      return;
    }

    // 4. Generate new OTP (storeEmailVerificationOtp invalidates previous OTPs)
    const otp = authService.generateOtp();
    await authService.storeEmailVerificationOtp(email, otp);

    // 5. Send OTP email
    const emailSent = await emailService.sendVerificationEmail(email, otp);
    
    if (!emailSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to send verification email. Please try again.',
        code: 'EMAIL_SEND_FAILED'
      });
      return;
    }

    // 6. Return success with expiry time
    res.status(200).json({
      success: true,
      message: 'Verification code sent to your email',
      data: {
        email,
        expiresIn: 600 // 10 minutes in seconds
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login user
 * POST /api/auth/login
 */
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;

    // 1. Find user by email
    const user = await authService.findByEmail(email);
    
    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
      return;
    }

    // 2. Check if email is verified
    if (!user.is_verified) {
      res.status(403).json({
        success: false,
        error: 'Please verify your email before logging in',
        code: 'EMAIL_NOT_VERIFIED'
      });
      return;
    }

    // 3. Check if account is active
    if (!user.is_active) {
      res.status(403).json({
        success: false,
        error: 'Your account has been deactivated',
        code: 'ACCOUNT_DEACTIVATED'
      });
      return;
    }

    // 4. Verify password
    const isValidPassword = await authService.verifyPassword(password, user.password_hash);
    
    if (!isValidPassword) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
      return;
    }

    // 5. Update last_login_at
    await authService.updateLastLogin(user.id);

    if (user.role === 'viewer') {
      await logViewerActivity({
        viewerUserId: user.id,
        actionType: 'login',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || null,
        actionDetails: null,
      });
    }

    // 6. Generate JWT token
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email
    });

    // 7. Set cookie
    res.cookie('chatsql-access-token', accessToken, getAccessTokenCookieOptions());

    // 8. Trigger schema refresh for all user connections
    try {
      const { addRefreshSchemaJob } = await import('../queues/schema-sync.queue');
      const { QueryTypes } = await import('sequelize');
      const { sequelize } = await import('../config/db');
      
      const connections = await sequelize.query<{ id: string }>(
        `SELECT id FROM connections WHERE user_id = $1`,
        {
          bind: [user.id],
          type: QueryTypes.SELECT
        }
      );

      for (const conn of connections) {
        await addRefreshSchemaJob({
          connectionId: conn.id,
          userId: user.id
        });
      }
      logger.info(`[AUTH] Triggered schema refresh for ${connections.length} connections on login`, { userId: user.id });
    } catch (refreshError) {
      logger.error('[AUTH] Failed to trigger schema refresh on login:', refreshError);
      // Don't fail login if refresh trigger fails
    }

    // 9. Return user data
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: authService.toPublicUser(user),
        accessToken
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Logout user
 * POST /api/auth/logout
 */
export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Clear the JWT cookie
    res.clearCookie('chatsql-access-token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Forgot password - Send reset email
 * POST /api/auth/forgot-password
 */
export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;

    // 1. Find user by email
    const user = await authService.findByEmail(email);
    
    // 2. If user doesn't exist, still return success (security - don't reveal if email exists)
    if (!user) {
      res.status(200).json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
      return;
    }

    // 3. Generate reset token
    const resetToken = generateRandomToken();

    // 4. Hash token and store in password_resets table
    await authService.storePasswordResetToken(user.id, resetToken);

    // 5. Create reset URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    // 6. Send password reset email
    await emailService.sendPasswordResetEmail(email, resetToken, resetUrl);

    // 7. Return success message
    res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Reset password with token
 * POST /api/auth/reset-password
 */
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token, newPassword } = req.body;

    // 1. Verify token (checks if valid, not expired, not used)
    const tokenResult = await authService.verifyPasswordResetToken(token);

    if (!tokenResult.valid || !tokenResult.userId) {
      res.status(400).json({
        success: false,
        error: tokenResult.error || 'Invalid or expired reset token',
        code: 'INVALID_TOKEN'
      });
      return;
    }

    // 2. Get user
    const user = await authService.findById(tokenResult.userId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    // 3. Update user password
    await authService.updatePassword(user.id, newPassword);

    // 4. Return success message
    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user
 * GET /api/auth/me
 */
export const getCurrentUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    // 1. Fetch user from database by userId
    const user = await authService.findById(userId);

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    // 2. Return public user data (exclude password_hash)
    res.status(200).json({
      success: true,
      data: {
        user: authService.toPublicUser(user)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update user profile
 * PUT /api/auth/profile
 */
export const updateProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req;
    const { username, profile_url } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    // 1. Check if username is already taken (if changing)
    if (username) {
      const existingUser = await authService.findByUsername(username);
      if (existingUser && existingUser.id !== userId) {
        res.status(409).json({
          success: false,
          error: 'Username is already taken',
          code: 'USERNAME_EXISTS'
        });
        return;
      }
    }

    // 2. Update user in database
    const updatedUser = await authService.updateProfile(userId, { username, profile_url });

    if (!updatedUser) {
      res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    // 3. Return updated user data
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: authService.toPublicUser(updatedUser)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Change password
 * POST /api/auth/change-password
 */
export const changePassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req;
    const { currentPassword, newPassword } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    // 1. Get user
    const user = await authService.findById(userId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    // 2. Verify current password
    const isValidPassword = await authService.verifyPassword(currentPassword, user.password_hash);
    
    if (!isValidPassword) {
      res.status(401).json({
        success: false,
        error: 'Current password is incorrect',
        code: 'INVALID_PASSWORD'
      });
      return;
    }

    // 3. Update password in database
    await authService.updatePassword(userId, newPassword);

    if (user.role === 'viewer') {
      await logViewerActivity({
        viewerUserId: userId,
        actionType: 'password_changed',
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || null,
        actionDetails: null,
      });
    }

    // 4. Return success message
    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete account
 * DELETE /api/auth/account
 */
export const deleteAccount = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req;
    const { password } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    // 1. Get user
    const user = await authService.findById(userId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    // 2. Verify password
    const isValidPassword = await authService.verifyPassword(password, user.password_hash);
    
    if (!isValidPassword) {
      res.status(401).json({
        success: false,
        error: 'Password is incorrect',
        code: 'INVALID_PASSWORD'
      });
      return;
    }

    // 3. Delete user and all related data (cascade)
    await authService.deleteUser(userId);

    // 4. Clear cookies
    res.clearCookie('chatsql-access-token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });

    // 5. Return success message
    res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

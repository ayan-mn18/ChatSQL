import { Request, Response, NextFunction } from 'express';
// import * as authService from '../services/auth.service';
// import * as emailService from '../services/email.service';

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
    
    // TODO: Implement registration logic
    // 1. Check if email already exists and is verified
    // 2. If user exists but not verified, update password and resend OTP
    // 3. Generate OTP
    // 4. Hash OTP and store in email_verifications table
    // 5. Store user data temporarily (is_verified = false)
    // 6. Send OTP email
    // 7. Return success message

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
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

    // TODO: Implement email verification logic
    // 1. Find latest OTP record for email
    // 2. Check if OTP is expired
    // 3. Check if max attempts exceeded
    // 4. Verify OTP hash matches
    // 5. Mark OTP as used
    // 6. Update user is_verified = true
    // 7. Generate JWT token
    // 8. Set cookie
    // 9. Send welcome email
    // 10. Return user data

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
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

    // TODO: Implement resend OTP logic
    // 1. Check if user exists
    // 2. Check if user is already verified (error if yes)
    // 3. Check rate limiting (e.g., max 3 OTPs per hour)
    // 4. Invalidate previous OTPs
    // 5. Generate new OTP
    // 6. Store OTP hash
    // 7. Send OTP email
    // 8. Return success with expiry time

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
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

    // TODO: Implement login logic
    // 1. Find user by email
    // 2. Check if user exists
    // 3. Check if email is verified (error if not)
    // 4. Verify password
    // 5. Update last_login_at
    // 6. Generate JWT token
    // 7. Set cookie
    // 8. Return user data

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
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
    res.clearCookie('token', {
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

    // TODO: Implement forgot password logic
    // 1. Find user by email
    // 2. If user doesn't exist, still return success (security)
    // 3. Generate reset token
    // 4. Hash token and store in password_resets table
    // 5. Send password reset email with link
    // 6. Return success message

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
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

    // TODO: Implement reset password logic
    // 1. Find reset token in database
    // 2. Check if token is expired
    // 3. Check if token is already used
    // 4. Verify token hash
    // 5. Update user password
    // 6. Mark token as used
    // 7. Optionally: Send confirmation email
    // 8. Return success message

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
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

    // TODO: Implement get current user logic
    // 1. Fetch user from database by userId
    // 2. Return public user data (exclude password_hash)

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
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

    // TODO: Implement update profile logic
    // 1. Check if username is already taken (if changing)
    // 2. Update user in database
    // 3. Return updated user data

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
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

    // TODO: Implement change password logic
    // 1. Verify current password
    // 2. Hash new password
    // 3. Update password in database
    // 4. Return success message

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
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

    // TODO: Implement delete account logic
    // 1. Verify password
    // 2. Delete user and all related data (cascade)
    // 3. Clear cookies
    // 4. Return success message

    res.status(501).json({
      success: false,
      error: 'Not implemented yet',
      code: 'NOT_IMPLEMENTED'
    });
  } catch (error) {
    next(error);
  }
};

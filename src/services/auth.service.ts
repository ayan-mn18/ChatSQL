import { sequelize } from '../config/db';
import { QueryTypes } from 'sequelize';
import { User, UserPublic, RegisterRequest, LoginRequest, EmailVerification } from '../types';
import { 
  hashPassword, 
  comparePassword, 
  generateAccessToken,
  hashToken 
} from '../utils/auth';

/**
 * Verify password against hash
 */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return comparePassword(password, hash);
};

/**
 * Find user by email
 */
export const findByEmail = async (email: string): Promise<User | null> => {
  const users = await sequelize.query<User>(
    `SELECT * FROM users WHERE email = :email LIMIT 1`,
    {
      replacements: { email },
      type: QueryTypes.SELECT
    }
  );
  return users[0] || null;
};

/**
 * Find user by ID
 */
export const findById = async (id: string): Promise<User | null> => {
  const users = await sequelize.query<User>(
    `SELECT * FROM users WHERE id = :id LIMIT 1`,
    {
      replacements: { id },
      type: QueryTypes.SELECT
    }
  );
  return users[0] || null;
};

/**
 * Find user by username
 */
export const findByUsername = async (username: string): Promise<User | null> => {
  const users = await sequelize.query<User>(
    `SELECT * FROM users WHERE username = :username LIMIT 1`,
    {
      replacements: { username },
      type: QueryTypes.SELECT
    }
  );
  return users[0] || null;
};

/**
 * Create a new user
 */
export const createUser = async (data: RegisterRequest): Promise<User> => {
  const password_hash = await hashPassword(data.password);
  
  const [result] = await sequelize.query(
    `INSERT INTO users (email, password_hash, username) 
     VALUES (:email, :password_hash, :username) 
     RETURNING *`,
    {
      replacements: {
        email: data.email,
        password_hash,
        username: data.username || null
      },
      type: QueryTypes.SELECT
    }
  );
  
  return result as User;
};

/**
 * Update user last login timestamp
 */
export const updateLastLogin = async (userId: string): Promise<void> => {
  await sequelize.query(
    `UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = :userId`,
    {
      replacements: { userId },
      type: QueryTypes.UPDATE
    }
  );
};

/**
 * Update user profile
 */
export const updateProfile = async (
  userId: string, 
  data: { username?: string; profile_url?: string }
): Promise<User | null> => {
  const setClauses: string[] = [];
  const replacements: Record<string, any> = { userId };

  if (data.username !== undefined) {
    setClauses.push('username = :username');
    replacements.username = data.username;
  }
  if (data.profile_url !== undefined) {
    setClauses.push('profile_url = :profile_url');
    replacements.profile_url = data.profile_url;
  }

  if (setClauses.length === 0) return findById(userId);

  const [result] = await sequelize.query(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = :userId RETURNING *`,
    {
      replacements,
      type: QueryTypes.SELECT
    }
  );

  return (result as User) || null;
};

/**
 * Update user password
 */
export const updatePassword = async (userId: string, newPassword: string): Promise<void> => {
  const password_hash = await hashPassword(newPassword);
  
  await sequelize.query(
    `UPDATE users SET password_hash = :password_hash, must_change_password = false WHERE id = :userId`,
    {
      replacements: { userId, password_hash },
      type: QueryTypes.UPDATE
    }
  );
};

/**
 * Delete user account
 */
export const deleteUser = async (userId: string): Promise<void> => {
  await sequelize.query(
    `DELETE FROM users WHERE id = :userId`,
    {
      replacements: { userId },
      type: QueryTypes.DELETE
    }
  );
};

/**
 * Store refresh token
 */
export const storeRefreshToken = async (
  userId: string, 
  token: string, 
  expiresAt: Date
): Promise<void> => {
  // DEPRECATED: Refresh tokens removed in favor of OTP-based verification
  throw new Error('Refresh tokens are no longer supported');
};

/**
 * Revoke all refresh tokens for a user
 */
export const revokeAllRefreshTokens = async (userId: string): Promise<void> => {
  // DEPRECATED: Refresh tokens removed in favor of OTP-based verification
  throw new Error('Refresh tokens are no longer supported');
};

// ============================================
// OTP & EMAIL VERIFICATION FUNCTIONS
// ============================================

/**
 * Generate a random 6-digit OTP
 */
export const generateOtp = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Count recent OTPs sent to an email (for rate limiting)
 */
export const countRecentOtps = async (email: string, minutes: number): Promise<number> => {
  const result = await sequelize.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM email_verifications 
     WHERE email = :email 
     AND created_at > NOW() - INTERVAL '${minutes} minutes'`,
    { replacements: { email }, type: QueryTypes.SELECT }
  );
  return parseInt(result[0]?.count || '0', 10);
};

/**
 * Store OTP for email verification
 */
export const storeEmailVerificationOtp = async (
  email: string,
  otp: string
): Promise<void> => {
  const otpHash = await hashToken(otp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Invalidate any previous OTPs for this email
  await sequelize.query(
    `UPDATE email_verifications SET is_used = true WHERE email = :email AND is_used = false`,
    { replacements: { email }, type: QueryTypes.UPDATE }
  );

  // Store new OTP
  await sequelize.query(
    `INSERT INTO email_verifications (email, otp_code, otp_hash, expires_at) 
     VALUES (:email, :otpCode, :otpHash, :expiresAt)`,
    {
      replacements: { email, otpCode: otp, otpHash, expiresAt },
      type: QueryTypes.INSERT
    }
  );
};

/**
 * Verify OTP for email
 */
export const verifyEmailOtp = async (
  email: string,
  otp: string
): Promise<{ valid: boolean; error?: string }> => {
  // Find latest OTP for email
  const records = await sequelize.query<EmailVerification>(
    `SELECT * FROM email_verifications 
     WHERE email = :email AND is_used = false 
     ORDER BY created_at DESC LIMIT 1`,
    { replacements: { email }, type: QueryTypes.SELECT }
  );

  if (records.length === 0) {
    return { valid: false, error: 'No OTP found for this email' };
  }

  const record = records[0];

  // Check if expired
  if (new Date(record.expires_at) < new Date()) {
    return { valid: false, error: 'OTP has expired' };
  }

  // Check max attempts
  if (record.attempts >= record.max_attempts) {
    return { valid: false, error: 'Maximum attempts exceeded' };
  }

  // Increment attempts
  await sequelize.query(
    `UPDATE email_verifications SET attempts = attempts + 1 WHERE id = :id`,
    { replacements: { id: record.id }, type: QueryTypes.UPDATE }
  );

  // Verify OTP
  const isValid = await comparePassword(otp, record.otp_hash);

  if (!isValid) {
    return { valid: false, error: 'Invalid OTP' };
  }

  // Mark as used
  await sequelize.query(
    `UPDATE email_verifications SET is_used = true WHERE id = :id`,
    { replacements: { id: record.id }, type: QueryTypes.UPDATE }
  );

  return { valid: true };
};

/**
 * Store password reset token
 */
export const storePasswordResetToken = async (
  userId: string,
  token: string
): Promise<void> => {
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Invalidate any previous reset tokens for this user
  await sequelize.query(
    `UPDATE password_resets SET is_used = true WHERE user_id = :userId AND is_used = false`,
    { replacements: { userId }, type: QueryTypes.UPDATE }
  );

  // Store new token
  await sequelize.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at) 
     VALUES (:userId, :tokenHash, :expiresAt)`,
    {
      replacements: { userId, tokenHash, expiresAt },
      type: QueryTypes.INSERT
    }
  );
};

/**
 * Verify password reset token and return user_id if valid
 */
export const verifyPasswordResetToken = async (
  token: string
): Promise<{ valid: boolean; userId?: string; error?: string }> => {
  // Find all unused, non-expired tokens
  const records = await sequelize.query<{ id: string; user_id: string; token_hash: string; expires_at: Date }>(
    `SELECT id, user_id, token_hash, expires_at FROM password_resets 
     WHERE is_used = false AND expires_at > NOW()
     ORDER BY created_at DESC`,
    { type: QueryTypes.SELECT }
  );

  // Check each token hash (we need to compare since we can't query by hash directly)
  for (const record of records) {
    const isValid = await comparePassword(token, record.token_hash);
    if (isValid) {
      // Mark token as used
      await sequelize.query(
        `UPDATE password_resets SET is_used = true WHERE id = :id`,
        { replacements: { id: record.id }, type: QueryTypes.UPDATE }
      );
      return { valid: true, userId: record.user_id };
    }
  }

  return { valid: false, error: 'Invalid or expired reset token' };
};

/**
 * Verify user email (set is_verified = true)
 */
export const markEmailAsVerified = async (email: string): Promise<User | null> => {
  const [result] = await sequelize.query(
    `UPDATE users SET is_verified = true WHERE email = :email RETURNING *`,
    { replacements: { email }, type: QueryTypes.SELECT }
  );
  return (result as User) || null;
};

/**
 * Convert User to public user (without sensitive data)
 */
export const toPublicUser = (user: User): UserPublic => ({
  id: user.id,
  email: user.email,
  username: user.username,
  profile_url: user.profile_url,
  role: user.role,
  is_verified: user.is_verified,
  is_temporary: user.is_temporary,
  expires_at: user.expires_at,
  must_change_password: user.must_change_password,
  created_at: user.created_at
});

/**
 * Validate user credentials and return token
 */
export const validateCredentials = async (
  data: LoginRequest
): Promise<{ user: User; accessToken: string } | null> => {
  const user = await findByEmail(data.email);
  
  if (!user || !user.is_active) return null;
  
  // Check if email is verified
  if (!user.is_verified) return null;
  
  const isValidPassword = await comparePassword(data.password, user.password_hash);
  if (!isValidPassword) return null;

  const payload = { userId: user.id, email: user.email };
  const accessToken = generateAccessToken(payload);

  // Update last login
  await updateLastLogin(user.id);

  return { user, accessToken };
};

/**
 * Register a new user (unverified)
 */
export const registerUser = async (
  data: RegisterRequest
): Promise<{ user: User; otp: string }> => {
  const user = await createUser(data);
  const otp = generateOtp();
  
  // Store OTP for verification
  await storeEmailVerificationOtp(user.email, otp);

  return { user, otp };
};

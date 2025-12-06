import nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

// Email configuration from environment variables
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM_EMAIL,
  SMTP_FROM_NAME = 'ChatSQL'
} = process.env;

// Create transporter instance
let transporter: Transporter | null = null;

/**
 * Initialize the email transporter
 */
export const initializeEmailTransporter = (): Transporter => {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP configuration is not complete. Please check environment variables.');
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: SMTP_PORT === '465', // true for 465, false for other ports
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return transporter;
};

/**
 * Get the email transporter (lazy initialization)
 */
const getTransporter = (): Transporter => {
  if (!transporter) {
    return initializeEmailTransporter();
  }
  return transporter;
};

/**
 * Generate a random 6-digit OTP
 */
export const generateOtp = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Send email verification OTP
 */
export const sendVerificationEmail = async (
  email: string,
  otp: string
): Promise<boolean> => {
  // TODO: Implement email sending logic
  // 1. Get transporter
  // 2. Compose email with OTP template
  // 3. Send email
  // 4. Return success/failure

  console.log(`[EMAIL SERVICE] Would send OTP ${otp} to ${email}`);
  return true;
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (
  email: string,
  resetToken: string,
  resetUrl: string
): Promise<boolean> => {
  // TODO: Implement password reset email
  // 1. Get transporter
  // 2. Compose email with reset link
  // 3. Send email
  // 4. Return success/failure

  console.log(`[EMAIL SERVICE] Would send password reset to ${email}`);
  return true;
};

/**
 * Send welcome email after verification
 */
export const sendWelcomeEmail = async (
  email: string,
  username?: string
): Promise<boolean> => {
  // TODO: Implement welcome email
  // 1. Get transporter
  // 2. Compose welcome email
  // 3. Send email
  // 4. Return success/failure

  console.log(`[EMAIL SERVICE] Would send welcome email to ${email}`);
  return true;
};

/**
 * Verify SMTP connection
 */
export const verifySmtpConnection = async (): Promise<boolean> => {
  try {
    const transport = getTransporter();
    await transport.verify();
    console.log('✅ SMTP connection verified');
    return true;
  } catch (error) {
    console.error('❌ SMTP connection failed:', error);
    return false;
  }
};

/**
 * Email templates
 */
export const emailTemplates = {
  verificationOtp: (otp: string) => ({
    subject: 'Verify your ChatSQL account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to ChatSQL! 🗄️</h2>
        <p>Your verification code is:</p>
        <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">${otp}</span>
        </div>
        <p>This code will expire in <strong>10 minutes</strong>.</p>
        <p style="color: #666; font-size: 14px;">If you didn't request this code, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">© ${new Date().getFullYear()} ChatSQL. All rights reserved.</p>
      </div>
    `,
    text: `Your ChatSQL verification code is: ${otp}. This code will expire in 10 minutes.`
  }),

  passwordReset: (resetUrl: string) => ({
    subject: 'Reset your ChatSQL password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Password Reset Request</h2>
        <p>You requested to reset your password. Click the button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
        </div>
        <p>This link will expire in <strong>1 hour</strong>.</p>
        <p style="color: #666; font-size: 14px;">If you didn't request this, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">© ${new Date().getFullYear()} ChatSQL. All rights reserved.</p>
      </div>
    `,
    text: `Reset your ChatSQL password by visiting: ${resetUrl}. This link will expire in 1 hour.`
  }),

  welcome: (username?: string) => ({
    subject: 'Welcome to ChatSQL! 🎉',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome${username ? `, ${username}` : ''}! 🎉</h2>
        <p>Your email has been verified and your account is now active.</p>
        <p>With ChatSQL, you can:</p>
        <ul>
          <li>📊 Visualize your database tables</li>
          <li>🤖 Generate SQL queries with AI</li>
          <li>📈 Build custom analytics dashboards</li>
          <li>🗺️ View auto-generated ERD diagrams</li>
        </ul>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3001'}" style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Get Started</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">© ${new Date().getFullYear()} ChatSQL. All rights reserved.</p>
      </div>
    `,
    text: `Welcome to ChatSQL${username ? `, ${username}` : ''}! Your email has been verified and your account is now active.`
  })
};

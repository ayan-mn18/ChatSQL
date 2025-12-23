import nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { logger } from '../utils/logger';
import { logEmailSent, updateEmailLogStatus } from './email-logger.service';

// Email configuration from environment variables
// Note: Using Brevo SMTP credentials from .env
const SMTP_HOST = process.env['smtp.host'];
const SMTP_PORT = process.env['smtp.port'];
const SMTP_USER = process.env['smtp.login'];
const SMTP_PASS = process.env['smtp.key'];
const SMTP_FROM_EMAIL = process.env['smtp.from'] || 'no-reply@sql.bizer.dev';
const SMTP_FROM_NAME = 'ChatSQL';

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
  otp: string,
  recipientUserId?: string
): Promise<boolean> => {
  let emailLogId: string | null = null;
  try {
    const transport = getTransporter();
    const template = emailTemplates.verificationOtp(otp);
    
    // Log email before sending
    emailLogId = await logEmailSent({
      toEmail: email,
      fromEmail: SMTP_FROM_EMAIL,
      subject: template.subject,
      emailType: 'verification',
      recipientUserId,
      htmlContent: template.html,
      textContent: template.text,
      templateUsed: 'verificationOtp',
      variables: { otp }
    });

    const info = await transport.sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });
    
    // Update log with success status
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'sent',
        smtpMessageId: info.messageId,
        smtpResponse: info.response,
        sentAt: new Date()
      });
    }

    logger.info(`✅ [EMAIL] Verification OTP sent to ${email}`);
    return true;
  } catch (error: any) {
    // Update log with failure status
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'failed',
        errorMessage: error.message,
        failedAt: new Date()
      });
    }
    logger.error(`❌ [EMAIL] Failed to send verification email to ${email}:`, error);
    return false;
  }
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (
  email: string,
  resetToken: string,
  resetUrl: string,
  recipientUserId?: string
): Promise<boolean> => {
  let emailLogId: string | null = null;
  try {
    const transport = getTransporter();
    const template = emailTemplates.passwordReset(resetUrl);
    
    // Log email before sending
    emailLogId = await logEmailSent({
      toEmail: email,
      fromEmail: SMTP_FROM_EMAIL,
      subject: template.subject,
      emailType: 'password_reset',
      recipientUserId,
      htmlContent: template.html,
      textContent: template.text,
      templateUsed: 'passwordReset',
      variables: { resetUrl }
    });

    const info = await transport.sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });
    
    // Update log with success status
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'sent',
        smtpMessageId: info.messageId,
        smtpResponse: info.response,
        sentAt: new Date()
      });
    }

    logger.info(`✅ [EMAIL] Password reset email sent to ${email}`);
    return true;
  } catch (error: any) {
    // Update log with failure status
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'failed',
        errorMessage: error.message,
        failedAt: new Date()
      });
    }
    logger.error(`❌ [EMAIL] Failed to send password reset email to ${email}:`, error);
    return false;
  }
};

/**
 * Send welcome email after verification
 */
export const sendWelcomeEmail = async (
  email: string,
  username?: string,
  recipientUserId?: string
): Promise<boolean> => {
  let emailLogId: string | null = null;
  try {
    const transport = getTransporter();
    const template = emailTemplates.welcome(username);
    
    // Log email before sending
    emailLogId = await logEmailSent({
      toEmail: email,
      fromEmail: SMTP_FROM_EMAIL,
      subject: template.subject,
      emailType: 'welcome',
      recipientUserId,
      htmlContent: template.html,
      textContent: template.text,
      templateUsed: 'welcome',
      variables: { username }
    });

    const info = await transport.sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });
    
    // Update log with success status
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'sent',
        smtpMessageId: info.messageId,
        smtpResponse: info.response,
        sentAt: new Date()
      });
    }

    logger.info(`✅ [EMAIL] Welcome email sent to ${email}`);
    return true;
  } catch (error: any) {
    // Update log with failure status
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'failed',
        errorMessage: error.message,
        failedAt: new Date()
      });
    }
    logger.error(`❌ [EMAIL] Failed to send welcome email to ${email}:`, error);
    return false;
  }
};

/**
 * Send viewer invitation email with credentials
 */
export const sendViewerInvitationEmail = async (
  email: string,
  tempPassword: string,
  invitedByName: string,
  expiresAt?: Date,
  mustChangePassword: boolean = true,
  senderUserId?: string,
  connectionId?: string,
  viewerInvitationId?: string
): Promise<boolean> => {
  let emailLogId: string | null = null;
  try {
    const transport = getTransporter();
    const template = emailTemplates.viewerInvitation(email, tempPassword, invitedByName, expiresAt, mustChangePassword);
    
    // Log email before sending
    emailLogId = await logEmailSent({
      toEmail: email,
      fromEmail: SMTP_FROM_EMAIL,
      subject: template.subject,
      emailType: 'viewer_invitation',
      senderUserId,
      connectionId,
      viewerInvitationId,
      htmlContent: template.html,
      textContent: template.text,
      templateUsed: 'viewerInvitation',
      variables: { invitedByName, expiresAt: expiresAt?.toISOString(), mustChangePassword }
    });

    const info = await transport.sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });
    
    // Update log with success status
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'sent',
        smtpMessageId: info.messageId,
        smtpResponse: info.response,
        sentAt: new Date()
      });
    }

    logger.info(`✅ [EMAIL] Viewer invitation sent to ${email}`);
    return true;
  } catch (error: any) {
    // Update log with failure status
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'failed',
        errorMessage: error.message,
        failedAt: new Date()
      });
    }
    logger.error(`❌ [EMAIL] Failed to send viewer invitation to ${email}:`, error);
    return false;
  }
};

/**
 * Verify SMTP connection
 */
export const verifySmtpConnection = async (): Promise<boolean> => {
  try {
    const transport = getTransporter();
    await transport.verify();
    logger.info('✅ SMTP connection verified');
    return true;
  } catch (error) {
    logger.error('❌ SMTP connection failed:', error);
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
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Get Started</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">© ${new Date().getFullYear()} ChatSQL. All rights reserved.</p>
      </div>
    `,
    text: `Welcome to ChatSQL${username ? `, ${username}` : ''}! Your email has been verified and your account is now active.`
  }),

  viewerInvitation: (email: string, tempPassword: string, invitedBy: string, expiresAt?: Date, mustChangePassword: boolean = true) => ({
    subject: 'You have been invited to ChatSQL! 🗄️',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">You've been invited to ChatSQL! 🗄️</h2>
        <p><strong>${invitedBy}</strong> has invited you to access their database on ChatSQL.</p>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #333;">Your Login Credentials</h3>
          <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 5px 0;"><strong>Temporary Password:</strong></p>
          <div style="background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #dee2e6; font-family: monospace; font-size: 16px; letter-spacing: 1px;">
            ${tempPassword}
          </div>
        </div>
        
        ${expiresAt ? `
        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
          <p style="margin: 0; color: #856404;">
            <strong>⏰ Temporary Access:</strong> Your access will expire on <strong>${expiresAt.toLocaleDateString()} at ${expiresAt.toLocaleTimeString()}</strong>
          </p>
        </div>
        ` : ''}
        
        ${mustChangePassword ? '<p>You\'ll be asked to change your password on first login.</p>' : ''}
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="background: #6366f1; color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Login to ChatSQL</a>
        </div>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #666; font-size: 13px;">If you didn't expect this invitation, please ignore this email or contact the sender.</p>
        <p style="color: #999; font-size: 12px;">© ${new Date().getFullYear()} ChatSQL. All rights reserved.</p>
      </div>
    `,
    text: `You've been invited to ChatSQL by ${invitedBy}!\n\nYour login credentials:\nEmail: ${email}\nTemporary Password: ${tempPassword}\n\n${expiresAt ? `Note: Your access will expire on ${expiresAt.toLocaleDateString()} at ${expiresAt.toLocaleTimeString()}\n\n` : ''}Login at: ${process.env.FRONTEND_URL || 'http://localhost:5173'}/login\n\n${mustChangePassword ? 'You\'ll be asked to change your password on first login.' : ''}`
  })
};

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
 * Send payment failed notification email
 */
export const sendPaymentFailedEmail = async (
  email: string,
  failureReason: string,
  recipientUserId?: string
): Promise<boolean> => {
  let emailLogId: string | null = null;
  try {
    const transport = getTransporter();
    const template = emailTemplates.paymentFailed(failureReason);
    
    emailLogId = await logEmailSent({
      toEmail: email,
      fromEmail: SMTP_FROM_EMAIL,
      subject: template.subject,
      emailType: 'payment_failed',
      recipientUserId,
      htmlContent: template.html,
      textContent: template.text,
      templateUsed: 'paymentFailed',
      variables: { failureReason }
    });

    const info = await transport.sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });
    
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'sent',
        smtpMessageId: info.messageId,
        smtpResponse: info.response,
        sentAt: new Date()
      });
    }

    logger.info(`✅ [EMAIL] Payment failed notification sent to ${email}`);
    return true;
  } catch (error: any) {
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'failed',
        errorMessage: error.message,
        failedAt: new Date()
      });
    }
    logger.error(`❌ [EMAIL] Failed to send payment failed email to ${email}:`, error);
    return false;
  }
};

/**
 * Send contact form confirmation email to user
 */
export const sendContactConfirmationEmail = async (
  email: string,
  name: string
): Promise<boolean> => {
  let emailLogId: string | null = null;
  try {
    const transport = getTransporter();
    const template = emailTemplates.contactConfirmation(name);
    
    emailLogId = await logEmailSent({
      toEmail: email,
      fromEmail: SMTP_FROM_EMAIL,
      subject: template.subject,
      emailType: 'contact_confirmation',
      htmlContent: template.html,
      textContent: template.text,
      templateUsed: 'contactConfirmation',
      variables: { name }
    });

    const info = await transport.sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });
    
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'sent',
        smtpMessageId: info.messageId,
        smtpResponse: info.response,
        sentAt: new Date()
      });
    }

    logger.info(`✅ [EMAIL] Contact confirmation sent to ${email}`);
    return true;
  } catch (error: any) {
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'failed',
        errorMessage: error.message,
        failedAt: new Date()
      });
    }
    logger.error(`❌ [EMAIL] Failed to send contact confirmation to ${email}:`, error);
    return false;
  }
};

/**
 * Send contact form notification to admin
 */
export const sendContactNotificationEmail = async (
  data: {
    name: string;
    email: string;
    company?: string;
    subject: string;
    message: string;
    requestType: string;
    planInterest?: string;
    contactId?: string;
  }
): Promise<boolean> => {
  let emailLogId: string | null = null;
  try {
    const transport = getTransporter();
    const template = emailTemplates.contactNotification(data);
    
    // Admin email - could be configured via env
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@chatsql.dev';
    
    emailLogId = await logEmailSent({
      toEmail: adminEmail,
      fromEmail: SMTP_FROM_EMAIL,
      subject: template.subject,
      emailType: 'contact_notification',
      htmlContent: template.html,
      textContent: template.text,
      templateUsed: 'contactNotification',
      variables: data
    });

    const info = await transport.sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
      to: adminEmail,
      replyTo: data.email, // Reply goes to the person who submitted
      subject: template.subject,
      text: template.text,
      html: template.html,
    });
    
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'sent',
        smtpMessageId: info.messageId,
        smtpResponse: info.response,
        sentAt: new Date()
      });
    }

    logger.info(`✅ [EMAIL] Contact notification sent to admin`);
    return true;
  } catch (error: any) {
    if (emailLogId) {
      await updateEmailLogStatus({
        id: emailLogId,
        status: 'failed',
        errorMessage: error.message,
        failedAt: new Date()
      });
    }
    logger.error(`❌ [EMAIL] Failed to send contact notification:`, error);
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
  }),

  paymentFailed: (failureReason: string) => ({
    subject: 'Payment Failed - Action Required 💳',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545;">Payment Failed 💳</h2>
        <p>We were unable to process your payment for ChatSQL.</p>
        
        <div style="background: #f8d7da; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
          <p style="margin: 0; color: #721c24;">
            <strong>Reason:</strong> ${failureReason}
          </p>
        </div>
        
        <p>To continue using ChatSQL's premium features, please update your payment method:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/billing" style="background: #007bff; color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Update Payment Method</a>
        </div>
        
        <p style="color: #666; font-size: 14px;">If you believe this is an error or need assistance, please contact our support team.</p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">© ${new Date().getFullYear()} ChatSQL. All rights reserved.</p>
      </div>
    `,
    text: `Payment Failed\n\nWe were unable to process your payment for ChatSQL.\n\nReason: ${failureReason}\n\nTo continue using ChatSQL's premium features, please update your payment method at: ${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/billing`
  }),

  contactConfirmation: (name: string) => ({
    subject: 'We received your message - ChatSQL',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Thanks for reaching out, ${name}! 📬</h2>
        <p>We've received your message and our team will get back to you as soon as possible.</p>
        
        <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
          <p style="margin: 0; color: #155724;">
            <strong>Expected response time:</strong> Within 24-48 hours
          </p>
        </div>
        
        <p>In the meantime, you can:</p>
        <ul>
          <li>Check out our <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/docs">documentation</a></li>
          <li>Explore ChatSQL's features</li>
        </ul>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">© ${new Date().getFullYear()} ChatSQL. All rights reserved.</p>
      </div>
    `,
    text: `Thanks for reaching out, ${name}!\n\nWe've received your message and our team will get back to you as soon as possible.\n\nExpected response time: Within 24-48 hours`
  }),

  contactNotification: (data: { name: string; email: string; company?: string; subject: string; message: string; requestType: string; planInterest?: string; contactId?: string }) => ({
    subject: `[ChatSQL] New ${data.requestType === 'enterprise' ? 'Enterprise' : 'Contact'} Inquiry from ${data.name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">New Contact Form Submission</h2>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; font-weight: bold; width: 120px;">Name:</td>
            <td style="padding: 10px 0;">${data.name}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; font-weight: bold;">Email:</td>
            <td style="padding: 10px 0;"><a href="mailto:${data.email}">${data.email}</a></td>
          </tr>
          ${data.company ? `
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; font-weight: bold;">Company:</td>
            <td style="padding: 10px 0;">${data.company}</td>
          </tr>
          ` : ''}
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; font-weight: bold;">Type:</td>
            <td style="padding: 10px 0;"><span style="background: ${data.requestType === 'enterprise' ? '#ffc107' : '#17a2b8'}; color: ${data.requestType === 'enterprise' ? '#000' : '#fff'}; padding: 3px 8px; border-radius: 4px; font-size: 12px;">${data.requestType.toUpperCase()}</span></td>
          </tr>
          ${data.planInterest ? `
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; font-weight: bold;">Plan Interest:</td>
            <td style="padding: 10px 0;">${data.planInterest}</td>
          </tr>
          ` : ''}
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 0; font-weight: bold;">Subject:</td>
            <td style="padding: 10px 0;">${data.subject}</td>
          </tr>
        </table>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h4 style="margin-top: 0;">Message:</h4>
          <p style="white-space: pre-wrap;">${data.message}</p>
        </div>
        
        ${data.contactId ? `<p style="color: #666; font-size: 12px;">Contact ID: ${data.contactId}</p>` : ''}
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">This is an automated notification from ChatSQL.</p>
      </div>
    `,
    text: `New Contact Form Submission\n\nName: ${data.name}\nEmail: ${data.email}\n${data.company ? `Company: ${data.company}\n` : ''}Type: ${data.requestType}\n${data.planInterest ? `Plan Interest: ${data.planInterest}\n` : ''}Subject: ${data.subject}\n\nMessage:\n${data.message}`
  })
};

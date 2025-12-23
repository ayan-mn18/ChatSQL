import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { logger } from '../utils/logger';

// ============================================
// EMAIL LOGGER SERVICE
// Handles logging all emails sent by the system
// ============================================

export interface EmailLogParams {
  toEmail: string;
  fromEmail: string;
  subject: string;
  emailType: 'verification' | 'password_reset' | 'welcome' | 'viewer_invitation' | 'notification' | 'general';
  recipientUserId?: string;
  senderUserId?: string;
  htmlContent?: string;
  textContent?: string;
  templateUsed?: string;
  variables?: Record<string, any>;
  connectionId?: string;
  viewerInvitationId?: string;
}

export interface EmailLogUpdate {
  id: string;
  status: 'sent' | 'failed' | 'bounced';
  smtpMessageId?: string;
  smtpResponse?: string;
  errorMessage?: string;
  sentAt?: Date;
  failedAt?: Date;
}

let ensuredEmailLogsTablePromise: Promise<void> | null = null;

/**
 * Ensure email_logs table exists
 */
async function ensureEmailLogsTableExists(): Promise<void> {
  if (ensuredEmailLogsTablePromise) return ensuredEmailLogsTablePromise;

  ensuredEmailLogsTablePromise = (async () => {
    // Check if table exists
    const tableExists = await sequelize.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'email_logs'
      ) as "exists"`,
      { type: QueryTypes.SELECT }
    );

    if (tableExists?.[0]?.exists) {
      return;
    }

    // Create table if it doesn't exist (dev/bootstrap only)
    logger.warn('[EMAIL_LOGGER] email_logs table does not exist, creating it now...');

    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS email_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        to_email VARCHAR(255) NOT NULL,
        from_email VARCHAR(255) NOT NULL,
        subject VARCHAR(500) NOT NULL,
        email_type VARCHAR(100) NOT NULL,
        recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        html_content TEXT,
        text_content TEXT,
        template_used VARCHAR(255),
        variables JSONB,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        smtp_message_id VARCHAR(255),
        smtp_response TEXT,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
        viewer_invitation_id UUID,
        sent_at TIMESTAMP WITH TIME ZONE,
        failed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );`
    );

    // Create indexes
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_email_logs_to_email ON email_logs(to_email);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_email_logs_recipient_user ON email_logs(recipient_user_id);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_email_logs_sender_user ON email_logs(sender_user_id);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_email_logs_email_type ON email_logs(email_type);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);');

    logger.info('[EMAIL_LOGGER] email_logs table created successfully');
  })();

  return ensuredEmailLogsTablePromise;
}

/**
 * Log an email being sent (creates pending record)
 * Returns the log ID for later status updates
 */
export async function logEmailSent(params: EmailLogParams): Promise<string | null> {
  try {
    await ensureEmailLogsTableExists();

    const result = await sequelize.query(
      `INSERT INTO email_logs (
        to_email, from_email, subject, email_type,
        recipient_user_id, sender_user_id,
        html_content, text_content,
        template_used, variables,
        connection_id, viewer_invitation_id,
        status
      ) VALUES (
        :toEmail, :fromEmail, :subject, :emailType,
        :recipientUserId, :senderUserId,
        :htmlContent, :textContent,
        :templateUsed, :variables,
        :connectionId, :viewerInvitationId,
        'pending'
      ) RETURNING id`,
      {
        replacements: {
          toEmail: params.toEmail,
          fromEmail: params.fromEmail,
          subject: params.subject,
          emailType: params.emailType,
          recipientUserId: params.recipientUserId || null,
          senderUserId: params.senderUserId || null,
          htmlContent: params.htmlContent || null,
          textContent: params.textContent || null,
          templateUsed: params.templateUsed || null,
          variables: params.variables ? JSON.stringify(params.variables) : null,
          connectionId: params.connectionId || null,
          viewerInvitationId: params.viewerInvitationId || null,
        },
        type: QueryTypes.RAW,
      }
    );

    const rows = result[0] as Array<{ id: string }>;
    const id = rows?.[0]?.id;

    logger.info(`[EMAIL_LOGGER] Logged email: ${params.emailType} to ${params.toEmail}`, { emailLogId: id });
    return id || null;
  } catch (error) {
    logger.error('[EMAIL_LOGGER] Failed to log email:', error);
    return null;
  }
}

/**
 * Update email log status after sending attempt
 */
export async function updateEmailLogStatus(update: EmailLogUpdate): Promise<void> {
  try {
    await ensureEmailLogsTableExists();

    const updateFields: string[] = ['status = :status'];
    const replacements: any = { id: update.id, status: update.status };

    if (update.smtpMessageId) {
      updateFields.push('smtp_message_id = :smtpMessageId');
      replacements.smtpMessageId = update.smtpMessageId;
    }

    if (update.smtpResponse) {
      updateFields.push('smtp_response = :smtpResponse');
      replacements.smtpResponse = update.smtpResponse;
    }

    if (update.errorMessage) {
      updateFields.push('error_message = :errorMessage');
      replacements.errorMessage = update.errorMessage;
    }

    if (update.status === 'sent' && update.sentAt) {
      updateFields.push('sent_at = :sentAt');
      replacements.sentAt = update.sentAt;
    }

    if (update.status === 'failed' && update.failedAt) {
      updateFields.push('failed_at = :failedAt');
      replacements.failedAt = update.failedAt;
    }

    await sequelize.query(
      `UPDATE email_logs 
       SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      {
        replacements,
        type: QueryTypes.UPDATE,
      }
    );

    logger.info(`[EMAIL_LOGGER] Updated email log status: ${update.status}`, { emailLogId: update.id });
  } catch (error) {
    logger.error('[EMAIL_LOGGER] Failed to update email log:', error);
  }
}

/**
 * Get recent email logs for a user
 */
export async function getEmailLogsByUser(
  userId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    await ensureEmailLogsTableExists();

    const logs = await sequelize.query(
      `SELECT 
        id, to_email, from_email, subject, email_type,
        status, sent_at, failed_at, error_message,
        created_at
      FROM email_logs
      WHERE recipient_user_id = :userId OR sender_user_id = :userId
      ORDER BY created_at DESC
      LIMIT :limit`,
      {
        replacements: { userId, limit },
        type: QueryTypes.SELECT,
      }
    );

    return logs;
  } catch (error) {
    logger.error('[EMAIL_LOGGER] Failed to get email logs by user:', error);
    return [];
  }
}

/**
 * Get email statistics for analytics
 */
export async function getEmailStats(): Promise<any> {
  try {
    await ensureEmailLogsTableExists();

    const [stats] = await sequelize.query<any>(
      `SELECT 
        COUNT(*) as total_emails,
        COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE email_type = 'verification') as verification_count,
        COUNT(*) FILTER (WHERE email_type = 'viewer_invitation') as invitation_count,
        COUNT(*) FILTER (WHERE email_type = 'password_reset') as password_reset_count
      FROM email_logs`,
      { type: QueryTypes.SELECT }
    );

    return stats;
  } catch (error) {
    logger.error('[EMAIL_LOGGER] Failed to get email stats:', error);
    return null;
  }
}

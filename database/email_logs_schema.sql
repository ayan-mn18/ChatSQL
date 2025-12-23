-- ============================================
-- ChatSQL - Email Logs Schema Migration
-- PostgreSQL Database Setup
-- ============================================
-- 
-- Run this migration to add email logging table
-- psql -U your_username -d chatsql -f email_logs_schema.sql
-- ============================================

-- ============================================
-- EMAIL LOGS TABLE
-- Stores all emails sent by the system with full metadata
-- ============================================
CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Email details
    to_email VARCHAR(255) NOT NULL,                     -- Recipient email address
    from_email VARCHAR(255) NOT NULL,                   -- Sender email address
    subject VARCHAR(500) NOT NULL,                      -- Email subject
    email_type VARCHAR(100) NOT NULL,                   -- Type: 'verification', 'password_reset', 'welcome', 'viewer_invitation', 'notification', etc.
    
    -- User context
    recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- User who received the email (if exists)
    sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,     -- User who triggered the email (if applicable)
    
    -- Email content (optional for debugging/auditing)
    html_content TEXT,                                  -- HTML email body (optional)
    text_content TEXT,                                  -- Plain text email body (optional)
    
    -- Email metadata
    template_used VARCHAR(255),                         -- Template name if using template system
    variables JSONB,                                    -- Template variables used
    
    -- Delivery status
    status VARCHAR(50) NOT NULL DEFAULT 'pending',      -- Status: 'pending', 'sent', 'failed', 'bounced'
    smtp_message_id VARCHAR(255),                       -- Message ID from SMTP server
    smtp_response TEXT,                                 -- Response from SMTP server
    error_message TEXT,                                 -- Error message if failed
    retry_count INTEGER DEFAULT 0,                      -- Number of retry attempts
    
    -- Related entities
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,  -- Related connection (for viewer invitations)
    viewer_invitation_id UUID,                          -- Related viewer invitation ID
    
    -- Timestamps
    sent_at TIMESTAMP WITH TIME ZONE,                   -- When email was successfully sent
    failed_at TIMESTAMP WITH TIME ZONE,                 -- When email failed to send
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for email_logs table
CREATE INDEX IF NOT EXISTS idx_email_logs_to_email ON email_logs(to_email);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient_user ON email_logs(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_sender_user ON email_logs(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_email_type ON email_logs(email_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_connection_id ON email_logs(connection_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_email_logs_updated_at ON email_logs;
CREATE TRIGGER update_email_logs_updated_at
    BEFORE UPDATE ON email_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE email_logs IS 'Stores all emails sent by the system for auditing and debugging';
COMMENT ON COLUMN email_logs.email_type IS 'Type of email: verification, password_reset, welcome, viewer_invitation, notification, etc.';
COMMENT ON COLUMN email_logs.status IS 'Delivery status: pending, sent, failed, bounced';
COMMENT ON COLUMN email_logs.recipient_user_id IS 'User who received the email (NULL if recipient is not a registered user yet)';
COMMENT ON COLUMN email_logs.sender_user_id IS 'User who triggered the email (NULL for system-generated emails like OTP)';
COMMENT ON COLUMN email_logs.variables IS 'JSON object containing template variables used in the email';

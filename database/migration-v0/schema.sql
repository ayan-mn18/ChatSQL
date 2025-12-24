-- ============================================
-- ChatSQL - Complete Database Schema
-- PostgreSQL Database Setup (v0)
-- ============================================
-- 
-- INSTRUCTIONS:
-- 1. Create a PostgreSQL database: CREATE DATABASE chatsql;
-- 2. Connect to the database: \c chatsql
-- 3. Run this file: \i database/migration-v0/schema.sql
--
-- Or run via command line:
-- psql -U your_username -d chatsql -f database/migration-v0/schema.sql
-- ============================================

-- Enable UUID extension for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- UTILITY FUNCTION: Update updated_at timestamp
-- Automatically updates the updated_at column
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ============================================
-- USERS TABLE
-- Stores user authentication and profile data
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    username VARCHAR(100) UNIQUE,
    profile_url TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    role VARCHAR(50) DEFAULT 'super_admin',             -- 'super_admin', 'viewer'
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_temporary BOOLEAN DEFAULT FALSE,
    must_change_password BOOLEAN DEFAULT FALSE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users(expires_at);

-- Trigger for users table
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- EMAIL VERIFICATIONS TABLE
-- Stores OTP codes for email verification
-- ============================================
CREATE TABLE IF NOT EXISTS email_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for email_verifications
CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires ON email_verifications(expires_at);

-- ============================================
-- PASSWORD RESET TOKENS TABLE
-- Stores tokens for password reset flow
-- ============================================
CREATE TABLE IF NOT EXISTS password_resets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for password_resets
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON password_resets(token_hash);

-- ============================================
-- CONNECTIONS TABLE
-- Stores user database connections
-- ============================================
CREATE TABLE IF NOT EXISTS connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 5432,
    type VARCHAR(50) NOT NULL DEFAULT 'postgres',
    db_name VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,
    password_enc TEXT NOT NULL,
    ssl BOOLEAN DEFAULT FALSE,
    extra_options JSONB,
    is_valid BOOLEAN DEFAULT FALSE,
    schema_synced BOOLEAN DEFAULT FALSE,
    schema_synced_at TIMESTAMP WITH TIME ZONE,
    last_tested_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_connection_name_per_user UNIQUE (user_id, name)
);

-- Indexes for connections
CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_type ON connections(type);

-- Trigger for connections
DROP TRIGGER IF EXISTS update_connections_updated_at ON connections;
CREATE TRIGGER update_connections_updated_at
    BEFORE UPDATE ON connections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- DATABASE SCHEMAS TABLE
-- Stores PostgreSQL schemas for each connection
-- ============================================
CREATE TABLE IF NOT EXISTS database_schemas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    schema_name VARCHAR(255) NOT NULL,
    is_selected BOOLEAN DEFAULT TRUE,
    table_count INTEGER DEFAULT 0,
    description TEXT,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_schema_per_connection UNIQUE (connection_id, schema_name)
);

-- Indexes for database_schemas
CREATE INDEX IF NOT EXISTS idx_database_schemas_connection_id ON database_schemas(connection_id);
CREATE INDEX IF NOT EXISTS idx_database_schemas_is_selected ON database_schemas(is_selected);

-- Trigger for database_schemas
DROP TRIGGER IF EXISTS update_database_schemas_updated_at ON database_schemas;
CREATE TRIGGER update_database_schemas_updated_at
    BEFORE UPDATE ON database_schemas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TABLE SCHEMAS CACHE
-- Stores cached table metadata from user's databases
-- ============================================
CREATE TABLE IF NOT EXISTS table_schemas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    database_schema_id UUID REFERENCES database_schemas(id) ON DELETE CASCADE,
    schema_name VARCHAR(255) NOT NULL DEFAULT 'public',
    table_name VARCHAR(255) NOT NULL,
    table_type VARCHAR(50) DEFAULT 'BASE TABLE',
    columns JSONB NOT NULL,
    primary_key_columns JSONB,
    indexes JSONB,
    row_count INTEGER,
    table_size_bytes BIGINT,
    description TEXT,
    last_fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_table_per_connection_schema UNIQUE (connection_id, schema_name, table_name)
);

-- Indexes for table_schemas
CREATE INDEX IF NOT EXISTS idx_table_schemas_connection_id ON table_schemas(connection_id);
CREATE INDEX IF NOT EXISTS idx_table_schemas_schema_name ON table_schemas(schema_name);
CREATE INDEX IF NOT EXISTS idx_table_schemas_table_name ON table_schemas(table_name);
CREATE INDEX IF NOT EXISTS idx_table_schemas_database_schema_id ON table_schemas(database_schema_id);

-- Trigger for table_schemas
DROP TRIGGER IF EXISTS update_table_schemas_updated_at ON table_schemas;
CREATE TRIGGER update_table_schemas_updated_at
    BEFORE UPDATE ON table_schemas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ERD RELATIONS TABLE
-- Stores foreign key relationships
-- ============================================
CREATE TABLE IF NOT EXISTS erd_relations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    source_schema VARCHAR(255) NOT NULL DEFAULT 'public',
    source_table VARCHAR(255) NOT NULL,
    source_column VARCHAR(255) NOT NULL,
    target_schema VARCHAR(255) NOT NULL DEFAULT 'public',
    target_table VARCHAR(255) NOT NULL,
    target_column VARCHAR(255) NOT NULL,
    constraint_name VARCHAR(255),
    relation_type VARCHAR(50) DEFAULT 'one-to-many',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_relation UNIQUE (connection_id, source_schema, source_table, source_column, target_table, target_column)
);

-- Indexes for erd_relations
CREATE INDEX IF NOT EXISTS idx_erd_relations_connection_id ON erd_relations(connection_id);
CREATE INDEX IF NOT EXISTS idx_erd_relations_source ON erd_relations(source_table);
CREATE INDEX IF NOT EXISTS idx_erd_relations_target ON erd_relations(target_table);

-- ============================================
-- SAVED QUERIES TABLE
-- User-saved SQL queries
-- ============================================
CREATE TABLE IF NOT EXISTS saved_queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    query_text TEXT NOT NULL,
    tags JSONB DEFAULT '[]',
    is_shared BOOLEAN DEFAULT FALSE,
    folder VARCHAR(255),
    last_used_at TIMESTAMP WITH TIME ZONE,
    use_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_saved_query_name UNIQUE (user_id, connection_id, name)
);

-- Indexes for saved_queries
CREATE INDEX IF NOT EXISTS idx_saved_queries_user_id ON saved_queries(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_queries_connection_id ON saved_queries(connection_id);
CREATE INDEX IF NOT EXISTS idx_saved_queries_is_shared ON saved_queries(is_shared);
CREATE INDEX IF NOT EXISTS idx_saved_queries_tags ON saved_queries USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_saved_queries_name ON saved_queries(name);
CREATE INDEX IF NOT EXISTS idx_saved_queries_last_used ON saved_queries(last_used_at DESC NULLS LAST);

-- Trigger for saved_queries
DROP TRIGGER IF EXISTS update_saved_queries_updated_at ON saved_queries;
CREATE TRIGGER update_saved_queries_updated_at
    BEFORE UPDATE ON saved_queries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CHAT SESSIONS TABLE
-- AI chat sessions per connection
-- ============================================
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    title VARCHAR(255) DEFAULT 'New Chat',
    is_active BOOLEAN DEFAULT TRUE,
    message_count INTEGER DEFAULT 0,
    last_message_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for chat_sessions
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_connection_id ON chat_sessions(connection_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_is_active ON chat_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_connection ON chat_sessions(user_id, connection_id);

-- Trigger for chat_sessions
DROP TRIGGER IF EXISTS update_chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER update_chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CHAT MESSAGES TABLE
-- Individual messages in chat sessions
-- ============================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    sql_generated TEXT,
    reasoning JSONB,
    tables_used JSONB,
    execution_result JSONB,
    is_error BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for chat_messages
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_role ON chat_messages(role);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_has_sql ON chat_messages(sql_generated) WHERE sql_generated IS NOT NULL;

-- ============================================
-- QUERIES TABLE
-- Query execution history
-- ============================================
CREATE TABLE IF NOT EXISTS queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL,
    raw_result JSONB,
    row_count INTEGER,
    execution_time_ms INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'success',
    error_message TEXT,
    is_saved BOOLEAN DEFAULT FALSE,
    saved_name VARCHAR(255),
    is_ai_generated BOOLEAN DEFAULT FALSE,
    ai_prompt TEXT,
    tables_used JSONB,
    columns_used JSONB,
    saved_query_id UUID REFERENCES saved_queries(id) ON DELETE SET NULL,
    chat_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    query_type VARCHAR(20) DEFAULT 'SELECT',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for queries
CREATE INDEX IF NOT EXISTS idx_queries_user_id ON queries(user_id);
CREATE INDEX IF NOT EXISTS idx_queries_connection_id ON queries(connection_id);
CREATE INDEX IF NOT EXISTS idx_queries_is_saved ON queries(is_saved);
CREATE INDEX IF NOT EXISTS idx_queries_created_at ON queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queries_is_ai_generated ON queries(is_ai_generated) WHERE is_ai_generated = true;
CREATE INDEX IF NOT EXISTS idx_queries_saved_query_id ON queries(saved_query_id);
CREATE INDEX IF NOT EXISTS idx_queries_chat_message_id ON queries(chat_message_id);
CREATE INDEX IF NOT EXISTS idx_queries_query_type ON queries(query_type);

-- ============================================
-- VIEWER PERMISSIONS TABLE
-- Granular access permissions for viewers
-- ============================================
CREATE TABLE IF NOT EXISTS viewer_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    viewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    schema_name VARCHAR(255),
    table_name VARCHAR(255),
    can_select BOOLEAN DEFAULT FALSE,
    can_insert BOOLEAN DEFAULT FALSE,
    can_update BOOLEAN DEFAULT FALSE,
    can_delete BOOLEAN DEFAULT FALSE,
    can_use_ai BOOLEAN DEFAULT TRUE,
    can_view_analytics BOOLEAN DEFAULT FALSE,
    can_export BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Null-safe uniqueness across scope
CREATE UNIQUE INDEX IF NOT EXISTS uq_viewer_permissions_scope
ON viewer_permissions (
    viewer_user_id,
    connection_id,
    COALESCE(schema_name, '__ALL__'),
    COALESCE(table_name, '__ALL__')
);

-- Indexes for viewer_permissions
CREATE INDEX IF NOT EXISTS idx_viewer_permissions_viewer ON viewer_permissions(viewer_user_id);
CREATE INDEX IF NOT EXISTS idx_viewer_permissions_connection ON viewer_permissions(connection_id);
CREATE INDEX IF NOT EXISTS idx_viewer_permissions_schema ON viewer_permissions(schema_name);

-- Trigger for viewer_permissions
DROP TRIGGER IF EXISTS update_viewer_permissions_updated_at ON viewer_permissions;
CREATE TRIGGER update_viewer_permissions_updated_at
    BEFORE UPDATE ON viewer_permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VIEWER INVITATIONS TABLE
-- Pending invitations sent to viewers
-- ============================================
CREATE TABLE IF NOT EXISTS viewer_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    temp_password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    permission_config JSONB NOT NULL
);

-- Indexes for viewer_invitations
CREATE INDEX IF NOT EXISTS idx_viewer_invitations_email ON viewer_invitations(email);
CREATE INDEX IF NOT EXISTS idx_viewer_invitations_invited_by ON viewer_invitations(invited_by_user_id);
CREATE INDEX IF NOT EXISTS idx_viewer_invitations_status ON viewer_invitations(status);

-- ============================================
-- VIEWER ACTIVITY LOG TABLE
-- Audit trail for viewer actions
-- ============================================
CREATE TABLE IF NOT EXISTS viewer_activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    viewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    action_type VARCHAR(100) NOT NULL,
    action_details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for viewer_activity_log
CREATE INDEX IF NOT EXISTS idx_viewer_activity_viewer ON viewer_activity_log(viewer_user_id);
CREATE INDEX IF NOT EXISTS idx_viewer_activity_connection ON viewer_activity_log(connection_id);
CREATE INDEX IF NOT EXISTS idx_viewer_activity_type ON viewer_activity_log(action_type);
CREATE INDEX IF NOT EXISTS idx_viewer_activity_created ON viewer_activity_log(created_at);

-- ============================================
-- VIEWER ACCESS REQUESTS TABLE
-- Viewers request extensions/permission changes
-- ============================================
CREATE TABLE IF NOT EXISTS viewer_access_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    viewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    schema_name VARCHAR(255),
    table_name VARCHAR(255),
    requested_additional_hours INTEGER,
    requested_permissions JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    decided_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    decision_reason TEXT,
    decided_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for viewer_access_requests
CREATE INDEX IF NOT EXISTS idx_viewer_access_requests_viewer ON viewer_access_requests(viewer_user_id);
CREATE INDEX IF NOT EXISTS idx_viewer_access_requests_status ON viewer_access_requests(status);
CREATE INDEX IF NOT EXISTS idx_viewer_access_requests_created ON viewer_access_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_viewer_access_requests_scope ON viewer_access_requests(connection_id, schema_name, table_name);

-- ============================================
-- EMAIL LOGS TABLE
-- Audit trail for all emails sent
-- ============================================
CREATE TABLE IF NOT EXISTS email_logs (
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
);

-- Indexes for email_logs
CREATE INDEX IF NOT EXISTS idx_email_logs_to_email ON email_logs(to_email);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient_user ON email_logs(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_sender_user ON email_logs(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_email_type ON email_logs(email_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_connection_id ON email_logs(connection_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);

-- Trigger for email_logs
DROP TRIGGER IF EXISTS update_email_logs_updated_at ON email_logs;
CREATE TRIGGER update_email_logs_updated_at
    BEFORE UPDATE ON email_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Check if user has permission on table
CREATE OR REPLACE FUNCTION check_viewer_permission(
    p_user_id UUID,
    p_connection_id UUID,
    p_schema_name VARCHAR(255),
    p_table_name VARCHAR(255),
    p_permission VARCHAR(50)
)
RETURNS BOOLEAN AS $$
DECLARE
    has_permission BOOLEAN := FALSE;
BEGIN
    SELECT 
        CASE p_permission
            WHEN 'select' THEN can_select
            WHEN 'insert' THEN can_insert
            WHEN 'update' THEN can_update
            WHEN 'delete' THEN can_delete
            ELSE FALSE
        END INTO has_permission
    FROM viewer_permissions
    WHERE viewer_user_id = p_user_id
      AND connection_id = p_connection_id
      AND (schema_name = p_schema_name OR schema_name IS NULL)
      AND (table_name = p_table_name OR table_name IS NULL)
    ORDER BY 
        CASE WHEN table_name IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN schema_name IS NOT NULL THEN 0 ELSE 1 END
    LIMIT 1;
    
    RETURN COALESCE(has_permission, FALSE);
END;
$$ LANGUAGE plpgsql;

-- Get all accessible connections for a viewer
CREATE OR REPLACE FUNCTION get_viewer_connections(p_user_id UUID)
RETURNS TABLE (connection_id UUID) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT vp.connection_id
    FROM viewer_permissions vp
    WHERE vp.viewer_user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Get accessible schemas for a viewer on a connection
CREATE OR REPLACE FUNCTION get_viewer_schemas(p_user_id UUID, p_connection_id UUID)
RETURNS TABLE (schema_name VARCHAR(255)) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT vp.schema_name
    FROM viewer_permissions vp
    WHERE vp.viewer_user_id = p_user_id
      AND vp.connection_id = p_connection_id
      AND vp.schema_name IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SETUP COMPLETE
-- ============================================

-- ============================================
-- USER PLANS TABLE
-- Subscription plans and usage limits for users
-- ============================================
CREATE TABLE IF NOT EXISTS user_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_type VARCHAR(50) NOT NULL DEFAULT 'free',  -- 'free', 'pro', 'enterprise'
    ai_tokens_limit INTEGER DEFAULT 10000,           -- Monthly AI token limit
    ai_tokens_used INTEGER DEFAULT 0,                -- Current month usage
    queries_limit INTEGER DEFAULT 1000,              -- Monthly query limit
    queries_used INTEGER DEFAULT 0,                  -- Current month usage
    connections_limit INTEGER DEFAULT 3,             -- Max connections allowed
    storage_limit_mb INTEGER DEFAULT 100,            -- Storage limit in MB
    billing_cycle_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    billing_cycle_end TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 month'),
    is_active BOOLEAN DEFAULT TRUE,
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_plan UNIQUE (user_id)
);

-- Indexes for user_plans
CREATE INDEX IF NOT EXISTS idx_user_plans_user_id ON user_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_user_plans_plan_type ON user_plans(plan_type);
CREATE INDEX IF NOT EXISTS idx_user_plans_billing_end ON user_plans(billing_cycle_end);

-- Trigger for user_plans
DROP TRIGGER IF EXISTS update_user_plans_updated_at ON user_plans;
CREATE TRIGGER update_user_plans_updated_at
    BEFORE UPDATE ON user_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- AI TOKEN USAGE TABLE
-- Granular tracking of AI token consumption
-- ============================================
CREATE TABLE IF NOT EXISTS ai_token_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    operation_type VARCHAR(50) NOT NULL,  -- 'generate_sql', 'explain_query', 'chat', 'schema_analysis'
    model VARCHAR(100),                    -- e.g., 'gemini-2.0-flash'
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    prompt_preview TEXT,                   -- First 200 chars of prompt for debugging
    response_preview TEXT,                 -- First 200 chars of response
    execution_time_ms INTEGER,
    is_cached BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for ai_token_usage
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_user_id ON ai_token_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_user_date ON ai_token_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_connection_id ON ai_token_usage(connection_id);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_operation ON ai_token_usage(operation_type);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_created ON ai_token_usage(created_at DESC);

-- ============================================
-- PLAN CONFIGURATIONS TABLE
-- Defines available plan tiers and their limits
-- ============================================
CREATE TABLE IF NOT EXISTS plan_configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_type VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    price_monthly DECIMAL(10, 2) DEFAULT 0,
    price_yearly DECIMAL(10, 2) DEFAULT 0,
    ai_tokens_limit INTEGER NOT NULL,
    queries_limit INTEGER NOT NULL,
    connections_limit INTEGER NOT NULL,
    storage_limit_mb INTEGER NOT NULL,
    features JSONB DEFAULT '[]',           -- List of feature flags
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trigger for plan_configurations
DROP TRIGGER IF EXISTS update_plan_configurations_updated_at ON plan_configurations;
CREATE TRIGGER update_plan_configurations_updated_at
    BEFORE UPDATE ON plan_configurations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INSERT DEFAULT PLAN CONFIGURATIONS
-- ============================================
INSERT INTO plan_configurations (plan_type, display_name, description, price_monthly, price_yearly, ai_tokens_limit, queries_limit, connections_limit, storage_limit_mb, features, sort_order)
VALUES 
    ('free', 'Free', 'Perfect for getting started with ChatSQL', 0, 0, 10000, 1000, 3, 100, 
     '["Basic AI SQL generation", "3 database connections", "Query history (7 days)", "Community support"]'::jsonb, 1),
    ('pro', 'Pro', 'For professionals who need more power', 19.99, 199.99, 100000, 10000, 10, 1000,
     '["Advanced AI features", "10 database connections", "Query history (90 days)", "Priority support", "Custom saved queries", "Export to CSV/JSON"]'::jsonb, 2),
    ('enterprise', 'Enterprise', 'For teams with advanced needs', 49.99, 499.99, -1, -1, -1, -1,
     '["Unlimited AI tokens", "Unlimited connections", "Unlimited query history", "24/7 support", "Team collaboration", "SSO/SAML", "Audit logs", "Custom integrations"]'::jsonb, 3)
ON CONFLICT (plan_type) DO NOTHING;

-- ============================================
-- FUNCTION: Create default plan for new user
-- ============================================
CREATE OR REPLACE FUNCTION create_default_user_plan()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_plans (user_id, plan_type, ai_tokens_limit, queries_limit, connections_limit, storage_limit_mb)
    SELECT NEW.id, 'free', ai_tokens_limit, queries_limit, connections_limit, storage_limit_mb
    FROM plan_configurations
    WHERE plan_type = 'free'
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-create plan for new users
DROP TRIGGER IF EXISTS create_user_plan_trigger ON users;
CREATE TRIGGER create_user_plan_trigger
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION create_default_user_plan();

-- ============================================
-- FUNCTION: Reset monthly usage counters
-- Call this via cron job at billing cycle end
-- ============================================
CREATE OR REPLACE FUNCTION reset_monthly_usage()
RETURNS void AS $$
BEGIN
    UPDATE user_plans
    SET 
        ai_tokens_used = 0,
        queries_used = 0,
        billing_cycle_start = CURRENT_TIMESTAMP,
        billing_cycle_end = CURRENT_TIMESTAMP + INTERVAL '1 month'
    WHERE billing_cycle_end < CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Get user usage dashboard data
-- ============================================
CREATE OR REPLACE FUNCTION get_user_usage_dashboard(p_user_id UUID)
RETURNS TABLE (
    plan_type VARCHAR(50),
    plan_display_name VARCHAR(100),
    ai_tokens_limit INTEGER,
    ai_tokens_used INTEGER,
    ai_tokens_remaining INTEGER,
    queries_limit INTEGER,
    queries_used INTEGER,
    queries_remaining INTEGER,
    connections_limit INTEGER,
    connections_used BIGINT,
    billing_cycle_start TIMESTAMP WITH TIME ZONE,
    billing_cycle_end TIMESTAMP WITH TIME ZONE,
    days_remaining INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        up.plan_type,
        pc.display_name AS plan_display_name,
        up.ai_tokens_limit,
        up.ai_tokens_used,
        CASE WHEN up.ai_tokens_limit = -1 THEN -1 ELSE GREATEST(0, up.ai_tokens_limit - up.ai_tokens_used) END AS ai_tokens_remaining,
        up.queries_limit,
        up.queries_used,
        CASE WHEN up.queries_limit = -1 THEN -1 ELSE GREATEST(0, up.queries_limit - up.queries_used) END AS queries_remaining,
        up.connections_limit,
        (SELECT COUNT(*) FROM connections c WHERE c.user_id = p_user_id) AS connections_used,
        up.billing_cycle_start,
        up.billing_cycle_end,
        EXTRACT(DAY FROM (up.billing_cycle_end - CURRENT_TIMESTAMP))::INTEGER AS days_remaining
    FROM user_plans up
    JOIN plan_configurations pc ON up.plan_type = pc.plan_type
    WHERE up.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Verify all tables were created
SELECT 
    schemaname, 
    tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

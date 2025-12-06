-- ============================================
-- ChatSQL Database Schema
-- PostgreSQL Database Setup
-- ============================================
-- 
-- INSTRUCTIONS:
-- 1. Create a PostgreSQL database: CREATE DATABASE chatsql;
-- 2. Connect to the database: \c chatsql
-- 3. Run this file: \i schema.sql
--
-- Or run via command line:
-- psql -U your_username -d chatsql -f schema.sql
-- ============================================

-- Enable UUID extension for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster email lookups during authentication
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Index for username lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

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

-- Index for email lookups
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

-- Index for password reset lookups
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON password_resets(token_hash);

-- ============================================
-- FUNCTION: Update updated_at timestamp
-- Automatically updates the updated_at column
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for users table
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUTURE TABLES (Phase 2+)
-- Uncomment and run when ready
-- ============================================

-- -- CONNECTIONS TABLE
-- CREATE TABLE IF NOT EXISTS connections (
--     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--     user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
--     name VARCHAR(255) NOT NULL,
--     host VARCHAR(255) NOT NULL,
--     port INTEGER NOT NULL,
--     type VARCHAR(50) NOT NULL, -- postgres, mysql, mssql, mongodb
--     db_name VARCHAR(255) NOT NULL,
--     username VARCHAR(255) NOT NULL,
--     password_enc TEXT NOT NULL, -- encrypted password
--     extra_options JSONB,
--     is_valid BOOLEAN DEFAULT FALSE,
--     last_tested_at TIMESTAMP WITH TIME ZONE,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- -- QUERIES TABLE (History + Saved)
-- CREATE TABLE IF NOT EXISTS queries (
--     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--     user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
--     connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
--     query_text TEXT NOT NULL,
--     raw_result JSONB,
--     row_count INTEGER,
--     execution_time INTEGER, -- milliseconds
--     status VARCHAR(50), -- success, error
--     error_message TEXT,
--     is_saved BOOLEAN DEFAULT FALSE,
--     saved_name VARCHAR(255),
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- -- AI QUERY LOGS TABLE
-- CREATE TABLE IF NOT EXISTS ai_query_logs (
--     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--     user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
--     connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
--     prompt_text TEXT NOT NULL,
--     generated_query TEXT,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- -- TABLE SCHEMA CACHE
-- CREATE TABLE IF NOT EXISTS table_schemas (
--     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--     connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
--     table_name VARCHAR(255) NOT NULL,
--     schema_json JSONB NOT NULL,
--     last_fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- -- ERD RELATIONS
-- CREATE TABLE IF NOT EXISTS erd_relations (
--     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--     connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
--     table_from VARCHAR(255) NOT NULL,
--     table_to VARCHAR(255) NOT NULL,
--     column_from VARCHAR(255) NOT NULL,
--     column_to VARCHAR(255) NOT NULL,
--     relation_type VARCHAR(50), -- one-to-one, one-to-many, many-to-many
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- -- DASHBOARDS TABLE
-- CREATE TABLE IF NOT EXISTS dashboards (
--     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--     user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
--     connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
--     name VARCHAR(255) NOT NULL,
--     layout_config JSONB,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- -- DASHBOARD WIDGETS TABLE
-- CREATE TABLE IF NOT EXISTS dashboard_widgets (
--     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--     dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
--     type VARCHAR(50) NOT NULL, -- chart, table, counter, kpi, custom-sql
--     sql_query TEXT NOT NULL,
--     config_json JSONB,
--     refresh_interval INTEGER, -- milliseconds
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- ============================================
-- SEED DATA (Optional - for development)
-- ============================================
-- INSERT INTO users (email, password_hash, username) 
-- VALUES ('admin@chatsql.io', '$2b$10$...', 'admin');

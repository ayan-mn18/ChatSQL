-- ============================================
-- ChatSQL - Viewer/Access Management Schema
-- PostgreSQL Database Setup
-- ============================================
-- 
-- Run this migration to add viewer management tables
-- psql -U your_username -d chatsql -f viewer_schema.sql
-- ============================================

-- ============================================
-- ADD ROLE COLUMN TO USERS TABLE
-- Roles: 'super_admin' (can create viewers), 'viewer' (limited access)
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'role') THEN
        ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'super_admin';
    END IF;
END $$;

-- Add created_by column to track who created the viewer
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'created_by_user_id') THEN
        ALTER TABLE users ADD COLUMN created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Add temporary access expiry column
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'expires_at') THEN
        ALTER TABLE users ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Add flag to track if this is a temporary viewer
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'is_temporary') THEN
        ALTER TABLE users ADD COLUMN is_temporary BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Add flag to track if viewer must change password on first login
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'must_change_password') THEN
        ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Index for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users(expires_at);

-- ============================================
-- VIEWER PERMISSIONS TABLE
-- Stores granular access permissions for viewers
-- Links viewer to specific connections, schemas, and tables
-- ============================================
CREATE TABLE IF NOT EXISTS viewer_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    viewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    schema_name VARCHAR(255),                          -- NULL = all schemas in connection
    table_name VARCHAR(255),                           -- NULL = all tables in schema
    
    -- CRUD Permissions
    can_select BOOLEAN DEFAULT FALSE,                  -- Read access (SELECT)
    can_insert BOOLEAN DEFAULT FALSE,                  -- Write access (INSERT)
    can_update BOOLEAN DEFAULT FALSE,                  -- Update access (UPDATE)
    can_delete BOOLEAN DEFAULT FALSE,                  -- Delete access (DELETE)
    
    -- Feature Permissions
    can_use_ai BOOLEAN DEFAULT TRUE,                   -- Can use AI to generate queries
    can_view_analytics BOOLEAN DEFAULT FALSE,          -- Can view analytics dashboard
    can_export BOOLEAN DEFAULT TRUE,                   -- Can export query results
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique permission per viewer + connection + schema + table combination
    CONSTRAINT unique_viewer_permission UNIQUE (viewer_user_id, connection_id, schema_name, table_name)
);

-- Indexes for viewer_permissions
CREATE INDEX IF NOT EXISTS idx_viewer_permissions_viewer ON viewer_permissions(viewer_user_id);
CREATE INDEX IF NOT EXISTS idx_viewer_permissions_connection ON viewer_permissions(connection_id);
CREATE INDEX IF NOT EXISTS idx_viewer_permissions_schema ON viewer_permissions(schema_name);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_viewer_permissions_updated_at ON viewer_permissions;
CREATE TRIGGER update_viewer_permissions_updated_at
    BEFORE UPDATE ON viewer_permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VIEWER INVITATIONS TABLE
-- Tracks pending invitations sent to viewers
-- ============================================
CREATE TABLE IF NOT EXISTS viewer_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    temp_password_hash VARCHAR(255) NOT NULL,          -- Hashed temporary password
    status VARCHAR(50) DEFAULT 'pending',              -- pending, accepted, expired, revoked
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,      -- Invitation expiry (e.g., 7 days)
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Store permission config as JSON until user accepts
    permission_config JSONB NOT NULL                   -- Stores the full permission setup
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
    action_type VARCHAR(100) NOT NULL,                 -- login, query_executed, export, etc.
    action_details JSONB,                              -- Additional context (query text, etc.)
    ip_address VARCHAR(45),                            -- IPv4 or IPv6
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
-- Viewers can request extensions/permission changes; admins approve/deny.
-- ============================================
CREATE TABLE IF NOT EXISTS viewer_access_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    viewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    schema_name VARCHAR(255),
    table_name VARCHAR(255),
    requested_additional_hours INTEGER,
    requested_permissions JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, approved, denied, cancelled
    decided_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    decision_reason TEXT,
    decided_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_viewer_access_requests_viewer ON viewer_access_requests(viewer_user_id);
CREATE INDEX IF NOT EXISTS idx_viewer_access_requests_status ON viewer_access_requests(status);
CREATE INDEX IF NOT EXISTS idx_viewer_access_requests_created ON viewer_access_requests(created_at);

-- ============================================
-- HELPER FUNCTION: Check if user has permission on table
-- Returns TRUE if user has the specified permission
-- ============================================
CREATE OR REPLACE FUNCTION check_viewer_permission(
    p_user_id UUID,
    p_connection_id UUID,
    p_schema_name VARCHAR(255),
    p_table_name VARCHAR(255),
    p_permission VARCHAR(50)  -- 'select', 'insert', 'update', 'delete'
)
RETURNS BOOLEAN AS $$
DECLARE
    has_permission BOOLEAN := FALSE;
BEGIN
    -- Check for exact table permission
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
        -- More specific permissions take precedence
        CASE WHEN table_name IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN schema_name IS NOT NULL THEN 0 ELSE 1 END
    LIMIT 1;
    
    RETURN COALESCE(has_permission, FALSE);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- HELPER FUNCTION: Get all accessible connections for a viewer
-- ============================================
CREATE OR REPLACE FUNCTION get_viewer_connections(p_user_id UUID)
RETURNS TABLE (connection_id UUID) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT vp.connection_id
    FROM viewer_permissions vp
    WHERE vp.viewer_user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- HELPER FUNCTION: Get accessible schemas for a viewer on a connection
-- ============================================
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

-- ============================================
-- ChatSQL - Connections Schema Migration
-- PostgreSQL Database Setup
-- ============================================
-- 
-- Run this migration to add connection-related tables
-- psql -U your_username -d chatsql -f connections_schema.sql
-- ============================================

-- ============================================
-- CONNECTIONS TABLE
-- Stores user database connections (PostgreSQL only for now)
-- ============================================
CREATE TABLE IF NOT EXISTS connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,                    -- Display name for the connection
    host VARCHAR(255) NOT NULL,                    -- Database host
    port INTEGER NOT NULL DEFAULT 5432,            -- Database port
    type VARCHAR(50) NOT NULL DEFAULT 'postgres',  -- Database type (only 'postgres' for now)
    db_name VARCHAR(255) NOT NULL,                 -- Database name
    username VARCHAR(255) NOT NULL,                -- Database username
    password_enc TEXT NOT NULL,                    -- Encrypted password (AES-256)
    ssl BOOLEAN DEFAULT FALSE,                     -- SSL connection
    extra_options JSONB,                           -- Additional connection options
    is_valid BOOLEAN DEFAULT FALSE,                -- Last connection test result
    schema_synced BOOLEAN DEFAULT FALSE,           -- Whether schema has been fetched
    schema_synced_at TIMESTAMP WITH TIME ZONE,     -- Last schema sync time
    last_tested_at TIMESTAMP WITH TIME ZONE,       -- Last connection test time
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique connection names per user
    CONSTRAINT unique_connection_name_per_user UNIQUE (user_id, name)
);

-- Indexes for connections table
CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_type ON connections(type);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_connections_updated_at ON connections;
CREATE TRIGGER update_connections_updated_at
    BEFORE UPDATE ON connections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- DATABASE SCHEMAS TABLE
-- Stores PostgreSQL schemas (public, analytics, etc.) for each connection
-- User can select which schemas to sync/use
-- ============================================
CREATE TABLE IF NOT EXISTS database_schemas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    schema_name VARCHAR(255) NOT NULL,                  -- e.g., 'public', 'analytics', 'sales'
    is_selected BOOLEAN DEFAULT TRUE,                   -- Whether user wants to use this schema
    table_count INTEGER DEFAULT 0,                      -- Number of tables in this schema
    description TEXT,                                   -- Optional description
    last_synced_at TIMESTAMP WITH TIME ZONE,           -- When this schema was last synced
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique schema per connection
    CONSTRAINT unique_schema_per_connection UNIQUE (connection_id, schema_name)
);

-- Indexes for database_schemas table
CREATE INDEX IF NOT EXISTS idx_database_schemas_connection_id ON database_schemas(connection_id);
CREATE INDEX IF NOT EXISTS idx_database_schemas_is_selected ON database_schemas(is_selected);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_database_schemas_updated_at ON database_schemas;
CREATE TRIGGER update_database_schemas_updated_at
    BEFORE UPDATE ON database_schemas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TABLE SCHEMAS CACHE
-- Stores cached table metadata from user's external databases
-- ============================================
CREATE TABLE IF NOT EXISTS table_schemas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    database_schema_id UUID REFERENCES database_schemas(id) ON DELETE CASCADE,  -- FK to database_schemas
    schema_name VARCHAR(255) NOT NULL DEFAULT 'public',   -- Schema name (e.g., 'public', 'analytics')
    table_name VARCHAR(255) NOT NULL,                     -- Table name
    table_type VARCHAR(50) DEFAULT 'BASE TABLE',          -- BASE TABLE, VIEW, MATERIALIZED VIEW
    columns JSONB NOT NULL,                               -- Array of column definitions
    primary_key_columns JSONB,                            -- Array of primary key column names
    indexes JSONB,                                        -- Array of index definitions
    row_count INTEGER,                                    -- Estimated row count
    table_size_bytes BIGINT,                              -- Table size in bytes
    description TEXT,                                     -- Table comment/description if available
    last_fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique table per connection + schema
    CONSTRAINT unique_table_per_connection_schema UNIQUE (connection_id, schema_name, table_name)
);

-- Example columns JSONB structure:
-- [
--   { "name": "id", "type": "uuid", "nullable": false, "isPrimaryKey": true, "default": "uuid_generate_v4()" },
--   { "name": "email", "type": "varchar(255)", "nullable": false, "isPrimaryKey": false },
--   { "name": "created_at", "type": "timestamptz", "nullable": false, "isPrimaryKey": false, "default": "CURRENT_TIMESTAMP" }
-- ]

-- Indexes for table_schemas
CREATE INDEX IF NOT EXISTS idx_table_schemas_connection_id ON table_schemas(connection_id);
CREATE INDEX IF NOT EXISTS idx_table_schemas_schema_name ON table_schemas(schema_name);
CREATE INDEX IF NOT EXISTS idx_table_schemas_table_name ON table_schemas(table_name);
CREATE INDEX IF NOT EXISTS idx_table_schemas_database_schema_id ON table_schemas(database_schema_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_table_schemas_updated_at ON table_schemas;
CREATE TRIGGER update_table_schemas_updated_at
    BEFORE UPDATE ON table_schemas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ERD RELATIONS
-- Stores foreign key relationships between tables
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
    constraint_name VARCHAR(255),                         -- FK constraint name
    relation_type VARCHAR(50) DEFAULT 'one-to-many',     -- one-to-one, one-to-many, many-to-many
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique relation per connection
    CONSTRAINT unique_relation UNIQUE (connection_id, source_schema, source_table, source_column, target_table, target_column)
);

-- Indexes for erd_relations
CREATE INDEX IF NOT EXISTS idx_erd_relations_connection_id ON erd_relations(connection_id);
CREATE INDEX IF NOT EXISTS idx_erd_relations_source ON erd_relations(source_table);
CREATE INDEX IF NOT EXISTS idx_erd_relations_target ON erd_relations(target_table);

-- ============================================
-- QUERIES TABLE (Query History + Saved Queries)
-- ============================================
CREATE TABLE IF NOT EXISTS queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL,                     -- The SQL query
    raw_result JSONB,                             -- Query result (limited rows for history)
    row_count INTEGER,                            -- Number of rows returned
    execution_time_ms INTEGER,                    -- Execution time in milliseconds
    status VARCHAR(50) NOT NULL DEFAULT 'success', -- success, error
    error_message TEXT,                           -- Error message if failed
    is_saved BOOLEAN DEFAULT FALSE,               -- Is this a saved query?
    saved_name VARCHAR(255),                      -- Name for saved queries
    is_ai_generated BOOLEAN DEFAULT FALSE,        -- Was this generated by AI?
    ai_prompt TEXT,                               -- Original AI prompt if AI generated
    tables_used JSONB,                            -- Tables used in the query (for AI context)
    columns_used JSONB,                           -- Columns used in the query (for AI context)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for queries table
CREATE INDEX IF NOT EXISTS idx_queries_user_id ON queries(user_id);
CREATE INDEX IF NOT EXISTS idx_queries_connection_id ON queries(connection_id);
CREATE INDEX IF NOT EXISTS idx_queries_is_saved ON queries(is_saved);
CREATE INDEX IF NOT EXISTS idx_queries_created_at ON queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queries_is_ai_generated ON queries(is_ai_generated) WHERE is_ai_generated = true;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE connections IS 'Stores user database connections. Passwords are encrypted using AES-256.';
COMMENT ON COLUMN connections.password_enc IS 'Encrypted database password. Never exposed via API.';
COMMENT ON COLUMN connections.schema_synced IS 'True if we have fetched and cached the schema metadata.';
COMMENT ON TABLE database_schemas IS 'PostgreSQL schemas (public, analytics, etc.) for each connection. User can select which to use.';
COMMENT ON COLUMN database_schemas.is_selected IS 'If true, this schema will be included in AI context and sidebar.';
COMMENT ON TABLE table_schemas IS 'Cached table metadata from external databases. Organized by schema_name.';
COMMENT ON COLUMN table_schemas.schema_name IS 'PostgreSQL schema name (e.g., public, analytics, sales).';
COMMENT ON TABLE erd_relations IS 'Cached foreign key relationships for ERD visualization.';
COMMENT ON TABLE queries IS 'Query execution history and saved queries.';

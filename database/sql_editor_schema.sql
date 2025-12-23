-- ============================================
-- ChatSQL - SQL Editor Enhancement Schema Migration
-- PostgreSQL Database Setup
-- ============================================
-- 
-- Run this migration to add SQL editor related tables:
-- - saved_queries: User-saved queries with sharing support
-- - chat_sessions: AI chat sessions per connection
-- - chat_messages: Individual messages in chat sessions
-- 
-- psql -U your_username -d chatsql -f sql_editor_schema.sql
-- ============================================

-- ============================================
-- SAVED QUERIES TABLE
-- Stores user-saved SQL queries with optional sharing
-- ============================================
CREATE TABLE IF NOT EXISTS saved_queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,                    -- Display name for the saved query
    description TEXT,                              -- Optional description
    query_text TEXT NOT NULL,                      -- The SQL query
    tags JSONB DEFAULT '[]',                       -- Array of tags for filtering
    is_shared BOOLEAN DEFAULT FALSE,              -- If true, viewers can see this query
    folder VARCHAR(255),                           -- Optional folder/category
    last_used_at TIMESTAMP WITH TIME ZONE,        -- Last time query was executed
    use_count INTEGER DEFAULT 0,                  -- Number of times executed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique query name per user per connection
    CONSTRAINT unique_saved_query_name UNIQUE (user_id, connection_id, name)
);

-- Indexes for saved_queries table
CREATE INDEX IF NOT EXISTS idx_saved_queries_user_id ON saved_queries(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_queries_connection_id ON saved_queries(connection_id);
CREATE INDEX IF NOT EXISTS idx_saved_queries_is_shared ON saved_queries(is_shared);
CREATE INDEX IF NOT EXISTS idx_saved_queries_tags ON saved_queries USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_saved_queries_name ON saved_queries(name);
CREATE INDEX IF NOT EXISTS idx_saved_queries_last_used ON saved_queries(last_used_at DESC NULLS LAST);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_saved_queries_updated_at ON saved_queries;
CREATE TRIGGER update_saved_queries_updated_at
    BEFORE UPDATE ON saved_queries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CHAT SESSIONS TABLE
-- AI chat sessions per connection (one active per user-connection)
-- ============================================
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    title VARCHAR(255) DEFAULT 'New Chat',        -- Auto-generated from first message
    is_active BOOLEAN DEFAULT TRUE,               -- Active session (for resuming)
    message_count INTEGER DEFAULT 0,              -- Number of messages in session
    last_message_at TIMESTAMP WITH TIME ZONE,     -- Last message timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for chat_sessions table
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_connection_id ON chat_sessions(connection_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_is_active ON chat_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_connection ON chat_sessions(user_id, connection_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER update_chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CHAT MESSAGES TABLE
-- Individual messages in a chat session
-- ============================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,                    -- 'user' or 'assistant'
    content TEXT NOT NULL,                        -- Message content (markdown supported)
    sql_generated TEXT,                           -- SQL extracted from assistant response
    reasoning JSONB,                              -- AI reasoning if applicable
    tables_used JSONB,                            -- Tables referenced in generated SQL
    execution_result JSONB,                       -- If SQL was executed, store result summary
    is_error BOOLEAN DEFAULT FALSE,               -- If this is an error message
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for chat_messages table
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_role ON chat_messages(role);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_has_sql ON chat_messages(sql_generated) WHERE sql_generated IS NOT NULL;

-- ============================================
-- ADD COLUMNS TO EXISTING QUERIES TABLE
-- Link executed queries to saved queries and chat
-- ============================================
DO $$ 
BEGIN
    -- Add saved_query_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'queries' AND column_name = 'saved_query_id'
    ) THEN
        ALTER TABLE queries ADD COLUMN saved_query_id UUID REFERENCES saved_queries(id) ON DELETE SET NULL;
        CREATE INDEX idx_queries_saved_query_id ON queries(saved_query_id);
    END IF;

    -- Add chat_message_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'queries' AND column_name = 'chat_message_id'
    ) THEN
        ALTER TABLE queries ADD COLUMN chat_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL;
        CREATE INDEX idx_queries_chat_message_id ON queries(chat_message_id);
    END IF;

    -- Add query_type column for permission checking
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'queries' AND column_name = 'query_type'
    ) THEN
        ALTER TABLE queries ADD COLUMN query_type VARCHAR(20) DEFAULT 'SELECT';
        CREATE INDEX idx_queries_query_type ON queries(query_type);
    END IF;
END $$;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE saved_queries IS 'User-saved SQL queries with optional sharing to viewers.';
COMMENT ON COLUMN saved_queries.is_shared IS 'When true, viewers with connection access can see and use this query.';
COMMENT ON COLUMN saved_queries.tags IS 'JSON array of string tags for categorization and filtering.';
COMMENT ON TABLE chat_sessions IS 'AI chat sessions, one active session per user per connection.';
COMMENT ON TABLE chat_messages IS 'Individual messages in chat sessions, including AI responses with generated SQL.';
COMMENT ON COLUMN chat_messages.sql_generated IS 'SQL code extracted from assistant responses for easy insertion into editor.';
COMMENT ON COLUMN queries.query_type IS 'Type of query: SELECT, INSERT, UPDATE, DELETE, DDL, OTHER.';

# Database Setup

This directory contains the database schema and setup files for ChatSQL.

## Quick Start

To set up the ChatSQL database from scratch:

1. Create a PostgreSQL database:
```bash
createdb chatsql
```

2. Run the schema migration:
```bash
psql -U your_username -d chatsql -f database/migration-v0/schema.sql
```

3. (Optional) Seed with sample data:
```bash
psql -U your_username -d chatsql -f database/seed.sql
```

## Files

- **migration-v0/schema.sql** - Complete database schema (v0)
  - Users & authentication
  - Database connections
  - Query history
  - Saved queries & chat
  - Viewer management & permissions
  - Email logging
  
- **seed.sql** - Sample data for development (optional)

## Schema Overview

### Core Tables
- `users` - User accounts (super_admin, viewer)
- `connections` - Database connections
- `queries` - Query execution history
- `saved_queries` - User-saved queries
- `chat_sessions`, `chat_messages` - AI chat conversations

### Schema Management
- `database_schemas` - PostgreSQL schemas per connection
- `table_schemas` - Cached table metadata
- `erd_relations` - Foreign key relationships

### Access Control
- `viewer_permissions` - Granular table/schema permissions
- `viewer_invitations` - Pending viewer invitations
- `viewer_activity_log` - Audit trail
- `viewer_access_requests` - Access extension requests

### System Tables
- `email_verifications` - OTP codes
- `password_resets` - Password reset tokens
- `email_logs` - Email audit trail

## Database Migrations

For future schema changes, create new migration files:
- `migration-v1/` - Next version changes
- `migration-v2/` - And so on...

Always maintain backwards compatibility or provide upgrade scripts.

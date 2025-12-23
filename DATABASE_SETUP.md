# ChatSQL Database Setup

## For New Installations

If you're setting up ChatSQL for the first time, run the complete database schema:

```bash
# 1. Create the database
createdb chatsql

# 2. Run the schema migration
psql -U postgres -d chatsql -f database/migration-v0/schema.sql

# 3. (Optional) Add seed data for development
psql -U postgres -d chatsql -f database/seed.sql
```

## For Existing Installations

If you already have ChatSQL running and need to add the missing `tables_used` and `columns_used` columns:

```sql
-- Run this in your ChatSQL database
ALTER TABLE queries ADD COLUMN IF NOT EXISTS tables_used JSONB;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS columns_used JSONB;
```

## What's Included

The migration creates all necessary tables:
- Authentication (users, email_verifications, password_resets)
- Database connections and schema caching
- Query history and saved queries
- AI chat sessions
- Viewer management and permissions
- Email audit logs

See [database/README.md](database/README.md) for full schema documentation.

## Environment Variables

Make sure your `.env` file has the correct database connection:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=chatsql
DB_USER=postgres
DB_PASSWORD=your_password
```

## Verification

After running the schema, verify all tables were created:

```bash
psql -U postgres -d chatsql -c "\dt"
```

You should see approximately 20+ tables listed.

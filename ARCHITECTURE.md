# ChatSQL - Architecture & API Plan

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (React/Next.js)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  Dashboard │ SQL Editor │ AI Query │ Table Explorer │ ERD Viewer │ Analytics│
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY / LOAD BALANCER                        │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
┌───────────────┐        ┌─────────────────┐        ┌─────────────────┐
│  Auth Service │        │   Core API      │        │   AI Service    │
│  (JWT/OAuth)  │        │   (Express)     │        │ (OpenAI/Claude) │
└───────────────┘        └────────┬────────┘        └─────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
┌───────────────┐        ┌─────────────────┐        ┌─────────────────┐
│  Redis Cache  │        │  PostgreSQL     │        │ User's External │
│  (Sessions,   │        │  (App Data)     │        │    Databases    │
│   Metadata)   │        │                 │        │ (PG/MySQL/etc)  │
└───────────────┘        └─────────────────┘        └─────────────────┘
```

---

## 📁 Folder Structure

```
ChatSQL/
├── src/
│   ├── config/
│   │   ├── db.ts                 # App database connection
│   │   ├── redis.ts              # Redis client configuration
│   │   └── env.ts                # Environment variables
│   │
│   ├── middleware/
│   │   ├── auth.ts               # JWT authentication
│   │   ├── rateLimiter.ts        # API rate limiting
│   │   ├── validator.ts          # Request validation
│   │   └── errorHandler.ts       # Global error handling
│   │
│   ├── routes/
│   │   ├── auth.routes.ts        # Authentication routes
│   │   ├── connection.routes.ts  # DB connection management
│   │   ├── query.routes.ts       # SQL execution & history
│   │   ├── ai.routes.ts          # AI query generation
│   │   ├── schema.routes.ts      # Table metadata & ERD
│   │   ├── data.routes.ts        # Table data CRUD
│   │   └── dashboard.routes.ts   # Analytics dashboards
│   │
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── connection.controller.ts
│   │   ├── query.controller.ts
│   │   ├── ai.controller.ts
│   │   ├── schema.controller.ts
│   │   ├── data.controller.ts
│   │   └── dashboard.controller.ts
│   │
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── connection.service.ts
│   │   ├── query.service.ts
│   │   ├── ai.service.ts
│   │   ├── schema.service.ts
│   │   ├── data.service.ts
│   │   ├── dashboard.service.ts
│   │   └── cache.service.ts      # Redis caching layer
│   │
│   ├── models/
│   │   ├── User.ts
│   │   ├── Connection.ts
│   │   ├── Query.ts
│   │   ├── AIQueryLog.ts
│   │   ├── TableSchema.ts
│   │   ├── ERDRelation.ts
│   │   ├── Dashboard.ts
│   │   └── DashboardWidget.ts
│   │
│   ├── utils/
│   │   ├── encryption.ts         # Password & connection encryption
│   │   ├── dbConnector.ts        # Dynamic DB connection factory
│   │   ├── queryParser.ts        # SQL parsing & validation
│   │   └── typeMapper.ts         # DB type to frontend type mapping
│   │
│   └── types/
│       └── index.ts              # TypeScript interfaces
│
├── server.ts                     # Express app entry point
├── package.json
└── tsconfig.json
```

---

## 🔐 Authentication APIs

### `POST /api/auth/register`
Register new user and send OTP to email.
```typescript
Request: { email, password, username? }
Response: { success, message: "OTP sent to email", expiresIn: 600 }
```

### `POST /api/auth/verify-email`
Verify email with OTP code.
```typescript
Request: { email, otp }
Response: { success, user, message: "Email verified successfully" }
// Sets JWT cookie on success
```

### `POST /api/auth/resend-otp`
Resend OTP to email.
```typescript
Request: { email }
Response: { success, message: "OTP resent", expiresIn: 600 }
```

### `POST /api/auth/login`
Login with verified email.
```typescript
Request: { email, password }
Response: { success, user }
// Sets JWT cookie on success
// Returns error if email not verified
```

### `POST /api/auth/logout`
Logout and clear cookie.
```typescript
Request: { } (requires auth cookie)
Response: { success, message: "Logged out successfully" }
```

### `POST /api/auth/forgot-password`
Request password reset email.
```typescript
Request: { email }
Response: { success, message: "If email exists, reset link sent" }
```

### `POST /api/auth/reset-password`
Reset password with token.
```typescript
Request: { token, newPassword }
Response: { success, message: "Password reset successfully" }
```

### `GET /api/auth/me`
Get current user profile.
```typescript
Response: { success, user: { id, email, username, profile_url, is_verified, created_at } }
```

### `PUT /api/auth/profile`
Update user profile.
```typescript
Request: { username?, profile_url? }
Response: { success, user }
```

---

## 🔌 Connection Management APIs

### `POST /api/connections`
Create a new database connection.
```typescript
Request: {
  name: string,
  host: string,
  port: number,
  type: 'postgres' | 'mysql' | 'mssql' | 'mongodb',
  db_name: string,
  username: string,
  password: string,
  extra_options?: { ssl?: boolean, timeout?: number }
}
Response: { success, connection: { id, name, type, host, is_valid } }
```

### `POST /api/connections/test`
Test database connection before saving.
```typescript
Request: { host, port, type, db_name, username, password, extra_options? }
Response: { success, message, latency_ms }
```

### `GET /api/connections`
List all user connections.
```typescript
Response: { success, connections: Connection[] }
```

### `GET /api/connections/:id`
Get single connection details.
```typescript
Response: { success, connection }
```

### `PUT /api/connections/:id`
Update connection details.
```typescript
Request: { name?, host?, port?, username?, password?, extra_options? }
Response: { success, connection }
```

### `DELETE /api/connections/:id`
Delete a connection.
```typescript
Response: { success }
```

### `POST /api/connections/:id/reconnect`
Re-validate connection.
```typescript
Response: { success, is_valid, message }
```

---

## 📊 Schema & Metadata APIs

### `GET /api/connections/:connectionId/tables`
Get all tables with metadata (cached).
```typescript
Response: {
  success,
  tables: [{
    id, name, description, rowCount, schema,
    columns: [{ key, label, type, dataType, sortable, isPrimaryKey, isNullable }]
  }],
  totalTables,
  cached: boolean,
  cachedAt?: timestamp
}
```

### `GET /api/connections/:connectionId/tables/:tableName`
Get single table metadata.
```typescript
Response: { success, table: TableInfo }
```

### `GET /api/connections/:connectionId/tables/:tableName/columns`
Get columns for a specific table.
```typescript
Response: { success, columns: ColumnInfo[] }
```

### `POST /api/connections/:connectionId/schema/refresh`
Force refresh schema cache.
```typescript
Response: { success, tables, cachedAt }
```

### `GET /api/connections/:connectionId/erd`
Get ERD relationships.
```typescript
Response: {
  success,
  tables: [{ name, columns }],
  relationships: [{
    table_from, table_to,
    column_from, column_to,
    relation_type: 'one-to-one' | 'one-to-many' | 'many-to-many'
  }]
}
```

### `GET /api/connections/:connectionId/stats`
Get database statistics.
```typescript
Response: {
  success,
  stats: {
    total_tables, total_rows, database_size,
    table_sizes: [{ name, rows, size_mb }]
  }
}
```

---

## 📋 Table Data APIs (CRUD)

### `POST /api/connections/:connectionId/data/:tableName`
Get paginated table data.
```typescript
Request: {
  page?: number,
  pageSize?: number,
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
  filters?: [{ column, operator, value }],
  searchValue?: string,
  columns?: string[]
}
Response: {
  success,
  data: Record<string, any>[],
  pagination: { currentPage, pageSize, totalRecords, totalPages, hasNextPage, hasPreviousPage },
  columns: ColumnInfo[]
}
```

### `POST /api/connections/:connectionId/data/:tableName/insert`
Insert new row.
```typescript
Request: { row: Record<string, any> }
Response: { success, insertedRow, insertedId }
```

### `PUT /api/connections/:connectionId/data/:tableName/:rowId`
Update existing row.
```typescript
Request: { updates: Record<string, any>, primaryKey: { column, value } }
Response: { success, updatedRow }
```

### `DELETE /api/connections/:connectionId/data/:tableName/:rowId`
Delete a row.
```typescript
Request: { primaryKey: { column, value } }
Response: { success }
```

### `POST /api/connections/:connectionId/data/:tableName/bulk-insert`
Bulk insert rows.
```typescript
Request: { rows: Record<string, any>[] }
Response: { success, insertedCount }
```

### `POST /api/connections/:connectionId/data/:tableName/bulk-delete`
Bulk delete rows.
```typescript
Request: { primaryKeys: { column, values: any[] } }
Response: { success, deletedCount }
```

---

## ⚡ SQL Query Execution APIs

### `POST /api/connections/:connectionId/query/execute`
Execute raw SQL query.
```typescript
Request: {
  query: string,
  params?: any[],
  limit?: number
}
Response: {
  success,
  data: any[],
  rowCount: number,
  executionTime: number,
  columns: ColumnInfo[],
  queryId: string
}
```

### `GET /api/connections/:connectionId/query/history`
Get query history.
```typescript
Query: { page?, pageSize?, status?, search? }
Response: {
  success,
  queries: [{
    id, query_text, row_count, execution_time,
    status, error_message, created_at, is_saved, saved_name
  }],
  pagination
}
```

### `POST /api/connections/:connectionId/query/:queryId/save`
Save a query.
```typescript
Request: { name: string }
Response: { success, query }
```

### `GET /api/connections/:connectionId/query/saved`
Get saved queries.
```typescript
Response: { success, queries: Query[] }
```

### `DELETE /api/connections/:connectionId/query/:queryId`
Delete saved query.
```typescript
Response: { success }
```

### `POST /api/connections/:connectionId/query/explain`
Get query execution plan.
```typescript
Request: { query: string }
Response: { success, plan: any }
```

---

## 🤖 AI Query Generation APIs

### `POST /api/connections/:connectionId/ai/generate`
Generate SQL from natural language.
```typescript
Request: {
  prompt: string,
  context?: { tables?: string[], previousQuery?: string }
}
Response: {
  success,
  query: string,
  explanation: string,
  confidence: number,
  logId: string
}
```

### `POST /api/connections/:connectionId/ai/explain`
Explain a SQL query in plain English.
```typescript
Request: { query: string }
Response: { success, explanation: string }
```

### `POST /api/connections/:connectionId/ai/optimize`
Get query optimization suggestions.
```typescript
Request: { query: string }
Response: {
  success,
  optimizedQuery: string,
  suggestions: string[],
  estimatedImprovement: string
}
```

### `GET /api/connections/:connectionId/ai/history`
Get AI query generation history.
```typescript
Response: { success, logs: AIQueryLog[] }
```

### `POST /api/connections/:connectionId/ai/feedback`
Submit feedback on AI generation.
```typescript
Request: { logId: string, rating: 1-5, feedback?: string }
Response: { success }
```

---

## 📈 Dashboard & Analytics APIs

### `POST /api/connections/:connectionId/dashboards`
Create new dashboard.
```typescript
Request: { name: string, layout_config?: object }
Response: { success, dashboard }
```

### `GET /api/connections/:connectionId/dashboards`
List all dashboards for connection.
```typescript
Response: { success, dashboards: Dashboard[] }
```

### `GET /api/connections/:connectionId/dashboards/:dashboardId`
Get dashboard with widgets.
```typescript
Response: { success, dashboard, widgets: DashboardWidget[] }
```

### `PUT /api/connections/:connectionId/dashboards/:dashboardId`
Update dashboard.
```typescript
Request: { name?, layout_config? }
Response: { success, dashboard }
```

### `DELETE /api/connections/:connectionId/dashboards/:dashboardId`
Delete dashboard.
```typescript
Response: { success }
```

### `POST /api/connections/:connectionId/dashboards/:dashboardId/widgets`
Add widget to dashboard.
```typescript
Request: {
  type: 'chart' | 'table' | 'counter' | 'kpi' | 'custom-sql',
  sql_query: string,
  config_json: {
    title: string,
    chartType?: 'bar' | 'line' | 'pie' | 'area',
    xAxis?: string,
    yAxis?: string,
    colors?: string[]
  },
  refresh_interval?: number
}
Response: { success, widget }
```

### `PUT /api/connections/:connectionId/dashboards/:dashboardId/widgets/:widgetId`
Update widget.
```typescript
Request: { sql_query?, config_json?, refresh_interval? }
Response: { success, widget }
```

### `DELETE /api/connections/:connectionId/dashboards/:dashboardId/widgets/:widgetId`
Delete widget.
```typescript
Response: { success }
```

### `POST /api/connections/:connectionId/dashboards/:dashboardId/widgets/:widgetId/refresh`
Refresh widget data.
```typescript
Response: { success, data, executedAt }
```

---

## 🗄️ Caching Strategy (Redis)

```typescript
Cache Keys:
├── user:{userId}:session                    # User session (TTL: 24h)
├── connection:{connectionId}:schema         # Table schema (TTL: 5min)
├── connection:{connectionId}:tables         # Table list (TTL: 5min)
├── connection:{connectionId}:erd            # ERD data (TTL: 10min)
├── connection:{connectionId}:stats          # DB stats (TTL: 1min)
├── query:{queryHash}:result                 # Query results (TTL: 30s)
└── dashboard:{dashboardId}:widget:{widgetId} # Widget data (TTL: based on refresh_interval)

Invalidation Triggers:
- Schema changed → Invalidate schema, tables, erd
- Data modified → Invalidate query results, widget data
- Connection updated → Invalidate all connection-related cache
```

---

## 🔒 Security Considerations

1. **Connection Credentials**: Encrypt using AES-256 before storing
2. **SQL Injection**: Use parameterized queries only
3. **Rate Limiting**: 100 requests/min for queries, 10/min for AI
4. **Query Validation**: Prevent DROP, TRUNCATE, ALTER (unless explicitly allowed)
5. **Row Limits**: Max 1000 rows per query to prevent memory issues
6. **Timeout**: 30s max query execution time
7. **Audit Logging**: Log all data modifications

---

## 🚀 Implementation Priority

### Phase 1 - Core (Week 1-2)
1. Auth APIs (register, login, JWT)
2. Connection management (CRUD, test)
3. Schema APIs (getTables, getColumns)
4. Basic query execution

### Phase 2 - Data Explorer (Week 3)
1. Table data with pagination, sort, filter
2. CRUD operations on table data
3. Redis caching layer

### Phase 3 - AI & Query (Week 4)
1. AI query generation
2. Query history & saved queries
3. Query explanation

### Phase 4 - Visualization (Week 5)
1. ERD generation
2. Dashboard & widgets
3. Analytics charts

### Phase 5 - Polish (Week 6)
1. Performance optimization
2. Error handling improvements
3. Documentation & testing

---

This plan provides a complete roadmap for building ChatSQL. Ready to start implementation when you are!

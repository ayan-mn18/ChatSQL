# Queue & Cache Architecture for ChatSQL

## Table of Contents
1. [Overview](#overview)
2. [Queue System Selection](#queue-system-selection)
3. [Queue Architecture](#queue-architecture)
4. [Schema Sync Queue](#schema-sync-queue)
5. [AI Operations Queue](#ai-operations-queue)
6. [Caching Strategy](#caching-strategy)
7. [Intelligent DDL Fetching](#intelligent-ddl-fetching)
8. [Rate Limiting](#rate-limiting)
9. [UI/UX for Loading States](#uiux-for-loading-states)
10. [Implementation Plan](#implementation-plan)

---

## Overview

ChatSQL requires robust background processing for two main operations:
1. **Schema Metadata Sync** - Fetching database structure after connection
2. **AI Operations** - SQL generation, query explanation, optimization

Both need queuing to handle load, prevent timeouts, and provide good UX.

---

## Queue System Selection

### Options Considered

| Feature | Redis (BullMQ) | AWS SQS | RabbitMQ |
|---------|---------------|---------|----------|
| Setup Complexity | Low | Medium | High |
| Cost | Low (self-hosted) | Pay-per-use | Medium |
| Persistence | Configurable | Yes | Yes |
| Delayed Jobs | ✅ | ✅ | ✅ |
| Priority Queues | ✅ | ❌ (need 2 queues) | ✅ |
| Real-time Progress | ✅ (Pub/Sub) | ❌ | ✅ |
| Retries | ✅ | ✅ | ✅ |
| Dashboard | Bull Board | CloudWatch | Management UI |
| Learning Curve | Low | Low | Medium |

### ✅ Decision: Redis with BullMQ

**Reasons:**
1. **Already using Redis** for session/cache - no new infrastructure
2. **Real-time progress updates** via Redis Pub/Sub for live UI updates
3. **BullMQ** is battle-tested, TypeScript-native, great DX
4. **Bull Board** provides free admin dashboard
5. **Priority queues** in single queue (AI premium users)
6. **Low latency** for real-time features

```bash
npm install bullmq ioredis @bull-board/express @bull-board/api
```

---

## Queue Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           REDIS INSTANCE                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────┐     ┌──────────────────────┐                  │
│  │   SCHEMA SYNC QUEUE  │     │   AI OPERATIONS QUEUE │                  │
│  │   (schema-sync)      │     │   (ai-operations)     │                  │
│  │                      │     │                       │                  │
│  │  Jobs:               │     │  Jobs:                │                  │
│  │  - sync-full-schema  │     │  - generate-sql       │                  │
│  │  - sync-single-table │     │  - explain-query      │                  │
│  │  - refresh-schema    │     │  - optimize-query     │                  │
│  │                      │     │  - suggest-indexes    │                  │
│  └──────────────────────┘     └───────────────────────┘                  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         CACHE NAMESPACE                           │   │
│  │                                                                   │   │
│  │  schema:{connection_id}           → Full schema JSON (TTL: 24h)   │   │
│  │  schema:{connection_id}:{schema}  → Schema tables (TTL: 24h)      │   │
│  │  ddl:{connection_id}:{table}      → Table DDL (TTL: 1h)           │   │
│  │  ai_context:{connection_id}       → Compressed context (TTL: 1h)  │   │
│  │  rate_limit:{user_id}:ai          → Rate limit counter (TTL: 60s) │   │
│  │  job_progress:{job_id}            → Progress % (TTL: 1h)          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         PUB/SUB CHANNELS                          │   │
│  │                                                                   │   │
│  │  job:progress:{user_id}  → Real-time progress updates to UI       │   │
│  │  job:complete:{user_id}  → Job completion notifications           │   │
│  │  job:error:{user_id}     → Error notifications                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Worker Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      MAIN SERVER (Express)                       │
│                                                                  │
│  - API Endpoints                                                 │
│  - Job Producers (add jobs to queues)                           │
│  - SSE/WebSocket for progress updates                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      WORKER PROCESSES                            │
│                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────┐             │
│  │  Schema Worker (x2) │    │  AI Worker (x3)     │             │
│  │                     │    │                     │             │
│  │  - Connects to      │    │  - Calls OpenAI/    │             │
│  │    user's DB        │    │    Anthropic        │             │
│  │  - Fetches metadata │    │  - Processes prompts│             │
│  │  - Updates cache    │    │  - Returns results  │             │
│  │  - Publishes        │    │  - Handles retries  │             │
│  │    progress         │    │                     │             │
│  └─────────────────────┘    └─────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Schema Sync Queue

### Job Types

#### 1. `sync-full-schema` (After Connection Save)
Triggered when a new connection is saved. Fetches everything.

```typescript
interface SyncFullSchemaJob {
  type: 'sync-full-schema';
  connectionId: string;
  userId: string;
  priority: 'high' | 'normal';
}

// Job Processor Steps:
// 1. Decrypt connection password
// 2. Connect to external PostgreSQL
// 3. Fetch all schemas → Save to database_schemas
// 4. For each schema (in parallel, max 3):
//    a. Fetch tables → Save to table_schemas
//    b. Fetch columns for each table
//    c. Fetch foreign keys → Save to erd_relations
//    d. Publish progress: { schema: 'public', progress: 45 }
// 5. Update connection.schema_synced = true
// 6. Build AI context and cache it
// 7. Publish completion event
```

#### 2. `sync-single-schema` (Refresh Specific Schema)
When user clicks "Refresh" on a specific schema.

```typescript
interface SyncSingleSchemaJob {
  type: 'sync-single-schema';
  connectionId: string;
  schemaName: string;
  userId: string;
}
```

#### 3. `sync-single-table` (On-Demand Table Refresh)
Refresh metadata for a single table (columns, indexes, etc.)

```typescript
interface SyncSingleTableJob {
  type: 'sync-single-table';
  connectionId: string;
  schemaName: string;
  tableName: string;
  userId: string;
}
```

### Queue Configuration

```typescript
// src/queues/schema-sync.queue.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import { redisConnection } from '../config/redis';

export const schemaSyncQueue = new Queue('schema-sync', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 100, // Keep last 100 completed jobs
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

// Worker with concurrency of 2 (don't overload external DBs)
export const schemaSyncWorker = new Worker(
  'schema-sync',
  async (job) => {
    switch (job.data.type) {
      case 'sync-full-schema':
        return await processSyncFullSchema(job);
      case 'sync-single-schema':
        return await processSyncSingleSchema(job);
      case 'sync-single-table':
        return await processSyncSingleTable(job);
    }
  },
  {
    connection: redisConnection,
    concurrency: 2, // Max 2 parallel schema syncs
    limiter: {
      max: 10,      // Max 10 jobs
      duration: 60000, // Per minute
    },
  }
);
```

### Progress Tracking

```typescript
// During job processing
async function processSyncFullSchema(job: Job<SyncFullSchemaJob>) {
  const { connectionId, userId } = job.data;
  const redis = await getRedisClient();
  
  // Fetch schemas
  const schemas = await fetchSchemas(connectionId);
  let processed = 0;
  
  for (const schema of schemas) {
    // Fetch tables for this schema
    const tables = await fetchTables(connectionId, schema.name);
    
    // Update progress
    processed++;
    const progress = Math.round((processed / schemas.length) * 100);
    
    // Update job progress (stored in Redis by BullMQ)
    await job.updateProgress(progress);
    
    // Publish real-time update to user
    await redis.publish(`job:progress:${userId}`, JSON.stringify({
      jobId: job.id,
      type: 'schema-sync',
      connectionId,
      schema: schema.name,
      progress,
      message: `Syncing ${schema.name} (${tables.length} tables)...`,
    }));
  }
  
  // Publish completion
  await redis.publish(`job:complete:${userId}`, JSON.stringify({
    jobId: job.id,
    type: 'schema-sync',
    connectionId,
    success: true,
  }));
  
  return { success: true, schemasProcessed: schemas.length };
}
```

---

## AI Operations Queue

### Job Types

#### 1. `generate-sql` - Convert English to SQL
```typescript
interface GenerateSqlJob {
  type: 'generate-sql';
  connectionId: string;
  userId: string;
  prompt: string;           // User's natural language query
  selectedSchemas: string[]; // Which schemas to consider
  conversationId?: string;   // For context from previous queries
  priority: 'high' | 'normal' | 'low';
}
```

#### 2. `explain-query` - Explain SQL in Plain English
```typescript
interface ExplainQueryJob {
  type: 'explain-query';
  connectionId: string;
  userId: string;
  sql: string;
  includeExecutionPlan?: boolean;
}
```

#### 3. `optimize-query` - Suggest Query Optimizations
```typescript
interface OptimizeQueryJob {
  type: 'optimize-query';
  connectionId: string;
  userId: string;
  sql: string;
  executionPlan?: string; // EXPLAIN ANALYZE output
}
```

#### 4. `suggest-indexes` - AI Index Recommendations
```typescript
interface SuggestIndexesJob {
  type: 'suggest-indexes';
  connectionId: string;
  userId: string;
  tableName: string;
  schemaName: string;
  queryPatterns?: string[]; // Common queries on this table
}
```

### Queue Configuration

```typescript
// src/queues/ai-operations.queue.ts
export const aiOperationsQueue = new Queue('ai-operations', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 2000,
    },
    removeOnComplete: {
      age: 1800, // 30 minutes
      count: 200,
    },
    removeOnFail: {
      age: 3600, // 1 hour
    },
    // Priority: 1 = highest, 10 = lowest
    // Premium users get priority 1-3
    // Free users get priority 5-7
  },
});

// Worker with higher concurrency (AI calls are mostly waiting)
export const aiOperationsWorker = new Worker(
  'ai-operations',
  async (job) => {
    switch (job.data.type) {
      case 'generate-sql':
        return await processGenerateSql(job);
      case 'explain-query':
        return await processExplainQuery(job);
      case 'optimize-query':
        return await processOptimizeQuery(job);
      case 'suggest-indexes':
        return await processSuggestIndexes(job);
    }
  },
  {
    connection: redisConnection,
    concurrency: 5, // 5 parallel AI operations
    limiter: {
      max: 30,       // Max 30 jobs
      duration: 60000, // Per minute (0.5/sec)
    },
  }
);
```

### AI Job Processing

```typescript
async function processGenerateSql(job: Job<GenerateSqlJob>) {
  const { connectionId, userId, prompt, selectedSchemas } = job.data;
  
  // 1. Get cached AI context (compressed DDL)
  const aiContext = await getAIContext(connectionId, selectedSchemas);
  
  // 2. Build prompt with context
  const systemPrompt = buildSystemPrompt(aiContext);
  
  // 3. Call AI API (OpenAI/Anthropic)
  const result = await callAI({
    system: systemPrompt,
    user: prompt,
    maxTokens: 2000,
  });
  
  // 4. Validate generated SQL (basic syntax check)
  const validatedSql = await validateSql(result.sql);
  
  // 5. Store in queries table for history
  await saveQueryHistory({
    userId,
    connectionId,
    queryText: validatedSql,
    isAiGenerated: true,
    aiPrompt: prompt,
  });
  
  return {
    success: true,
    sql: validatedSql,
    explanation: result.explanation,
    confidence: result.confidence,
  };
}
```

---

## Caching Strategy

### Multi-Layer Cache Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        REQUEST FLOW                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: In-Memory LRU Cache (Node.js Process)                 │
│                                                                  │
│  - Fastest access (< 1ms)                                       │
│  - Small footprint (100MB max)                                  │
│  - TTL: 5 minutes                                               │
│  - Use: Hot data (active connection schemas)                    │
│                                                                  │
│  Cache Keys:                                                    │
│  - schema_summary:{conn_id} → Basic schema list                 │
│  - table_columns:{conn_id}:{schema}:{table} → Column list       │
└─────────────────────────────────────────────────────────────────┘
                              │
                        CACHE MISS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: Redis Cache                                            │
│                                                                  │
│  - Fast access (1-5ms)                                          │
│  - Shared across instances                                      │
│  - Persistent (survives restarts)                               │
│  - TTL: Varies by data type                                     │
│                                                                  │
│  Cache Keys & TTLs:                                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  schema:{conn_id}                    TTL: 24 hours       │    │
│  │  → Full schema tree (all schemas + tables + columns)     │    │
│  │                                                          │    │
│  │  schema:{conn_id}:{schema_name}      TTL: 24 hours       │    │
│  │  → Single schema with tables                             │    │
│  │                                                          │    │
│  │  ai_context:{conn_id}                TTL: 1 hour         │    │
│  │  → Compressed DDL for AI prompts                         │    │
│  │                                                          │    │
│  │  ai_context:{conn_id}:{schema}       TTL: 1 hour         │    │
│  │  → Schema-specific AI context                            │    │
│  │                                                          │    │
│  │  table_preview:{conn_id}:{table}     TTL: 10 minutes     │    │
│  │  → Sample rows for table preview                         │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                        CACHE MISS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: PostgreSQL (Our Database)                              │
│                                                                  │
│  - Persistent storage                                           │
│  - Source of truth for cached metadata                          │
│  - Access time: 10-50ms                                         │
│                                                                  │
│  Tables:                                                        │
│  - database_schemas                                             │
│  - table_schemas                                                │
│  - erd_relations                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                        CACHE MISS (rare)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4: User's External Database (Live Query)                  │
│                                                                  │
│  - Only when forced refresh requested                           │
│  - Or when cache is completely empty                            │
│  - Access time: 100ms - 30s (depends on DB size)                │
│                                                                  │
│  Triggers Cache Rebuild:                                        │
│  - New connection                                               │
│  - Manual refresh                                               │
│  - Cache expiry                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Cache Implementation

```typescript
// src/services/cache.service.ts
import Redis from 'ioredis';
import LRU from 'lru-cache';

// Layer 1: In-memory LRU
const memoryCache = new LRU<string, any>({
  max: 500,           // 500 items
  maxSize: 100 * 1024 * 1024, // 100MB
  sizeCalculation: (value) => JSON.stringify(value).length,
  ttl: 1000 * 60 * 5, // 5 minutes
});

// Layer 2: Redis
const redis = new Redis(process.env.REDIS_URL);

// Cache keys
const CACHE_KEYS = {
  fullSchema: (connId: string) => `schema:${connId}`,
  schemaOnly: (connId: string, schema: string) => `schema:${connId}:${schema}`,
  aiContext: (connId: string) => `ai_context:${connId}`,
  aiContextSchema: (connId: string, schema: string) => `ai_context:${connId}:${schema}`,
  tablePreview: (connId: string, schema: string, table: string) => 
    `table_preview:${connId}:${schema}:${table}`,
  jobProgress: (jobId: string) => `job_progress:${jobId}`,
};

// TTLs in seconds
const CACHE_TTL = {
  fullSchema: 86400,      // 24 hours
  schemaOnly: 86400,      // 24 hours
  aiContext: 3600,        // 1 hour
  tablePreview: 600,      // 10 minutes
  jobProgress: 3600,      // 1 hour
};

export async function getSchema(connectionId: string): Promise<SchemaData | null> {
  const cacheKey = CACHE_KEYS.fullSchema(connectionId);
  
  // Layer 1: Memory
  const memCached = memoryCache.get(cacheKey);
  if (memCached) {
    logger.debug(`[CACHE] Memory hit: ${cacheKey}`);
    return memCached;
  }
  
  // Layer 2: Redis
  const redisCached = await redis.get(cacheKey);
  if (redisCached) {
    logger.debug(`[CACHE] Redis hit: ${cacheKey}`);
    const parsed = JSON.parse(redisCached);
    memoryCache.set(cacheKey, parsed); // Populate memory cache
    return parsed;
  }
  
  // Layer 3: PostgreSQL
  const dbData = await fetchSchemaFromDb(connectionId);
  if (dbData) {
    logger.debug(`[CACHE] DB hit: ${cacheKey}`);
    // Populate both caches
    await redis.setex(cacheKey, CACHE_TTL.fullSchema, JSON.stringify(dbData));
    memoryCache.set(cacheKey, dbData);
    return dbData;
  }
  
  // Layer 4: External DB (trigger sync job)
  logger.info(`[CACHE] Miss all layers, triggering sync: ${connectionId}`);
  return null; // Controller should trigger schema sync
}

// Invalidate cache when schema changes
export async function invalidateSchemaCache(connectionId: string): Promise<void> {
  const patterns = [
    CACHE_KEYS.fullSchema(connectionId),
    `schema:${connectionId}:*`,
    CACHE_KEYS.aiContext(connectionId),
    `ai_context:${connectionId}:*`,
  ];
  
  // Clear memory cache
  for (const [key] of memoryCache.entries()) {
    if (key.includes(connectionId)) {
      memoryCache.delete(key);
    }
  }
  
  // Clear Redis (use SCAN for patterns)
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } else {
      await redis.del(pattern);
    }
  }
  
  logger.info(`[CACHE] Invalidated cache for connection: ${connectionId}`);
}
```

---

## Intelligent DDL Fetching

### Problem
For large databases (100+ tables), sending full DDL to AI is:
1. **Expensive** - More tokens = more cost
2. **Slow** - Larger prompts = slower responses
3. **Noisy** - Irrelevant tables confuse the AI

### Solution: Smart Context Selection

```typescript
// src/services/ai-context.service.ts

interface AIContextOptions {
  connectionId: string;
  userQuery: string;          // The user's natural language query
  selectedSchemas: string[];   // User's selected schemas
  maxTables?: number;          // Max tables to include (default: 20)
  maxTokens?: number;          // Max tokens for context (default: 4000)
}

export async function buildIntelligentContext(options: AIContextOptions): Promise<string> {
  const { connectionId, userQuery, selectedSchemas, maxTables = 20, maxTokens = 4000 } = options;
  
  // 1. Get all tables from selected schemas
  const allTables = await getTablesForSchemas(connectionId, selectedSchemas);
  
  // 2. Score tables by relevance to query
  const scoredTables = await scoreTableRelevance(allTables, userQuery);
  
  // 3. Select top N tables
  const relevantTables = scoredTables
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTables);
  
  // 4. Build compressed DDL
  const ddl = buildCompressedDDL(relevantTables, maxTokens);
  
  return ddl;
}

// Score tables based on relevance to query
async function scoreTableRelevance(
  tables: TableSchema[], 
  userQuery: string
): Promise<Array<TableSchema & { score: number }>> {
  const queryWords = userQuery.toLowerCase().split(/\s+/);
  
  return tables.map(table => {
    let score = 0;
    
    // Table name match (highest weight)
    const tableName = table.table_name.toLowerCase();
    for (const word of queryWords) {
      if (tableName.includes(word)) score += 10;
      if (tableName === word) score += 20;
    }
    
    // Column name match
    for (const col of table.columns) {
      const colName = col.name.toLowerCase();
      for (const word of queryWords) {
        if (colName.includes(word)) score += 5;
        if (colName === word) score += 10;
      }
    }
    
    // Foreign key relationships (include related tables)
    if (table.columns.some(c => c.is_foreign_key)) {
      score += 3; // Slightly boost tables with relationships
    }
    
    // Penalize very large tables slightly (likely fact tables)
    if (table.row_count && table.row_count > 1000000) {
      score -= 2;
    }
    
    return { ...table, score };
  });
}

// Build compressed DDL that fits in token budget
function buildCompressedDDL(tables: TableSchema[], maxTokens: number): string {
  const lines: string[] = [];
  let estimatedTokens = 0;
  
  // Header
  lines.push('-- Database Schema Context');
  lines.push('-- Only relevant tables shown\n');
  
  for (const table of tables) {
    // Estimate tokens for this table
    const tableDDL = formatTableDDL(table);
    const tableTokens = Math.ceil(tableDDL.length / 4); // ~4 chars per token
    
    if (estimatedTokens + tableTokens > maxTokens) {
      lines.push(`\n-- [${tables.length - tables.indexOf(table)} more tables omitted]`);
      break;
    }
    
    lines.push(tableDDL);
    estimatedTokens += tableTokens;
  }
  
  return lines.join('\n');
}

// Format table as compact DDL
function formatTableDDL(table: TableSchema): string {
  const cols = table.columns.map(c => {
    let def = `  ${c.name} ${c.data_type}`;
    if (c.is_primary_key) def += ' PK';
    if (c.is_foreign_key && c.foreign_key_ref) {
      def += ` FK→${c.foreign_key_ref.table}.${c.foreign_key_ref.column}`;
    }
    if (!c.is_nullable) def += ' NOT NULL';
    return def;
  });
  
  return `-- ${table.schema_name}.${table.table_name}` +
    (table.row_count ? ` (~${formatNumber(table.row_count)} rows)` : '') +
    `\nCREATE TABLE ${table.schema_name}.${table.table_name} (\n${cols.join(',\n')}\n);\n`;
}

// Example output:
// -- public.users (~50000 rows)
// CREATE TABLE public.users (
//   id uuid PK NOT NULL,
//   email varchar(255) NOT NULL,
//   name varchar(100),
//   created_at timestamptz NOT NULL
// );
```

### Caching AI Context

```typescript
// Pre-compute AI context after schema sync
export async function cacheAIContext(connectionId: string): Promise<void> {
  const schemas = await getSelectedSchemas(connectionId);
  
  for (const schema of schemas) {
    const tables = await getTables(connectionId, schema.schema_name);
    const context = buildFullSchemaContext(tables);
    
    // Cache per-schema context
    await redis.setex(
      CACHE_KEYS.aiContextSchema(connectionId, schema.schema_name),
      CACHE_TTL.aiContext,
      context
    );
  }
  
  // Cache combined context (all selected schemas)
  const allTables = await getAllSelectedTables(connectionId);
  const fullContext = buildFullSchemaContext(allTables);
  await redis.setex(
    CACHE_KEYS.aiContext(connectionId),
    CACHE_TTL.aiContext,
    fullContext
  );
  
  logger.info(`[AI_CONTEXT] Cached AI context for ${connectionId}`);
}
```

---

## Rate Limiting

### Multi-Tier Rate Limiting

```typescript
// src/middleware/rateLimit.ts
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Tier 1: Global rate limit (DDoS protection)
const globalLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl_global',
  points: 1000,        // 1000 requests
  duration: 60,        // Per minute
  blockDuration: 60,   // Block for 1 minute if exceeded
});

// Tier 2: Per-user AI rate limit
const aiUserLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl_ai_user',
  points: 20,          // 20 AI requests
  duration: 60,        // Per minute
  blockDuration: 30,   // Block for 30 seconds
});

// Tier 3: Per-user heavy operations (schema sync)
const heavyOpLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl_heavy',
  points: 5,           // 5 heavy operations
  duration: 300,       // Per 5 minutes
  blockDuration: 60,
});

// Middleware factory
export function rateLimitMiddleware(type: 'global' | 'ai' | 'heavy') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = type === 'global' 
        ? req.ip 
        : req.userId || req.ip;
      
      const limiter = {
        global: globalLimiter,
        ai: aiUserLimiter,
        heavy: heavyOpLimiter,
      }[type];
      
      await limiter.consume(key);
      next();
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      
      // Rate limit exceeded
      const retryAfter = Math.ceil(error.msBeforeNext / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        success: false,
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
      });
    }
  };
}

// Apply to routes
// router.post('/ai/generate', rateLimitMiddleware('ai'), generateSqlHandler);
// router.post('/connections/:id/sync-schema', rateLimitMiddleware('heavy'), syncSchemaHandler);
```

### Rate Limits by Tier

| Operation | Free Tier | Pro Tier | Enterprise |
|-----------|-----------|----------|------------|
| AI Generate SQL | 20/min | 60/min | 200/min |
| AI Explain Query | 20/min | 60/min | 200/min |
| Schema Sync | 5/5min | 20/5min | Unlimited |
| Query Execution | 100/min | 500/min | Unlimited |

---

## UI/UX for Loading States

### Frontend Architecture

```typescript
// src/hooks/useJobProgress.ts
import { useEffect, useState } from 'react';

interface JobProgress {
  jobId: string;
  type: 'schema-sync' | 'ai-operation';
  progress: number;
  message: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export function useJobProgress(userId: string) {
  const [jobs, setJobs] = useState<Map<string, JobProgress>>(new Map());
  
  useEffect(() => {
    // Connect to Server-Sent Events endpoint
    const eventSource = new EventSource(`/api/jobs/progress?userId=${userId}`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      setJobs(prev => {
        const next = new Map(prev);
        next.set(data.jobId, data);
        return next;
      });
    };
    
    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data);
      setJobs(prev => {
        const next = new Map(prev);
        next.set(data.jobId, { ...next.get(data.jobId), status: 'completed' });
        return next;
      });
    });
    
    eventSource.addEventListener('error', (event) => {
      const data = JSON.parse(event.data);
      setJobs(prev => {
        const next = new Map(prev);
        next.set(data.jobId, { ...next.get(data.jobId), status: 'failed' });
        return next;
      });
    });
    
    return () => eventSource.close();
  }, [userId]);
  
  return jobs;
}
```

### UI Components

```tsx
// Schema Sync Progress
function SchemaSyncProgress({ connectionId }: { connectionId: string }) {
  const { user } = useAuth();
  const jobs = useJobProgress(user.id);
  
  const syncJob = Array.from(jobs.values()).find(
    j => j.type === 'schema-sync' && j.connectionId === connectionId
  );
  
  if (!syncJob) return null;
  
  return (
    <div className="schema-sync-progress">
      {syncJob.status === 'processing' && (
        <>
          <Spinner size="sm" />
          <Progress value={syncJob.progress} />
          <span>{syncJob.message}</span>
        </>
      )}
      {syncJob.status === 'completed' && (
        <Badge variant="success">Schema synced!</Badge>
      )}
      {syncJob.status === 'failed' && (
        <Badge variant="destructive">Sync failed</Badge>
      )}
    </div>
  );
}

// Sidebar with loading states
function DatabaseSidebar({ connectionId }: { connectionId: string }) {
  const { data: schemas, isLoading, error } = useSchemas(connectionId);
  const jobs = useJobProgress(useAuth().user.id);
  
  const isSyncing = Array.from(jobs.values()).some(
    j => j.type === 'schema-sync' && j.status === 'processing'
  );
  
  if (isLoading || isSyncing) {
    return (
      <div className="sidebar-loading">
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-3/4 mb-2" />
        <Skeleton className="h-4 w-1/2" />
        {isSyncing && <SchemaSyncProgress connectionId={connectionId} />}
      </div>
    );
  }
  
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load schema</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
        <Button onClick={handleRetry}>Retry</Button>
      </Alert>
    );
  }
  
  return (
    <div className="sidebar">
      {schemas.map(schema => (
        <SchemaTree key={schema.id} schema={schema} />
      ))}
    </div>
  );
}
```

### Backend SSE Endpoint

```typescript
// src/routes/jobs.routes.ts
router.get('/progress', authenticate, async (req, res) => {
  const userId = req.userId;
  
  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  // Subscribe to Redis channels
  const subscriber = redis.duplicate();
  
  await subscriber.subscribe(
    `job:progress:${userId}`,
    `job:complete:${userId}`,
    `job:error:${userId}`
  );
  
  subscriber.on('message', (channel, message) => {
    if (channel.includes('progress')) {
      res.write(`data: ${message}\n\n`);
    } else if (channel.includes('complete')) {
      res.write(`event: complete\ndata: ${message}\n\n`);
    } else if (channel.includes('error')) {
      res.write(`event: error\ndata: ${message}\n\n`);
    }
  });
  
  // Keep-alive ping every 30 seconds
  const keepAlive = setInterval(() => {
    res.write(':ping\n\n');
  }, 30000);
  
  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(keepAlive);
    subscriber.unsubscribe();
    subscriber.disconnect();
  });
});
```

---

## Implementation Plan

### Phase 1: Infrastructure (Week 1)
- [ ] Install BullMQ, ioredis dependencies
- [ ] Set up Redis connection config
- [ ] Create base queue classes
- [ ] Set up Bull Board admin dashboard
- [ ] Implement rate limiting middleware

### Phase 2: Schema Sync Queue (Week 1-2)
- [ ] Create schema-sync queue
- [ ] Implement sync-full-schema job processor
- [ ] Implement sync-single-schema job processor
- [ ] Add progress tracking and Pub/Sub
- [ ] Implement SSE endpoint for progress
- [ ] Create frontend progress components

### Phase 3: Caching Layer (Week 2)
- [ ] Implement multi-layer cache service
- [ ] Add cache invalidation logic
- [ ] Implement AI context caching
- [ ] Add cache warming after schema sync
- [ ] Add cache metrics/monitoring

### Phase 4: AI Operations Queue (Week 2-3)
- [ ] Create ai-operations queue
- [ ] Implement generate-sql job processor
- [ ] Implement intelligent DDL selection
- [ ] Implement explain-query processor
- [ ] Add streaming responses for AI (optional)
- [ ] Add priority queue support

### Phase 5: Polish & Monitoring (Week 3)
- [ ] Add comprehensive error handling
- [ ] Implement dead letter queue
- [ ] Add queue metrics (Prometheus)
- [ ] Add alerting for queue backlogs
- [ ] Load testing and optimization

---

## File Structure

```
src/
├── config/
│   ├── redis.ts          # Redis connection
│   └── queue.ts          # Queue configuration
├── queues/
│   ├── index.ts          # Export all queues
│   ├── schema-sync.queue.ts
│   ├── schema-sync.worker.ts
│   ├── ai-operations.queue.ts
│   └── ai-operations.worker.ts
├── services/
│   ├── cache.service.ts  # Multi-layer cache
│   ├── ai-context.service.ts
│   └── schema-sync.service.ts
├── middleware/
│   └── rateLimit.ts
└── routes/
    └── jobs.routes.ts    # SSE progress endpoint
```

---

## Summary

| Component | Technology | Purpose |
|-----------|------------|---------|
| Queue System | Redis + BullMQ | Background job processing |
| Cache L1 | LRU (in-memory) | Ultra-fast hot data |
| Cache L2 | Redis | Shared persistent cache |
| Cache L3 | PostgreSQL | Source of truth |
| Real-time Updates | Redis Pub/Sub + SSE | Live progress to UI |
| Rate Limiting | rate-limiter-flexible | Protect API from abuse |
| Admin Dashboard | Bull Board | Monitor queue health |

This architecture ensures:
- ✅ Non-blocking schema sync (users can continue using app)
- ✅ Real-time progress feedback
- ✅ Efficient caching (no repeated DB hits)
- ✅ Smart AI context (only relevant tables)
- ✅ Protection from abuse (rate limiting)
- ✅ Scalability (workers can be scaled independently)

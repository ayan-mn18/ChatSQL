# ChatSQL — Backend System Design (as-built)

> Code-first analysis of the `ChatSQL` backend repo (`ayan-mn18/ChatSQL`). Everything below is derived from reading the source, not the marketing docs. Where the repo's own docs (`ARCHITECTURE.md`, `README.md`, `plan.md`) disagree with the code, the code wins and the discrepancy is flagged.
>
> For the architecture audit, performance gaps, target backend design, and migration plan, see [`BACKEND_ARCHITECTURE_REDESIGN.md`](./BACKEND_ARCHITECTURE_REDESIGN.md).
>
> For the approved greenfield rewrite direction, managed-service decisions, complete plane design, repositories, capacity, logging, deployment, and cutover plan, see [`BACKEND_PLATFORM_MASTER_PLAN.md`](./BACKEND_PLATFORM_MASTER_PLAN.md).

---

## 1. What this backend actually is

A single **Node.js + Express + TypeScript** monolith that lets a signed-in user:

1. Register / verify email / log in (JWT in an HTTP-only cookie).
2. Save encrypted **connections** to their *own* external PostgreSQL databases.
3. Have the server **introspect** those databases (schemas → tables → columns → indexes → foreign keys) and cache the metadata.
4. Browse/edit table data, run raw SQL, and view live DB analytics — all executed against the *user's* database through a background job queue.
5. Talk to their database in natural language via an **AI chat** (streaming) and an **agent mode** (plan → approve → execute → self-heal).
6. Invite **viewers** with fine-grained, time-limited, per-table permissions (a lightweight RBAC/data-sharing layer).
7. Pay for **plans** (Dodo Payments) that raise usage limits; when a free user runs out, they drop to read-only.

The app stores its own state in a dedicated PostgreSQL database ("app DB"), uses **Redis** for caching + queues + pub/sub, and calls out to **three LLM providers** (Gemini, Anthropic, OpenAI) behind a tiered abstraction.

Important framing: **ChatSQL never runs user SQL inside its own app DB.** For every data operation it opens a *fresh, short-lived Sequelize connection to the user's database*, runs the query there, and closes it. The app DB only holds ChatSQL's own tables.

### Reality vs. the repo's own docs
- `ARCHITECTURE.md` describes Sequelize models, dashboards/widgets, ERD endpoints, `/api/query`, `/api/schema`, `/api/data` route groups. **None of that layout is real.** There are no Sequelize models (raw SQL everywhere via `sequelize.query`), no dashboards/widgets tables or endpoints, and routing is consolidated under `/api/connections`, `/api/ai`, `/api/chat`, etc.
- `README.md` roadmap marks connection management / AI / SQL execution as "not done". In fact all of those are implemented; the README is stale.
- `plan.md` proposes tables (`DataExplorerStates`, `Dashboards`, `DashboardWidgets`, `AIQueryLogs`) that were never created. The real schema uses `ai_token_usage`, `chat_sessions/chat_messages`, `queries`, `saved_queries`, and the viewer/billing tables.

---

## 2. Tech stack (from `package.json`)

| Concern | Choice |
|---|---|
| Runtime / lang | Node ≥18 (CI builds on Node 22), TypeScript 5.7, `ts-node-dev` in dev |
| HTTP | Express 4.21, `morgan` logging, `cookie-parser`, `cors` |
| App DB driver | `pg` 8 + `sequelize` 6 (used as a **raw query runner**, not an ORM) |
| Cache / queue / pubsub | `ioredis` 5, `bullmq` 5, `@bull-board/express` (queue dashboard) |
| Rate limiting | `rate-limiter-flexible` (Redis-backed, memory fallback) |
| Auth | `jsonwebtoken` 9, `bcrypt` 6 |
| Validation | `zod` 3 |
| Crypto | Node `crypto` (AES-256-GCM) for connection passwords |
| LLM SDKs | `@google/generative-ai`, `@anthropic-ai/sdk`, `openai`, plus Vercel `ai` + `@ai-sdk/openai` (largely unused) |
| Payments | `dodopayments` 2, `standardwebhooks` (imported but signature check is disabled) |
| Email | `nodemailer` 7 (SMTP) |
| Logging | `@logtail/node` (BetterStack) + console |
| Entry | `server.ts` (no `src/app.ts` split) |

Scripts: `dev` = `ts-node-dev --respawn --transpile-only server.ts`; `build` = `tsc`; `start` = `node dist/server.js`.

---

## 3. High-level architecture

```
                         ┌──────────────────────────────────────────────┐
                         │  Frontend (Vercel)  https://sql.bizer.dev     │
                         └───────────────┬──────────────────────────────┘
                                         │ HTTPS (cookie JWT) + SSE
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Express monolith  (EC2, PM2, api.sql.bizer.dev)           │
│                                                                               │
│  global rate limit ─► CORS ─► JSON/cookies ─► routers                         │
│                                                                               │
│  Controllers ──► Services ──► (produce jobs) ──► BullMQ queues                │
│      │                                              │                          │
│      │ verifyAccess (owner vs viewer perms)         │ workers consume          │
│      ▼                                              ▼                          │
│  App DB (raw SQL via Sequelize)             ┌──────────────────────┐          │
│                                             │ schema-sync worker    │          │
│  ┌───────────────┐   pub/sub + cache        │ db-operations worker  │──┐       │
│  │    Redis      │◄────────────────────────►│ ai-operations worker  │  │ open  │
│  │ cache/queues  │                          │ access-mgmt worker    │  │ short │
│  └───────────────┘                          └──────────────────────┘  │ lived │
│                                                                        │ conn  │
│  LLM factory ─► Gemini / Anthropic / OpenAI (tiered)                   │       │
└────────────────────────────────────────────────────────────────────┼───────┘
                                                                        ▼
                              ┌──────────────────────────────────────────────┐
                              │  USER's external Postgres DBs (many)          │
                              └──────────────────────────────────────────────┘
                              ┌──────────────────────────────────────────────┐
                              │  Dodo Payments  •  SMTP  •  BetterStack logs  │
                              └──────────────────────────────────────────────┘
```

### Process bootstrap (`server.ts`)
1. `dotenv` → build Express app.
2. Middleware order: `morgan` (skips `/admin/queues`) → `express.json()` → `cookieParser` → CORS → **global rate limit**.
3. Mounts routers (see §16), then `notFoundHandler`, then `errorHandler`.
4. `app.listen` callback: `connectDatabase()` (app DB), `checkRedisHealth()`. **Only if Redis is healthy** does it start the 4 BullMQ workers and the periodic viewer-cleanup job. If Redis is down, the server still serves HTTP but schema sync, AI jobs, and DB-operation jobs silently don't work.
5. Graceful shutdown on SIGTERM/SIGINT closes workers + Redis + flushes logs. `unhandledRejection`/`uncaughtException` are logged to BetterStack.

Legacy top-level routes still live directly in `server.ts` (`POST /api/getResult`, `/api/getTables`, `/api/getTableData`, `/api/testConnection`) — these are the *original v1* endpoints (URI-in-body, no auth) that the current authenticated system superseded. They're dead weight / a security smell (see §17).

---

## 4. Application database schema

App DB is PostgreSQL, created by `database/migration-v0/schema.sql` then `database/migration-v1/payments.sql`. UUID PKs, `updated_at` auto-touch triggers, and several **PL/pgSQL helper functions** that carry real business logic.

### Tables (18)

**Identity & auth**
- `users` — email, `password_hash`, username, `profile_url`, `is_verified`, `is_active`, `role` (`super_admin` | `viewer`), `created_by_user_id` (self-FK: which admin created this viewer), `expires_at`, `is_temporary`, `must_change_password`, `last_login_at`. Default role is `super_admin` (i.e., a normal signup is an "admin" who can own connections and invite viewers).
- `email_verifications` — OTP code + `otp_hash`, `expires_at`, `attempts`/`max_attempts` (3).
- `password_resets` — `token_hash`, `expires_at`, `is_used`.

**Connections & introspected metadata**
- `connections` — the user's external DB creds: host, port, `type` (default `postgres`), `db_name`, username, **`password_enc`** (AES-256-GCM), `ssl`, `extra_options` JSONB, `is_valid`, `schema_synced`, `schema_synced_at`, `last_tested_at`. Unique per `(user_id, name)`.
- `database_schemas` — one row per Postgres schema found in a connection (`public`, etc.), with `is_selected`, `table_count`.
- `table_schemas` — cached per-table metadata: `columns` JSONB, `primary_key_columns` JSONB, `indexes` JSONB, `row_count`, `table_size_bytes`. Unique per `(connection_id, schema_name, table_name)`.
- `erd_relations` — foreign-key edges (source/target schema+table+column, constraint name) for ERD.

**Query surface**
- `queries` — execution history (both manual and AI). Stores `query_text`, truncated `raw_result` JSONB, `row_count`, `execution_time_ms`, `status`, `is_ai_generated`, `ai_prompt`, `tables_used`, `query_type`, and FKs to `saved_queries` / `chat_messages`.
- `saved_queries` — named/reusable queries with tags (GIN index), folder, `use_count`, `last_used_at`, `is_shared`.

**AI chat**
- `chat_sessions` — per `(user, connection)` chat, `title`, `is_active`, `message_count`, `last_message_at`.
- `chat_messages` — role, content, `sql_generated`, `reasoning` JSONB, `tables_used` JSONB, `execution_result` JSONB, `is_error`.

**RBAC / viewer sharing**
- `viewer_permissions` — the heart of RBAC. Per `(viewer, connection, schema_name?, table_name?)` with booleans `can_select/insert/update/delete/use_ai/view_analytics/export`. `NULL` schema/table means "applies to all"; a partial unique index uses `COALESCE(…, '__ALL__')` to enforce uniqueness across that hierarchy.
- `viewer_invitations` — pending invites (email, `temp_password_hash`, `permission_config` JSONB, `status`, `expires_at`).
- `viewer_activity_log` — audit trail (action_type, details JSONB, IP, UA).
- `viewer_access_requests` — viewer-initiated requests for more time / more permissions; admin approves/denies.

**Billing & usage**
- `user_plans` — the live entitlement row per user: `plan_type`, `ai_tokens_limit`/`ai_tokens_used`, `queries_limit`/`queries_used`, `connections_limit`, `storage_limit_mb`, billing cycle window, `dodo_customer_id`/`dodo_subscription_id`, `is_lifetime`, `read_only_mode`. A trigger auto-creates a `free` plan row whenever a user is inserted.
- `plan_configurations` — catalog of tiers (free, pro_monthly, pro_yearly, lifetime, enterprise) with prices, limits, and `features` JSONB. `-1` means unlimited.
- `subscriptions` — Dodo subscription/one-time records; partial unique index enforces one `active` subscription per user.
- `payments` — transaction history (`dodo_payment_id`, amount, status, refunds, receipt URL).
- `ai_token_usage` — granular per-call token ledger (operation_type, model, input/output/total tokens, previews, exec time).
- `email_logs` — every email send attempt (type, status, SMTP message id, retries).
- `contact_requests` — contact/enterprise form submissions.

### Business logic living in the DB (PL/pgSQL)
- `create_default_user_plan()` (trigger on `users` insert) — grants free plan.
- `check_user_read_only(user_id)` — returns TRUE when a **free** user has hit token *or* query limit (lifetime/pro/enterprise never read-only). This is the single source of truth for read-only mode, called from middleware.
- `get_user_usage_dashboard(user_id)` — assembles the usage dashboard (limits, used, remaining, connections used, days remaining).
- `get_user_subscription_status(user_id)`, `upgrade_user_plan(...)`, `downgrade_user_to_free(...)`, `reset_monthly_usage()` — billing lifecycle. `reset_monthly_usage` is intended for a cron job but **nothing in the app schedules it** (see gaps).
- `check_viewer_permission(...)`, `get_viewer_connections(...)`, `get_viewer_schemas(...)` — permission helpers (though most permission checks are actually done in TS, not via these functions).

---

## 5. Authentication & session model

- **Signup (`POST /api/auth/register`)**: zod-validated (password needs upper/lower/digit, ≥8). Creates an *unverified* user, generates a 6-digit OTP, stores its bcrypt hash in `email_verifications` (10-min expiry, prior OTPs invalidated), emails it. If the email already exists but is unverified, it updates the password and resends. Register/verify/resend/login/forgot all sit behind the `auth` rate limiter (20/min, 5-min block).
- **Verify (`/verify-email`)**: checks latest unused OTP, enforces expiry + max 3 attempts, bcrypt-compares, marks `is_verified`. Sets the JWT cookie on success.
- **Login (`/login`)**: `validateCredentials` rejects if not active, **not verified**, or bad password; issues JWT.
- **JWT**: `generateAccessToken` signs `{ userId, email }` with `JWT_SECRET`, **hardcoded `expiresIn: '24h'`** (the `JWT_EXPIRES_IN`/`REFRESH_TOKEN_EXPIRES_IN` env vars are dead — refresh tokens were deliberately removed; `storeRefreshToken`/`revokeAllRefreshTokens` now throw). Cookie name `chatsql-access-token`, `httpOnly`, `secure` in prod, `sameSite: lax`, 24h.
- **`authenticate` middleware**: reads token from cookie → `Authorization: Bearer` → `?token=` query param (the last is specifically to support **SSE** connections, which can't set headers). Verifies JWT, then does a DB lookup to load `role` + `is_active` and attaches `req.userId` / `req.userRole`. Distinguishes `TokenExpiredError` vs `JsonWebTokenError`.
- **`optionalAuth`**: attaches userId if a token is present, never blocks.
- **Password reset**: random 32-byte token, bcrypt-hashed, 1h expiry; verify iterates unused/non-expired rows and bcrypt-compares (no plaintext token stored).
- **Viewers** get created with `must_change_password` and (optionally) `is_temporary` + `expires_at`; there's a `ForceChangePasswordPage` on the frontend to match.

---

## 6. Connection management & credential handling

- **Create (`POST /api/connections`)**: zod-validate → dedupe by name → **test-connect first (fail fast)** with a temporary 1-connection Sequelize pool → on success `encrypt(password)` → insert row → **enqueue a full schema-sync job** → invalidate the user's connections-list cache → return the connection (never the password). `mapPgError` translates Postgres/socket error codes (`28P01`, `3D000`, `ECONNREFUSED`, `ETIMEDOUT`, SSL errors, etc.) into friendly messages.
- **Encryption (`utils/encryption.ts`)**: AES-256-GCM. Key comes from `ENCRYPTION_KEY` (64-hex → raw 32 bytes, else PBKDF2-derived). Ciphertext blob = `iv(16) ‖ authTag(16) ‖ ciphertext`, base64. Passwords are decrypted *only* at the moment of opening a connection to the user's DB, inside workers/services.
- **Every access to a user DB** builds a fresh Sequelize instance (small pool, `ssl.rejectUnauthorized:false`, 30s acquire) and closes it in `finally`. Helpers named `createUserDBConnection` / `createUserDbConnection` are duplicated across `ai.service`, `schema-context.service`, `db-operations.queue`, `schema-sync.queue`, and `connection.controller`.
- The **`connection.controller.ts` is the god-file** (3,115 lines): connection CRUD, schema/table-tree/relations endpoints, table data CRUD, raw query execution, per-connection analytics, workspace analytics, extension enablement, schema-metadata for autocomplete. Most of these delegate the *actual* DB work to the db-operations queue and just handle access control + caching.

---

## 7. Schema-sync pipeline (`schema-sync` queue)

Triggered on connection create and via `POST /api/connections/:id/sync-schema` (heavy rate limit). Worker concurrency 2, 3 attempts w/ exponential backoff.

`processFullSchemaSync`:
1. Decrypt creds, connect to user DB.
2. `fetchSchemas` → list non-system schemas.
3. For each schema: upsert into `database_schemas`; `fetchTablesForSchema`; for each table `fetchColumnsForTable` + `fetchIndexesForTable`, derive PK columns, upsert into `table_schemas` (columns/indexes as JSONB). `fetchRelationsForSchema` → upsert `erd_relations`.
4. Publishes progress to Redis pub/sub channel `job:progress:{userId}` after each schema (so the SSE endpoint can stream a progress bar).
5. Marks `connections.schema_synced = true`.
6. **`warmSchemaCache`** pre-populates Redis with: schema list, per-schema full table data, a lightweight `table-tree` (schema→table names, for the sidebar), and ERD relations — then invalidates viewer caches and the connections-list cache.

So after a sync, most read endpoints are cache hits. Reads fall back to the app DB's `table_schemas`/`erd_relations` (not the user DB) when cache misses.

---

## 8. The AI subsystem (the interesting part)

There are effectively **two generations** of AI code and **two runtime modes**, all sharing a provider abstraction.

### 8.1 Provider abstraction (`src/service/llm/`)
- Common `ILLMProvider` interface: `complete()`, `stream()`, `isAvailable()`. Implementations for OpenAI, Gemini, Anthropic.
- **Tiers**: `fast` / `balanced` / `powerful`. `MODEL_CONFIG` maps each provider+tier to a model (e.g. Anthropic `claude-haiku-4-5` / `claude-sonnet-4-5`, Gemini `gemini-2.0-flash` / `1.5-pro`, OpenAI `gpt-4o-mini` / `gpt-4o`).
- **Tier→provider preference** (`TIER_PROVIDER_PREFERENCE`): `fast` prefers Gemini (cheap), `balanced`/`powerful` prefer Anthropic (best SQL). `getModelForTier` resolves to the first *available* provider (availability = API key present). Providers self-register lazily on first use.
- Convenience fns: `complete`, `stream`, `quickComplete`, `getBestProvider`, `getAvailableProviders`.

### 8.2 Streaming chat (current gen — `POST /api/chat/:connectionId/stream`, SSE)
Path: `streaming-chat.controller` → `streaming-chat.service.streamChatResponse`.
1. Validate message + `verifyAccess` (owner owns connection, or viewer has `can_use_ai`).
2. Get/create `chat_session`, persist the user message.
3. Load last 10 messages + `getSchemaContextString(connectionId, selectedSchemas)` (schema summary, cached 1h in Redis).
4. **Intent classification** (`intent-classifier`): if the message *looks* SQL-related or there's prior conversation, call the **fast** model to classify into `sql_generation | sql_explanation | clarification | follow_up | general_chat | off_topic` (JSON out, temp 0.1). Has an explicit rule that pasted SQL errors are `follow_up`, plus a keyword-based fallback if the LLM call fails.
5. **Route by intent**:
   - `sql_generation` / `follow_up` → `streamSqlGeneration` (balanced tier, Anthropic-preferred) with a strict "query first, talk later" system prompt. Streams tokens to the client as `data:{type:'content'}` SSE frames; on complete, regex-extracts the ```sql block and a heuristic `tablesUsed`.
   - `sql_explanation` → balanced tier explanation.
   - `clarification` / `general_chat` / `off_topic` → fast tier, short answers.
6. Persist the assistant message, **log token usage** (`ai_token_usage` + increment `user_plans.ai_tokens_used`), send a final `data:{type:'done', messageId, sql, tablesUsed, model, provider}`.

Key point: **the chat pipeline generates SQL but does NOT execute it.** Execution happens when the frontend calls `POST /api/connections/:id/query` with the generated SQL (optionally linking `chatMessageId`). That call runs through the db-operations queue (§9).

### 8.3 Agent mode (`POST /api/chat/:connectionId/agent/*`, SSE + REST)
A human-in-the-loop, multi-step agent living **in server memory** (`Map`s of sessions, pending approvals, pending executions, SSE handles). Loop in `agent.service.runAgentLoop`:
1. **Plan** (powerful tier, temp 0.2): break request into 1–3 SQL steps → emit `agent_plan`.
2. For each step: emit `agent_proposal` (the SQL) → **block on user approval** (`waitForApproval` resolves when `POST …/agent/:id/approve|reject` is called; the user may edit the SQL).
3. On approval: emit `agent_executing` → **block until the frontend runs the query and POSTs the result back** (`…/agent/:id/result`). (The agent itself doesn't touch the DB — the frontend executes via the normal query endpoint and reports back.)
4. On success: `analyzeResults` (fast tier) → emit a short summary. On failure: **error-recovery loop** (powerful tier) regenerates a fixed query and re-proposes, up to `maxRetries = 3`.
5. Emit `agent_complete`. Sessions clean up 60s after finishing; a stopped session rejects pending waits.

This is a genuinely thoughtful design: the SSE stream carries agent events, REST endpoints carry user decisions, and JS promises are the pause points. The tradeoff: **in-memory sessions don't survive a restart and don't scale past one process** (see gaps).

### 8.4 Legacy / queue-based AI (`ai-operations` queue + `ai.service.ts`)
- `POST /api/ai/:connectionId/generate` enqueues a `generate-sql` job (max 5 pending per user), returns `202 + jobId`; the client polls `GET /api/ai/result/:jobId` or subscribes via SSE (`/api/ai/stream/:jobId`, or the shared `/api/jobs/progress`).
- The worker calls `ai.service.generateSqlFromPrompt`, which is a **Gemini-only, more elaborate** pipeline: build full DB metadata (cached 1h) → ask Gemini to **extract only the relevant subset** of schema → pull recent + AI query history → build a big JSON-output prompt (`ai.prompts.ts`) → call Gemini with multi-turn history → parse JSON `{query, reasoning, tables_used, columns_used, desc}` → save to history + log tokens.
- `explain-query` is implemented; `optimize-query` and `suggest-indexes` are **stubs** that return "not implemented yet".

So there are two SQL-generation implementations: the newer streaming one (`sql-generator.service`, provider-tiered) and the older queue one (`ai.service`, Gemini-only). The frontend's chat uses the streaming one; the `/api/ai/generate` route uses the queue one.

There's also fully-dead older code: `src/service/openai.ts` (`getQuery`, used only by the legacy `server.ts` `/api/getResult`), `src/service/anthropic.ts`, `generateDbMetaData.ts` (uses string-interpolated schema/table names — SQL-injectable, but only reachable via the dead legacy routes).

---

## 9. Query execution pipeline (`db-operations` queue)

All actual work against the user's DB goes through this queue (concurrency 10, 100 jobs/min limiter). Producers add a job; the controller calls `waitForJobResult(job, timeoutMs)` which **polls the job state every 100ms** until completed/failed/timeout (30s default, 60s for raw SQL). Job types + processors:

- `SELECT_QUERY` — paginated table read. Builds `WHERE` from a typed filter list (`eq/neq/gt/like/ilike/in/is_null/…`, `LIKE`/`ILIKE` cast column to TEXT), `ORDER BY`, `LIMIT/OFFSET`, plus a `COUNT(*)`. **Identifiers are sanitized** via `sanitizeIdentifier` (regex `^[A-Za-z_][A-Za-z0-9_]*$` then double-quoted); values are parameterized.
- `INSERT_ROW` / `UPDATE_ROW` / `DELETE_ROW` — parameterized mutations with identifier sanitization; bust the table's data cache after.
- `EXECUTE_RAW_SQL` — the raw SQL runner (`POST /api/connections/:id/query`). Detects query type; if `readOnly` it strips comments and rejects anything not starting with `SELECT`/`WITH` **and** blocks dangerous keywords (`DROP/DELETE/TRUNCATE/UPDATE/INSERT/ALTER/CREATE/GRANT/REVOKE`) via word-boundary regex. Executes with the right Sequelize `QueryType`, normalizes results per type (rows / affectedRows / RETURNING), extracts rich Postgres error detail (code, hint, position → line/column + a `⚠️` excerpt), and logs to `viewer_activity_log`.
- `GET_ANALYTICS` — pulls `pg_database_size`, active connections, cache-hit ratio, `pg_stat_user_tables` (hot/cold, read/write), and `pg_stat_statements` if the extension is installed+loaded (handles PG≥13 column renames).
- `ENABLE_EXTENSION` — `CREATE EXTENSION IF NOT EXISTS "<name>"` (e.g. to turn on `pg_stat_statements`).

**Access control on raw execution**: owners run with `readOnly` taken from the request body (frontend sends `false` for non-SELECT); viewers are checked per query type via `checkViewerQueryPermission` and forced read-only for SELECT. Every executed query (success or failure) is written to the `queries` history table, analytics cache is busted, and if it came from a chat message the result is stitched back onto that message.

The whole "run it as a job and poll for the result" design means even synchronous-feeling API calls are actually queue round-trips — this gives per-connection rate limiting and isolation, at the cost of latency and Redis being a hard dependency.

---

## 10. Caching (`utils/cache.ts`, Redis)

- Generic `getFromCache`/`setCache` wrap values as `{data, cachedAt}` JSON with an EX TTL.
- Namespaced key builders under `connection:{id}:…`, `user:{id}:…`, `viewer:{id}:…`, `ai_context:…`, `schema_context:…`.
- TTLs: schema/tables/columns/ERD 30 min; connection details 10 min; connections list 5 min; **table data 60 s**; analytics 60 s; viewer permissions 5 min; AI schema context 1 h.
- Invalidation is **SCAN-based** (not `KEYS`) for connection/viewer wipes; single-key deletes elsewhere. Schema sync warms the cache; mutations bust the relevant table-data keys; query execution busts analytics.
- Detailed rationale lives in `docs/QUEUE_AND_CACHE_ARCHITECTURE.md` (1,100+ lines).

---

## 11. Queues & workers summary (BullMQ)

| Queue | Concurrency | Rate limit | Jobs | Result delivery |
|---|---|---|---|---|
| `schema-sync` | 2 | 10/min | full/single-schema/single-table/refresh | Redis pub/sub progress → SSE |
| `ai-operations` | 5 | 30/min | generate-sql, explain-query, (optimize/suggest = stubs) | `ai_result:{jobId}` cache (5-min) + pub/sub `ai:result:{userId}`; polled or streamed |
| `db-operations` | 10 | 100/min | select/insert/update/delete/raw-sql/analytics/enable-extension | `waitForJobResult` 100ms polling |
| `access-management` | 2 | — | cleanup-expired-viewers (**repeat every 5 min**), scheduled per-viewer expiry (delayed job) | direct |

Shared config in `config/queue.ts` (attempts, backoff, `removeOnComplete/Fail` retention, priorities). **Bull Board** UI at `/admin/queues` — protected only by an `x-admin-secret` header **and only in production**; in development it's wide open.

---

## 12. Rate limiting & plan enforcement

Two independent layers:

**Transport rate limiting** (`middleware/rateLimit.ts`, `rate-limiter-flexible`, Redis with in-memory fallback): tiers `global` 2000/min/IP, `auth` 20/min, `ai` 1000/min, `heavy` 20 per 5 min, `connection` 20/min. Keyed by userId when available else IP. Emits `X-RateLimit-*` headers and `429 + Retry-After`. Only `global` is applied app-wide; the others are attached per-route (auth routes, `heavyRateLimit` on schema-sync/AI/chat-stream/raw-query, `connectionRateLimit` on test/create).

**Plan/entitlement enforcement** (`middleware/planLimits.ts`, reads `user_plans` + `check_user_read_only`): `attachPlanInfo` (non-blocking), `enforceReadOnly` (blocks writes for exhausted free users → 403 `READ_ONLY_MODE`), `checkAITokenLimit`, `checkQueryLimit`, `checkConnectionLimit`, `enforceSelectOnly`. **These are defined but only lightly wired** — e.g. AI token limits are primarily enforced implicitly via usage logging + the free-tier read-only function rather than by hanging `checkAITokenLimit` on the AI routes. This is an area where intent (middleware exists) outruns wiring (routes don't all use it).

---

## 13. Payments & billing (Dodo Payments)

- `payment.service.ts`: `createCheckoutSession` maps plan → product id (`DODO_PRODUCT_ID_PRO_MONTHLY/YEARLY/LIFETIME`), creates a Dodo checkout session with return URL + metadata `{user_id, plan_type}`. `getOrCreateCustomer`, `getUserSubscription`, `cancelSubscription` (Dodo update to `cancelled`, sets `cancel_at_period_end`), `getPaymentHistory`.
- Webhook (`POST /api/payments/webhook`, no auth): handles `payment.succeeded` (→ `handlePaymentSucceeded` → `upgrade_user_plan` DB fn, records payment/subscription), `payment.failed` (→ record + `sendPaymentFailedEmail`), `subscription.cancelled/renewed/on_hold/active`. Tolerates both `event.type = 'x.y'` and `'x_y'` naming and both `event.data`/flat shapes. **Always returns 200** to avoid retries.
- Plan catalog (from `payments.sql`): Free ($0, 10k tokens, 500 queries, 2 conns), Pro Monthly ($10), Pro Yearly ($96/yr), Lifetime ($100 one-time, 50 conns, unlimited tokens/queries), Enterprise (contact us, everything unlimited). Free users who exhaust limits become read-only; paid/lifetime/enterprise never do.
- **Security gap: webhook signature verification is explicitly disabled** ("signature verification skipped"), despite `standardwebhooks` + `DODO_WEBHOOK_SECRET` being available. Anyone who can POST to the webhook can, in principle, upgrade a plan by forging a `payment.succeeded` with a known `user_id`. Flagged in §17.

---

## 14. Viewer / RBAC data-sharing system

This is a surprisingly large subsystem (`viewer.service.ts` 1,145 lines, `viewer.controller.ts` 1,024 lines).

- An admin (default role `super_admin`) creates **viewers** — real `users` rows with `role='viewer'`, a generated temp password, optional `is_temporary` + `expires_at`, `must_change_password`. Creation is transactional: insert user + N `viewer_permissions` rows (per connection/schema/table with the CRUD/AI/analytics/export booleans).
- `upsertViewerByEmail` / `checkViewerIdentity` let an admin either create a new viewer or *add access* to an existing one by email.
- Permission checks resolve **most-specific-first** (table-level beats schema-level beats connection-level), cached 5 min. `getViewerAllowedSchemas`/`getViewerAllowedTables` return `null` to mean "all".
- Viewers can file **access requests** (more hours / more perms); admins approve/deny (`decideAccessRequest`).
- Expiry: on create, a **delayed BullMQ job** is scheduled for the exact expiry; separately a **repeatable cleanup job every 5 min** deactivates any expired viewers (`deactivateExpiredViewers`). Extending expiry cancels/reschedules.
- Invite + credential emails go through `email.service` and are logged to `email_logs` + `viewer_activity_log`.
- Admin endpoints: list/get viewers, activity, query history, revoke (soft), delete (hard), extend, update permissions, resend invite. Viewer self endpoints: `/me/role`, `/me`, `/me/access-requests`.

**Bug found:** in `connection.controller.checkViewerQueryPermission`, the SQL selects `can_read, can_create, can_update, can_delete` from `viewer_permissions`, but the table's columns are `can_select, can_insert, can_update, can_delete`. `can_read`/`can_create` **don't exist**, so this query throws for any viewer running a raw SQL query via `/api/connections/:id/query`. (The parallel `checkViewerTablePermission` uses the correct column names.) Flagged in §17.

---

## 15. Observability, config, deployment

- **Logging**: custom `logger` writes to console and, if `BETTERSTACK_SOURCE_TOKEN` is set, to BetterStack (Logtail) with batching + a self-disabling sync on 401/403 so a bad token doesn't spam. Structured context extraction from Error objects. `logger.flush()` on shutdown.
- **Config**: `config/env.ts` validates env with zod and `process.exit(1)` on missing required vars (DB creds, `JWT_SECRET ≥32`). `ENCRYPTION_KEY` is read directly in `encryption.ts` (not in the zod schema — a missing key only fails at first encrypt/decrypt). CORS allows `CORS_ORIGIN` + `localhost:5173`, `credentials:true`.
- **App DB** connection forces SSL with `rejectUnauthorized:false` and **hardcodes port 5432** (ignores `DB_PORT`).
- **Deploy**: GitHub Actions `node.js.yml` on push to `main` → **self-hosted runner (EC2)** → `npm ci` → write `.env` from `secrets.PROD` → `tsc` build → **PM2** restart/start `dist/server.js` as `chatsql`. No tests, no containers. Prod host is `api.sql.bizer.dev`; the CORS default fallback in `server.ts` is `https://sql.bizer.dev`.
- **Product scripts**: `src/scripts/create-dodo-products.ts` / `list-dodo-products.ts` to bootstrap Dodo products. `test-apis.sh` is a shell smoke-test of endpoints.

---

## 16. Full API surface

All under `/api` unless noted. **Private** = requires `authenticate` (JWT cookie/bearer/query token).

### Auth (`/api/auth`) — auth rate-limited
| Method | Path | Notes |
|---|---|---|
| POST | `/register` | send OTP |
| POST | `/verify-email` | OTP → verify, set cookie |
| POST | `/resend-otp` | |
| POST | `/login` | verified users only, set cookie |
| POST | `/logout` | Private |
| POST | `/forgot-password` | |
| POST | `/reset-password` | token |
| GET | `/me` | Private |
| PUT | `/profile` | Private |
| POST | `/change-password` | Private |
| DELETE | `/account` | Private |

### Connections + schema + data (`/api/connections`) — all Private
Connection CRUD: `POST /test`, `POST /`, `GET /`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `POST /:id/sync-schema` (heavy).
Schema/metadata: `GET /:id/schemas`, `GET /:id/table-tree`, `PUT /:id/schemas`, `GET /:id/schemas/:schemaName/tables`, `GET /:id/relations`, `GET /:id/schema-metadata`, `POST /:id/extensions` (heavy).
Analytics: `GET /analytics/workspace`, `GET /:id/analytics`.
Table data: `GET /:id/tables/:schema/:table/columns`, `GET …/data`, `POST …/data` (insert), `PUT …/data/:rowId`, `DELETE …/data/:rowId`.
Raw SQL: `POST /:id/query` (heavy).
Saved queries (mounted on same base): `POST/GET /:connectionId/saved-queries`, `GET/PUT/DELETE /:connectionId/saved-queries/:queryId`, `POST …/:queryId/use`.

### AI (`/api/ai`) — Private, heavy on generate/explain
`POST /:connectionId/generate` (enqueue), `GET /result/:jobId` (poll), `GET /stream/:jobId` (SSE), `POST /:connectionId/explain`, `GET /:connectionId/status`.

### Chat + agent (`/api/chat`) — Private
`GET /:connectionId/session`, `GET /:connectionId/sessions`, `GET /:connectionId/session/:sessionId/messages`, `POST /:connectionId/stream` (SSE, heavy), `POST /:connectionId/clear`, `DELETE /:connectionId/session/:sessionId`.
Agent: `POST /:connectionId/agent/start` (SSE, heavy), `…/agent/:agentSessionId/approve|reject|result|stop`.

### Jobs (`/api/jobs`) — Private
`GET /progress` (SSE, subscribes to `job:progress|complete|error:{userId}` + `ai:result:{userId}`), `GET /status/:jobId`, `GET /connection/:connectionId`, `GET /stats`.

### Viewers (`/api/viewers`) — Private (admin vs self)
Admin: `POST /`, `GET /`, `POST /upsert`, `POST /identity-check`, `GET /:id`, `GET /:id/activity`, `GET /:id/queries`, `POST /:id/revoke`, `DELETE /:id`, `POST /:id/extend`, `PUT /:id/permissions`, `POST /:id/resend-invite`, `GET /access-requests`, `POST /access-requests/:id/approve|deny`.
Self: `GET /me/role`, `GET /me`, `POST /me/access-requests`.

### Usage / Payments / Contact / Admin
Usage (Private): `GET /api/usage/dashboard|plans|tokens`.
Payments (Private except webhook): `POST /api/payments/checkout`, `GET /subscription`, `POST /cancel`, `GET /history`, `GET /read-only-status`, `POST /webhook` (no auth).
Contact: `POST /api/contact`, `POST /api/contact/enterprise` (both public), `GET /api/contact/list`, `PATCH /api/contact/:id` (Private).
Admin: `/admin/queues` (Bull Board; `x-admin-secret` in prod only).
Health: `GET /api/health`.
Legacy (no auth, in `server.ts`): `POST /api/getResult`, `/api/getTables`, `/api/getTableData`, `/api/testConnection`.

---

## 17. Security posture, bugs, and gaps

**Done well**
- Connection passwords encrypted at rest (AES-256-GCM), decrypted only in-memory at use.
- Parameterized queries + identifier allow-listing in the data-CRUD/select paths.
- Read-only enforcement for raw SQL (comment-stripping + keyword block) and per-query-type viewer permission gating.
- bcrypt password + OTP hashing; JWT in httpOnly cookie; SCAN-based cache invalidation; graceful shutdown; structured logging.

**Bugs / correctness**
- **Viewer raw-query permission check is broken**: `checkViewerQueryPermission` selects non-existent columns `can_read`/`can_create` (schema has `can_select`/`can_insert`) → throws for viewers hitting `POST /api/connections/:id/query`.
- **`reset_monthly_usage()` is never scheduled** — monthly token/query counters won't auto-reset unless an external cron calls it (upgrade path does reset on `upgrade_user_plan`).
- Two divergent SQL-generation code paths (streaming vs Gemini-queue) can drift in behavior/quality.

**Security gaps**
- **Dodo webhook signature verification is disabled** — the webhook trusts the body and can upgrade plans; needs `standardwebhooks` verification with `DODO_WEBHOOK_SECRET`.
- **Legacy unauthenticated endpoints** (`/api/getResult`, `/api/getTables`, `/api/getTableData`, `/api/testConnection`) accept a raw DB URI in the body and run queries against it with **no auth and no read-only guard**; `getQuery`→`generateDbMetaData` uses string-interpolated identifiers (injectable). These should be deleted.
- App DB and all user-DB connections use `ssl.rejectUnauthorized:false` (MITM-susceptible); acceptable for managed PG but not ideal.
- Bull Board is unauthenticated in development and secret-header-only in prod.
- Raw-SQL keyword blocking is a denylist (comment-stripped), which is safer than nothing but not a substitute for running under a least-privileged DB role.

**Scale / architecture limits**
- **Agent sessions are in-memory** → single-process only; a restart drops active agent runs, and horizontal scaling would break approvals/SSE routing.
- **`waitForJobResult` polls every 100ms** and holds the HTTP request open — works, but is chatty and ties request latency to queue drain.
- **Redis is a hard dependency** for AI/schema-sync/DB-ops; if it's down the server runs but those features silently no-op.
- Lots of **duplicated `createUserDBConnection` helpers** and a **3,115-line controller** — maintainability debt. `src/service` vs `src/services` are two different folders that both exist.
- No automated tests; deploy is build-and-PM2-restart on a single EC2 box (no blue/green, no containers).

---

## 18. One-paragraph mental model

A signed-in "admin" user registers (email+OTP), stores AES-encrypted credentials for their own Postgres databases, and ChatSQL introspects each database in the background (BullMQ `schema-sync`), caching the schema in Redis and the app's Postgres. From then on, everything the user does to their data — browse tables, edit rows, run raw SQL, fetch analytics — is dispatched as a `db-operations` job that opens a short-lived connection to *their* DB, runs a sanitized/parameterized query, and returns via a 100ms poll. Natural-language requests go to a tiered multi-LLM layer (Gemini for cheap/fast, Anthropic for SQL quality): the **chat** pipeline classifies intent and streams generated SQL over SSE (execution is a separate user-approved call), while **agent mode** plans multi-step SQL, waits for human approval per step, has the frontend execute, and self-heals on errors. A viewer/RBAC layer lets admins share specific tables with time-boxed, permission-scoped guests, and a Dodo-Payments billing layer gates usage with per-plan token/query/connection limits (free users go read-only when exhausted). It's a capable, feature-complete product with a few real bugs (viewer raw-query permission columns), one notable security hole (unverified payment webhook + dead unauthenticated legacy routes), and scale ceilings (in-memory agent state, poll-based job waits, single-process deploy).

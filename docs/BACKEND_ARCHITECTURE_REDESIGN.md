# ChatSQL — Backend Architecture Audit and Target Redesign

> Scope: backend architecture only. This document is based on the current `ChatSQL` backend, the backend contracts used by `ChatSQL-ui`, and the two as-built system-design documents. It does not propose UI work.
>
> The existing `BACKEND_SYSTEM_DESIGN.md` remains the description of the current implementation. This document is the target architecture and migration plan.
>
> **Direction update:** the rewrite has now been selected. [`BACKEND_PLATFORM_MASTER_PLAN.md`](./BACKEND_PLATFORM_MASTER_PLAN.md) supersedes this document where its greenfield technology, service, repository, deployment, capacity, observability, or migration decisions differ. This document remains the evidence-backed audit of the current system.

## 1. Executive decision

ChatSQL does not need a feature rewrite or an immediate split into many microservices. It does need a substantial redesign of its **data plane**: connection management, query execution, schema synchronization, result delivery, authorization, and job durability.

Keep the product/control-plane foundations:

- TypeScript and Node.js
- the application PostgreSQL database
- a stateless HTTP API
- SSE for one-way progress and token streams
- Redis for acceleration and BullMQ for genuinely asynchronous work
- cached schema metadata in ChatSQL's own database
- the current connection, chat, billing, and viewer domain concepts

Replace these foundations:

- queueing every interactive database operation
- constructing and closing a Sequelize pool per operation
- buffering query results into BullMQ/Redis
- sequential per-table schema introspection
- non-versioned, partly updated schema state
- regex-only SQL classification and authorization
- lossy Redis Pub/Sub as the only job-event record
- in-memory agent workflows
- API and all workers in one process on one host

The best near-term shape is a **modular backend with three independently deployable process types from one codebase**, not dozens of services:

1. **API/control plane** — auth, connections, catalog reads, policy, chat/session APIs, billing.
2. **Query execution plane** — bounded external-Postgres pools, SQL policy, streaming, cancellation, and query lifecycle.
3. **Workflow workers** — schema sync, exports, durable AI/agent work, cleanup, and maintenance.

This removes the current latency tax while retaining simple development and deployment boundaries.

## 2. Performance and reliability goals

These should become measured SLOs. The remote database and LLM remain outside ChatSQL's latency control, so record both **platform overhead** and total duration.

| Operation | Target |
|---|---:|
| Cached connection/catalog bootstrap | p95 < 150 ms |
| Uncached catalog read from app DB | p95 < 400 ms |
| Hot-pool query dispatch overhead | p95 < 75 ms before remote DB time |
| Cold-pool query dispatch overhead | p95 < 750 ms before remote DB time |
| Time to first row for a fast query | p95 < 500 ms |
| Table page from a hot connection | p95 < 600 ms for a fast remote DB |
| Initial schema tree for a typical DB | < 2 s |
| Full schema details for a typical DB | < 10 s; progressive for large DBs |
| AI time to first streamed token | p95 < 1.5 s when the provider is healthy |
| Query cancellation after disconnect/cancel | < 2 s |
| Schema/event recovery | no lost terminal state after reconnect or process restart |

Also measure saturation: per-tenant concurrency, external connections, pool wait, queue age, Redis memory, event-loop lag, bytes/rows returned, and app-DB pool wait.

## 3. Highest-impact holes in the current architecture

### 3.1 Interactive work is treated as background work

Every table read, row mutation, raw SQL execution, and analytics request is added to `db-operations`, then the HTTP controller polls BullMQ every 100 ms until completion.

Consequences:

- every request pays Redis enqueue, scheduling, polling, result serialization, and dequeue costs;
- an HTTP request stays open while pretending the job is synchronous;
- Redis availability becomes a requirement for ordinary table browsing and query execution;
- large result sets are serialized through Redis before being sent to the caller;
- the worker limiter is **100 jobs/minute for the whole queue**, despite the comment saying "per connection";
- raw SQL also has a route-level "heavy" limit of only 20 executions per five minutes per user;
- interactive work competes with analytics and mutations in one global lane.

This is the largest avoidable source of latency and the first subsystem to replace.

### 3.2 A new external database pool is created for each operation

`createUserDBConnection` fetches credentials from the app DB, decrypts them, creates a Sequelize instance, authenticates, performs one operation, and closes it. Similar helpers are duplicated across query, sync, AI-context, and connection code.

Consequences:

- repeated DNS, TCP, TLS, and PostgreSQL authentication cost;
- the configured pool size of five provides almost no value because the pool is immediately destroyed;
- connection storms can hit customer databases under concurrent load;
- there is no global or per-customer connection budget;
- credential changes and database failures have no central lifecycle or circuit breaker.

### 3.3 Results are unbounded, buffered, and not cancellable

Raw `SELECT` executes with Sequelize and materializes all rows in process memory. BullMQ then stores the return value in Redis. The 60-second HTTP timeout only stops waiting; it does not cancel the PostgreSQL statement.

Consequences:

- a large result can exhaust worker heap and Redis memory;
- one expensive query can continue after the browser disconnects or the API times out;
- a timed-out operation may be retried while the first attempt is still running;
- there is no time-to-first-row improvement because the response waits for the complete result;
- queue storage, cache data, and job state share the same Redis failure domain.

### 3.4 Mutation retry semantics are unsafe

The default DB-operation job has two attempts, including `INSERT`, `UPDATE`, `DELETE`, DDL, and extension creation. A database commit followed by a worker/Redis acknowledgement failure can cause the mutation to run again.

Mutations require at-most-once execution or explicit idempotency. Infrastructure-level automatic retry must be limited to operations known to be read-only and safe.

### 3.5 Table browsing performs expensive work on every page

The table browser performs an exact `COUNT(*)` and then a `LIMIT/OFFSET` query sequentially. It has no stable default ordering.

Consequences:

- exact counts scan large or selectively filtered tables before rows can be returned;
- deep pages become progressively slower with `OFFSET`;
- rows may move between pages because the order is nondeterministic;
- `CAST(column AS TEXT) ILIKE '%value%'` prevents normal index use;
- only the first primary-key column is supported, with `id` used as a fallback.

### 3.6 Schema synchronization is slow and cannot produce an authoritative snapshot

The full sync loops serially through every schema and table. For each table it separately fetches columns, primary keys, foreign keys, enums, and indexes, and performs multiple app-DB operations. A database with hundreds of tables therefore produces thousands of sequential round trips.

It also has correctness gaps:

- full refresh is enqueued for every owned connection at every login;
- job IDs include the current timestamp, so duplicate syncs are not coalesced;
- single-schema and single-table sync job types are placeholders;
- removed schemas, tables, columns, and relationships are never deleted;
- partially written metadata is visible during a failed sync;
- `schema_synced=true` can continue to describe an old snapshot while a refresh fails;
- there is no durable running/failed state, error, generation, or last-known-good pointer;
- selected schemas do not constrain full introspection;
- cache warming is serial by schema and delays terminal completion;
- AI schema caches use different key spaces and are not invalidated by schema sync;
- an AI-context cache miss introspects the customer DB again instead of using the stored catalog.

The current feature is periodic full introspection, not "real-time sync."

### 3.7 Cache correctness is inconsistent

Redis is useful for metadata but is currently asked to cache external row data and multiple overlapping schema representations.

Current risks:

- row mutation invalidation uses blocking `KEYS` in worker code;
- raw SQL mutations do not invalidate table-row caches;
- schema selection changes do not invalidate AI contexts;
- cache keys embed non-canonical JSON filters, creating avoidable duplicates;
- no single-flight mechanism prevents a miss stampede;
- cache, Pub/Sub, BullMQ jobs, and potentially large job results use the same Redis;
- TTL is being used as a substitute for a catalog generation/version.

Caching stale database rows for 60 seconds is usually a worse experience than a fast source read: users reasonably expect a database tool to show their latest write.

### 3.8 Authorization is not a safe query boundary

There are immediate bugs, plus a structural issue:

- the viewer raw-query check selects nonexistent `can_read` and `can_create` columns;
- it reads one arbitrary permission row and does not verify every table referenced by SQL;
- regex prefix/keyword checks are not a SQL parser or a reliable read-only boundary;
- an allowed viewer query can reference other tables unless execution is enforced against resolved table lineage;
- auth falls back to `super_admin` when the user-role DB lookup fails;
- agent approve/reject/result/stop endpoints do not bind the agent session to the authenticated user and route connection;
- agent execution results are supplied by the browser and trusted by the backend;
- job-status and connection-job endpoints do not verify job ownership.

These are P0 correctness/security blockers because faster execution would otherwise make an unsafe path faster.

### 3.9 Failure handling is fail-open or silent

- the HTTP server begins listening before dependency initialization completes;
- `/api/health` reports OK without checking app DB, execution capacity, Redis, or workers;
- if Redis is unhealthy at boot, workers are skipped and are not later started when Redis recovers;
- ordinary feature requests can still be accepted even though their workers do not exist;
- Redis Pub/Sub loses progress events during disconnects and has no replay cursor;
- the API, all workers, SSE connections, and in-memory agent sessions share one process;
- one PM2 process on one EC2 host is the deployment and failure boundary;
- there are logs but no latency histograms, traces, saturation metrics, SLOs, or automated tests in CI.

### 3.10 Connection and data security need execution-plane controls

- arbitrary user-supplied hosts create an SSRF/private-network scanning surface from the backend network;
- TLS uses `rejectUnauthorized:false` for app and customer databases;
- one environment encryption key has no key identifier, rotation flow, KMS envelope encryption, or per-secret context;
- legacy unauthenticated routes execute against a submitted URI;
- query history stores SQL, prompts, and sample result rows without a clear retention/redaction policy;
- SSE authentication can accept JWTs in query strings;
- a payment webhook is accepted without signature verification.

### 3.11 The existing design documents do not define a performance architecture

The two top-level system-design documents are useful descriptions of the current code and correctly identify several scale ceilings. They do not yet specify SLOs, capacity limits, cancellation, result-size boundaries, tenant fairness, snapshot consistency, or recovery guarantees, so they cannot be used as the target design.

The backend repo's older `ARCHITECTURE.md` and `docs/QUEUE_AND_CACHE_ARCHITECTURE.md` also describe intended features that are not implemented, including a memory L1 cache, intelligent schema-context selection, separate worker processes, single-schema/table sync, and AI-context warming. The end-to-end document exposes important backend contract problems—the browser executes agent SQL and reports the result, table loads go through the DB queue, and progress depends on SSE/Pub/Sub—but those should be resolved in the backend boundaries rather than patched in the UI.

## 4. Target backend architecture

```text
                              ┌──────────────────────────────┐
                              │ Browser / API client         │
                              └──────────────┬───────────────┘
                                             │ HTTPS + SSE
                              ┌──────────────▼───────────────┐
                              │ API / control-plane replicas │
                              │ auth, policy, catalog, chat  │
                              └──────┬────────┬────────┬─────┘
                                     │        │        │
                    catalog/auth     │        │        │ durable commands
                              ┌──────▼───┐ ┌──▼─────┐  ▼
                              │ App PG   │ │ Cache  │  Queue Redis
                              │ source   │ │ Redis  │  (noeviction)
                              │ of truth │ │ derived│       │
                              └──────┬───┘ └────────┘       │
                                     │                      ▼
                           execution │ RPC/HTTP     ┌─────────────────┐
                              ┌──────▼──────────┐   │ Workflow workers│
                              │ Query executors │   │ sync/export/AI  │
                              │ policy + pools  │   └────────┬────────┘
                              └──────┬──────────┘            │
                                     │                       │
                         bounded hot pools                   │
                                     │                       │
                              ┌──────▼───────────────────────▼┐
                              │ Customer PostgreSQL databases │
                              └────────────────────────────────┘

             Durable execution/job state + events live in App PG.
             Redis accelerates delivery; it is not the only record.
```

This can begin as one repository and even one deployment artifact. Run separate commands/processes such as `api`, `query-executor`, and `worker`. The module boundaries should be enforced in code before infrastructure is made more complex.

## 5. Query execution plane

### 5.1 Use a bounded connection broker

Use `pg` directly for customer-database execution. Sequelize can remain temporarily for app-DB access, but it is the wrong abstraction for streaming/cancelable arbitrary SQL.

The broker should:

- key pools by connection ID and credential version;
- keep a small pool for active connections (start with max 2, configurable);
- evict idle pools after a short period;
- enforce per-tenant, per-connection, and global connection budgets;
- serialize pool creation with single-flight locking;
- cache decrypted credentials only in process memory for a short TTL;
- invalidate a pool immediately when credentials/configuration change;
- expose pool-wait, connect, TLS, query, first-row, and total timings;
- apply a circuit breaker/backoff after repeated connection failures;
- set `application_name` with ChatSQL execution and tenant identifiers;
- support CA verification and managed-database/IAM credentials where available.

Do not put credentials or query results in queue payloads.

### 5.2 Split interactive and asynchronous execution

**Interactive path** — table pages, normal SQL console executions, row mutations:

1. Authenticate and load an authorization snapshot.
2. Parse and validate the SQL or structured table operation.
3. Acquire a bounded executor slot and hot connection.
4. Execute directly with deadlines and cancellation.
5. Stream or return a bounded result.
6. Finalize query history and usage asynchronously through an outbox/event.

**Asynchronous path** — exports, explicitly long-running queries, heavy analytics, schema sync:

1. Create a durable operation record in app PG.
2. Enqueue a command using a stable operation ID.
3. Worker claims it idempotently.
4. Persist progress/events and the terminal result reference.
5. Deliver events via SSE with replay.

BullMQ should not carry interactive result rows. An asynchronous export should stream rows to encrypted object storage and return a short-lived signed download URL.

### 5.3 Add a real SQL policy engine

Parse PostgreSQL SQL into an AST and reject multiple statements unless an explicit privileged mode permits them.

For every statement:

- determine statement type from the AST;
- resolve every referenced schema/table, including CTEs and nested queries;
- apply the most-specific viewer permission to every referenced object;
- forbid unapproved functions/capabilities for restricted viewers;
- enforce selected schema and export policies;
- record the policy decision and catalog generation used.

For read-only execution, use database enforcement in addition to parsing:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '15s';
-- execute exactly one parsed statement
COMMIT;
```

Where the supplied database principal is too powerful, strongly recommend a dedicated least-privileged ChatSQL role. Database permissions/RLS remain the final security boundary.

### 5.4 Bound, stream, and cancel results

- Default interactive previews to a configurable maximum, such as 1,000 rows and 10 MB.
- Add a hard server cap even when the SQL has no `LIMIT`.
- Stream rows as NDJSON or another incremental format for time-to-first-row.
- Do not store full result bodies in Redis or app PG.
- Store only bounded/redacted previews when history retention permits it.
- On client disconnect, explicit cancel, or deadline, cancel the PostgreSQL backend and mark the execution `cancelled`.
- Persist a lifecycle: `accepted → running → streaming → succeeded|failed|cancelled|timed_out`.
- Never automatically retry a mutation. Require an idempotency key for mutation APIs that clients may retry.

### 5.5 Make table browsing database-native

- Use keyset/cursor pagination over a stable primary-key or unique-key ordering.
- Support composite keys.
- Return `limit + 1` rows to determine `hasNextPage`.
- Make exact total count optional and asynchronous; use `pg_class.reltuples` as an approximate initial count.
- Validate filters against catalog column types.
- Avoid casting every filtered column to text unless the user explicitly requests cross-type text search.
- Use optimistic concurrency (`xmin` or a supplied version column) for row edits to prevent silent lost updates.
- Return inserted/updated/deleted rows with `RETURNING` so the client sees authoritative values and defaults.

## 6. Schema synchronization plane

### 6.1 Store immutable, versioned snapshots

Add a durable sync model:

- `schema_sync_runs`: ID, connection, requested reason, status, attempts, timestamps, error, source fingerprint, statistics.
- `schema_snapshots`: immutable snapshot header and generation.
- snapshot-scoped schemas, tables, columns, indexes, constraints, enums, and relations.
- `connections.active_schema_snapshot_id`: pointer to the last successfully published snapshot.

Readers use only the active snapshot. A sync writes a new snapshot, validates it, computes its diff, then atomically changes the pointer in one app-DB transaction. Failure leaves the previous snapshot intact and usable.

Retain a small number of previous snapshots for diagnosis, then delete them asynchronously.

### 6.2 Replace per-table introspection with bulk catalog reads

Open one read-only, repeatable-read transaction against the customer DB and query `pg_catalog` in a small fixed number of set-based queries for:

- schemas and relations;
- columns, types, defaults, generated/identity flags, and comments;
- primary/unique/foreign/check constraints;
- indexes, expressions, included columns, and predicates;
- enums and domains;
- relation sizes and approximate row counts.

Group the returned rows in memory and bulk insert/COPY them into the snapshot. Complexity becomes a handful of round trips plus result size, rather than several round trips per table.

### 6.3 Make initial sync progressive

Publish useful metadata in two stages:

1. **Discovery snapshot** — schema and table names/types, enough for the workspace tree.
2. **Detailed snapshot** — columns, constraints, indexes, comments, and relationships.

For exceptionally large databases, detail can be chunked by schema while remaining hidden until the final detailed snapshot is atomically published. On-demand table refresh becomes a real implementation, not a placeholder.

### 6.4 Coalesce and trigger refresh intelligently

- Use one stable active sync key per connection.
- If another request arrives while a sync is running, set `refresh_requested=true` rather than enqueueing duplicates.
- Never full-sync all connections merely because a user logged in.
- Trigger targeted refresh after DDL executed through ChatSQL.
- Run adaptive reconciliation based on age and recent use.
- Optionally support a customer-installed PostgreSQL event trigger for near-real-time DDL notification, but do not require elevated privileges for the base product.
- Resync only changed objects using catalog fingerprints when possible; run periodic full reconciliation as a safety net.

### 6.5 Version caches instead of scanning to invalidate

Use keys such as:

```text
catalog:{connectionId}:v{generation}:tree
catalog:{connectionId}:v{generation}:schema:{schemaName}
catalog:{connectionId}:v{generation}:ai:{policyHash}
```

The active snapshot/generation is a small pointer. Publishing a snapshot changes the pointer; old keys expire naturally. This removes wildcard invalidation and guarantees that tree, ERD, autocomplete, and AI context refer to the same catalog generation.

Use stale-while-revalidate and single-flight population. Warm only the compact tree and genuinely hot data, not every full schema document serially.

## 7. Cache and event architecture

Use separate Redis failure domains:

- **Queue Redis**: BullMQ only, `noeviction`, durable configuration, no large result payloads.
- **Cache Redis**: derived metadata, auth/policy snapshots, rate limits, and short-lived coordination locks; eviction is acceptable.

Do not cache customer table rows by default. The browser query cache plus a hot customer-DB pool gives fresher behavior without retaining arbitrary customer data in shared Redis. If query-result caching is later added, it must be explicit, bounded, encrypted where required, scoped by tenant + permission version + catalog generation, and invalidated by known writes.

Replace Pub/Sub-only progress with durable events:

- persist operation/job state and monotonically increasing events in app PG;
- use an outbox to publish wakeups to Redis Streams or Pub/Sub;
- SSE accepts `Last-Event-ID` and replays missing events from the durable log;
- terminal state is always queryable after reconnect;
- use cookie auth or a short-lived, single-use stream ticket rather than a long-lived JWT in a URL.

## 8. AI and agent architecture

- Delete the duplicate Gemini queue pipeline and keep one provider-neutral orchestration path.
- Build AI context exclusively from the active catalog snapshot.
- Retrieve a small relevant subgraph with deterministic lexical matching, FK expansion, recent-query signals, and optional embeddings instead of placing the whole schema in every prompt.
- Skip the extra LLM intent-classification request for deterministic cases; use it only when local classification confidence is low.
- add provider timeouts, circuit breakers, health scoring, and fallback based on live error/latency data.
- propagate browser disconnect/cancel to provider streams to stop unnecessary token use.
- persist agent workflow state, approvals, proposed SQL, policy decision, executions, and results.
- after approval, the backend execution plane executes the proposed SQL; the browser must not be the authority that reports whether it succeeded.
- bind every agent command to session user, connection, workflow version, and current expected state.

The durable agent state machine should be:

```text
planning → awaiting_approval → approved → executing
        ↘ rejected             ↘ failed → repairing → awaiting_approval
                                  ↘ succeeded → next_step|completed
```

Use compare-and-set/version checks so duplicate approval or result requests cannot advance a workflow twice.

## 9. Control plane and app database

- Split the 3,115-line connection controller into connection, catalog, table-data, execution, and analytics modules.
- Centralize authorization and connection ownership in one policy service; never default to a privileged role on lookup failure.
- Introduce a real migration tool and run migrations as an explicit deployment step; do not create tables at request/runtime.
- Add composite indexes matching real access paths, especially query history by `(connection_id, created_at DESC)`, chat messages by `(session_id, created_at)`, and viewer permissions by tenant/scope.
- move expensive analytics off request-time scans using rollups/materialized aggregates as history grows.
- partition or archive high-growth query, token-usage, activity, and event tables by time when volume warrants it.
- enforce retention for SQL text, prompts, result previews, activity, and exports; make sensitive result storage opt-in.
- use a transactional outbox for usage, audit, cache/event publication, and other side effects that must follow a committed state change.

A workspace bootstrap endpoint can return the connection summary, active catalog generation, compact table tree, effective permissions, and sync state in one versioned response. This is a backend contract change that reduces load-time round trips without prescribing UI design.

## 10. Isolation, resilience, and deployment

### 10.1 Bulkheads and fairness

- separate interactive, sync, export, analytics, and AI capacity;
- per-connection and per-tenant concurrency semaphores;
- global execution and outbound-connection budgets;
- weighted fair scheduling for asynchronous work;
- backpressure with `429`/`503` and an honest retry time;
- never let one large customer database consume all worker slots.

### 10.2 Dependency behavior

- `/live` proves only the process is alive;
- `/ready` verifies app DB and that the process can serve its declared role;
- expose degraded component state separately;
- do not accept a job-dependent request if no execution capacity is available;
- reconnect workers after Redis recovery or restart the unhealthy process;
- use bounded retries with jitter and explicit dead-letter handling;
- mutations are excluded from generic retries.

### 10.3 Deployment shape

- build immutable containers;
- run at least two API replicas behind a load balancer;
- deploy query executors and workflow workers independently;
- use graceful connection draining and rolling/blue-green releases;
- run migrations once before compatible application rollout;
- CI must run typecheck, unit tests, integration tests with PostgreSQL/Redis, policy tests, and a small load test;
- maintain rollback and database backward-compatibility rules.

Kubernetes is not required. A managed container platform with autoscaling and managed PostgreSQL/Redis is sufficient until operational needs justify more machinery.

### 10.4 Network and secrets

- deny loopback, link-local, metadata, and private destination ranges by default; protect against DNS rebinding;
- run customer DB egress from an isolated execution network;
- offer an explicit agent/tunnel or approved private-connectivity model for private databases;
- verify TLS certificates by default and allow customer-provided CAs;
- move connection-secret encryption to KMS envelope encryption with key versions and rotation;
- remove legacy unauthenticated URI routes;
- verify payment webhook signatures before processing.

## 11. Observability and verification

Every execution and sync receives a correlation ID. Trace these stages separately:

```text
request → auth → policy → pool_wait → connect → remote_query
        → first_row → rows_streamed → history/outbox → response_complete
```

Required metrics:

- API latency/error by route and tenant tier;
- execution platform overhead vs remote query time;
- first-row and total query duration;
- rows/bytes returned and truncated;
- pool size, waiters, churn, connect failures, and circuit state;
- per-tenant concurrency and rejections;
- sync queue age, sync stage duration, objects/bytes processed, and coalesced requests;
- cache hit/miss/stale/single-flight and memory;
- event replay lag and SSE connections;
- event-loop lag, heap, app-DB pool wait, Redis latency/memory;
- AI first-token latency, provider error/fallback, tokens, and abandoned streams.

Before rollout, build repeatable tests for:

- 10, 100, 1,000, and 10,000-table schema catalogs;
- 100 concurrent users distributed across many customer DBs;
- a single noisy tenant;
- multi-GB query attempts and disconnect cancellation;
- Redis/cache loss, queue loss, API restart, executor restart, and app-DB failover;
- duplicate mutation requests and worker acknowledgement loss;
- adversarial SQL, multi-statement SQL, CTEs, functions, quoted identifiers, and viewer cross-table access;
- DDL add/rename/drop followed by failed and successful syncs.

## 12. Migration plan

### Phase 0 — make the current system safe and measurable

1. Remove legacy unauthenticated database routes.
2. Verify payment webhooks.
3. Make auth and authorization fail closed.
4. Fix viewer permission columns and enforce ownership on job/agent endpoints.
5. Stop login-triggered full refresh.
6. Disable retries for mutations.
7. Add query row/byte limits, PostgreSQL statement timeouts, and cancellation.
8. Separate heavy-operation rate limits from normal SQL execution.
9. Add tracing/metrics around the current stages so improvements are measurable.

### Phase 1 — replace the interactive query path

1. Introduce the `pg`-based connection broker and query executor module.
2. Route table reads and safe SQL previews directly to it behind a feature flag.
3. Add AST policy enforcement, database read-only transactions, and stable execution records.
4. Add cursor table pagination, optional counts, composite keys, and optimistic mutations.
5. Stream bounded results and remove interactive results from BullMQ.
6. Move history/usage/audit side effects to a transactional outbox.

This phase produces the largest user-visible speedup.

### Phase 2 — replace schema sync and metadata caching

1. Add sync-run and immutable snapshot schema.
2. Implement bulk `pg_catalog` extraction and atomic snapshot publication.
3. Serve all catalog APIs and AI context from the active snapshot.
4. Add generation-versioned cache keys and single-flight/stale-while-revalidate.
5. Implement targeted table/schema refresh, deduplication, deletion detection, and adaptive reconciliation.
6. Remove old overlapping schema/AI cache paths.

### Phase 3 — durable workflows and result delivery

1. Persist operation events and add SSE replay.
2. Separate queue and cache Redis.
3. Move agent state and execution authority to the backend workflow.
4. Add asynchronous streaming exports to object storage.
5. Consolidate AI generation and schema retrieval.

### Phase 4 — independent scaling and hardening

1. Run API, query executor, and workflow worker as separate process groups.
2. Deploy multiple API replicas with readiness, draining, and rolling releases.
3. Add autoscaling based on executor saturation and queue age.
4. Complete KMS/TLS/egress hardening, retention controls, failure drills, and load gates.

## 13. What not to do

- Do not rewrite Express solely for framework benchmark gains; remote DB and queue architecture dominate latency.
- Do not create a microservice per domain yet; it would add failure modes without fixing query execution.
- Do not add more Redis caching to hide slow customer-DB access before pooling, pagination, and result bounds are fixed.
- Do not use Kafka for this scale merely to make events durable; app PG + outbox + Redis delivery is enough.
- Do not promise real-time schema sync without a DDL event source; use accurate "automatic" or "recent" language for polling-based reconciliation.
- Do not automatically retry writes.

## 14. Final priority order

If only five architecture changes are funded, do them in this order:

1. **Direct, pooled, bounded, cancelable interactive query execution.**
2. **AST + database-enforced authorization/read-only policy.**
3. **Bulk, immutable, versioned schema snapshots with no login sync.**
4. **Cursor pagination, optional counts, and streaming result limits.**
5. **Durable job/workflow state with separate cache/queue Redis and independent process scaling.**

That sequence improves speed, freshness, safety, and operational capacity together instead of optimizing one at the expense of the others.

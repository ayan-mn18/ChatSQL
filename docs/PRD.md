# ChatSQL — Product Requirements Document (reverse-engineered, as-built)

> This PRD is reconstructed from the actual code in `ChatSQL` (backend) and `ChatSQL-ui` (frontend), not from the repos' aspirational docs. It describes what the product **is today**, who it's **for**, how they'd **use it**, and what it would take to make it market-ready. Pair with `BACKEND_SYSTEM_DESIGN.md` and `FRONTEND_AND_E2E_SYSTEM_DESIGN.md`.

---

## 1. Product summary

**ChatSQL is an AI-native database workspace.** A user connects their own PostgreSQL database, ChatSQL introspects it, and from then on the user can explore and operate that database three ways:

1. **Talk to it** — ask questions in plain English and get optimized SQL, streamed live (chat), or let an **agent** plan and execute a multi-step task with human approval at each step.
2. **Browse & edit it** — a spreadsheet-like table explorer with filtering, sorting, pagination, inline edit/insert/delete, plus an auto-generated ERD.
3. **Query it directly** — a Monaco SQL editor with schema-aware autocomplete, saved queries, execution history, and result charts.

On top of that sits a **team/sharing layer** (invite time-boxed "viewers" with per-table permissions) and a **usage-based billing layer** (free tier that drops to read-only when exhausted; paid tiers via Dodo Payments).

**One-liner:** *"Your database, fluent in human"* — a Postgres client where natural language, direct SQL, and data editing live in one place, with sharing and billing built in.

---

## 2. Problem & motivation

Working with a database still forces a context switch that most non-DBAs and even busy engineers resent:

- **Business/ops/PM users** know the question ("how many trial users converted last week?") but not the schema or SQL dialect, so they file a ticket and wait on an analyst.
- **Developers** can write SQL but lose time on boilerplate, remembering exact column names, and hopping between a DB GUI, a SQL editor, and an AI assistant in a browser tab.
- **Analysts** repeatedly hand-hold stakeholders through the same "can you pull this" requests.
- **Teams** that want to give a contractor or a teammate *scoped, temporary* read access to a production DB have blunt tools (share credentials, or build a bespoke internal viewer).

ChatSQL collapses that into one workspace: natural-language querying grounded in the real schema, direct SQL when you want control, safe data editing, and permissioned sharing — without the user hand-copying connection strings into a chatbot.

---

## 3. What exists today (feature inventory, verified in code)

| Capability | Status | Notes |
|---|---|---|
| Email/password signup + **OTP email verification** | ✅ | 6-digit OTP, 10-min expiry, 3 attempts; JWT in httpOnly cookie (24h) |
| Password reset, change password, delete account, profile | ✅ | |
| Connect a **PostgreSQL** DB (test-before-save, AES-256-GCM encrypted creds) | ✅ | Postgres only in practice |
| MySQL / MongoDB / Snowflake connect | ⚠️ UI only | Wizard shows cards; backend forces `postgres` |
| Background **schema sync** (schemas→tables→columns→indexes→FKs) w/ live progress | ✅ | BullMQ + SSE progress bar; warms Redis cache |
| **Table explorer**: paginate, sort, typed filters, search, column manager, inline CRUD | ✅ | Read-only enforced for exhausted free users / limited viewers |
| **SQL editor** (Monaco) w/ schema autocomplete, saved queries, history, result charts | ✅ | `QueryConsole` |
| **ERD visualizer** | ✅ | xyflow + dagre from `erd_relations` |
| **AI chat (Ask)**: NL→SQL, streamed, intent-routed, multi-turn | ✅ | Gemini for cheap/fast, Anthropic for SQL quality |
| **AI agent**: plan → approve → execute → self-heal (≤3 retries) | ✅ | Human-in-the-loop; sessions in memory |
| SQL explanation | ✅ | |
| Query optimization / index suggestions | ❌ stub | Returns "not implemented yet" |
| Per-connection **analytics** (size, cache hit ratio, hot/cold tables, `pg_stat_statements`) | ✅ | |
| Workspace analytics across connections | ✅ | |
| **Viewers / RBAC**: invite users, per-connection/schema/table permissions, activity log, access requests, time-boxed expiry | ✅ | Large subsystem |
| **Billing**: Free/Pro-monthly/Pro-yearly/Lifetime/Enterprise; Dodo checkout; webhooks; read-only on exhaustion | ✅ | Webhook signature check disabled (risk) |
| Usage dashboard (tokens/queries/connections vs limits) | ✅ | |
| Contact / enterprise inquiry forms + email | ✅ | |
| Cmd+K palette, dark UI, mobile nav | ✅ | |
| Dashboards / widgets (from old architecture docs) | ❌ | Never built |

---

## 4. Target users & personas

ChatSQL's design (connections you own + NL querying + scoped sharing + self-serve billing) points at **small teams and individual builders who run their own Postgres**, not large regulated enterprises (despite the enterprise copy). Primary personas:

### Persona A — "Builder Dev" (primary)
Solo founder / indie hacker / full-stack dev on a startup team. Owns a Supabase/RDS/Neon Postgres. Wants to stop context-switching between a DB GUI and ChatGPT, wants fast answers and safe edits, and occasionally needs to give a teammate scoped access. **Willing to pay $10/mo or $100 lifetime.** This is who the pricing and Postgres-first support actually fit.

### Persona B — "Data-curious Operator" (primary)
PM, growth/ops, founder, or founder's-first-BizOps hire. Can describe the question, can't reliably write SQL. Lives in the Ask chat and the table explorer. Needs guardrails (read-only, approvals) and trustworthy, explained SQL. Converts because it removes their dependency on an analyst.

### Persona C — "Analyst / Data lead" (secondary, the buyer/admin)
Writes SQL fluently; value is speed (autocomplete, saved queries, history) and **delegation**: they're the `super_admin` who invites viewers, sets per-table permissions, and hands out time-boxed access to stakeholders/contractors instead of sharing credentials.

### Persona D — "Temporary Viewer" (guest, not a buyer)
A contractor, auditor, or cross-team teammate given scoped, expiring access to specific tables. Logs in with a temp password, forced to change it, sees only what they're permitted, may request more time/access.

### Who it is *not* for (today)
- Enterprises needing SOC2/SSO/audit guarantees — the landing claims these but the code doesn't deliver them (SSO/SAML unbuilt; webhook + legacy-route security gaps).
- MySQL/Mongo/Snowflake shops — advertised, not supported.
- Analysts wanting BI dashboards/scheduled reports — not built.

---

## 5. Who to target first (go-to-market recommendation)

**Beachhead: individual developers and ≤10-person startup teams already on managed Postgres (Supabase, Neon, RDS).** Rationale straight from the build:

1. **Postgres-only is fine here** — that ecosystem is Postgres-heavy, so the biggest technical gap (no MySQL/Mongo) doesn't bite.
2. **Self-serve pricing fits** — $0 → $10/mo → $100 lifetime is an indie/prosumer price ladder, not an enterprise motion.
3. **The sharing layer is a wedge** — "give your non-technical cofounder safe, read-only, expiring access to prod data" is a concrete pain these teams have and existing Postgres GUIs (TablePlus, pgAdmin, Postico) don't solve.
4. **The AI is the hook, the workspace is the retention** — NL querying gets them in; saved queries, table editing, and ERD keep them.

**Channels:** Supabase/Neon communities, indie-hacker/DevTool launch venues (Product Hunt, HN, r/PostgreSQL, r/SideProject), and "AI + your database" content marketing. Land the Builder Dev, expand to their Operator teammates via the viewer invite flow (built-in virality: every invited viewer is a potential future admin).

**Defer:** enterprise until SSO, audit logging, verified security posture, and multi-DB exist. Today's "Enterprise — contact us" should be treated as a lead-capture experiment, not a shippable tier.

---

## 6. Core user journeys

### 6.1 Activation (first value in <5 min)
Sign up → verify OTP → **Add Connection** (pick Postgres, paste host/port/db/user/password, Test, Save) → watch the schema-sync progress bar → land in the connection workspace → ask the chat a question → get streamed SQL → **Run** → see rows + chart. *Aha moment = first correct answer to a plain-English question about their real data.*

### 6.2 Daily driver (retention)
Open a saved connection → browse/filter a table or open the SQL editor → autocomplete + saved queries + history speed up recurring work → occasionally ask the chat for a gnarly join or paste an error to get it fixed (the intent classifier treats pasted SQL errors as follow-ups and repairs the query).

### 6.3 Delegation (expansion)
Admin opens User Management → invite a viewer by email → pick connection/schema/table permissions + AI/export/analytics toggles + optional expiry → viewer gets a temp-password email → logs in, forced to change password, sees only permitted data → can request more access/time → admin approves. Expired viewers auto-deactivate.

### 6.4 Monetization
User hits free limits (10k AI tokens or 500 queries/mo, or 2 connections) → app flips to **read-only** and surfaces upgrade prompts → `/dashboard/pricing` → Dodo checkout (Pro $10/mo, Pro $96/yr, or Lifetime $100) → webhook upgrades the plan and resets usage.

---

## 7. Pricing & packaging (as configured)

| Tier | Price | AI tokens/mo | Queries/mo | Connections | Storage | Behavior on limit |
|---|---|---|---|---|---|---|
| Free | $0 | 10,000 | 500 | 2 | 50 MB | **Read-only** until upgrade / cycle reset |
| Pro Monthly | $10/mo | 100,000 | 5,000 | 10 | 500 MB | normal |
| Pro Yearly | $96/yr (~$8/mo) | 100,000 | 5,000 | 10 | 500 MB | normal |
| Lifetime | $100 one-time | Unlimited | Unlimited | 50 | 5,000 MB | normal |
| Enterprise | Contact | Unlimited | Unlimited | Unlimited | Unlimited | normal (unbuilt features) |

Notes: limits live in `plan_configurations` and are enforced primarily via the `check_user_read_only` Postgres function + usage logging. Monthly counters are meant to reset via `reset_monthly_usage()` but **nothing schedules it** — a cron/repeatable job is required or paid/free cycles won't reset automatically (upgrades do reset). The Lifetime tier at $100 for unlimited AI is generous given real LLM COGS — worth revisiting.

---

## 8. Competitive positioning

| Category | Examples | ChatSQL's angle |
|---|---|---|
| Postgres GUIs | TablePlus, Postico, pgAdmin, DBeaver | ChatSQL adds NL + agent + web-based sharing/permissions; they're desktop, no AI, no scoped sharing |
| AI SQL assistants | Text-to-SQL in ChatGPT, Vanna, various copilots | ChatSQL is *grounded in your synced schema* and *executes safely against your DB* with history/read-only guards, not a disconnected chatbot |
| Cloud DB consoles | Supabase Studio, Neon SQL editor | ChatSQL is provider-agnostic (any Postgres), adds agent mode + viewer RBAC + saved-query workspace |
| Lightweight BI / data apps | Retool, Metabase | ChatSQL is DB-operator-centric (edit rows, run SQL, chat) not dashboard-centric; simpler, cheaper, AI-first |

**Differentiation to lean on:** (1) NL + direct SQL + row editing in one place, grounded in the live schema; (2) human-in-the-loop **agent** that self-heals SQL errors; (3) built-in **time-boxed, per-table sharing** that GUIs lack. **Weakness vs all of them:** Postgres-only, unproven security, solo-built maturity.

---

## 9. Non-functional posture (today)

- **Architecture**: Express monolith on EC2/PM2, Postgres app DB, Redis (cache+queues+pubsub), 3 LLM providers behind a tiered factory, Vercel SPA frontend. All user-DB work runs through BullMQ job queues; realtime via SSE.
- **Security done well**: encrypted-at-rest DB creds, parameterized queries + identifier allow-listing, read-only SQL guard, bcrypt/OTP hashing, cookie JWT.
- **Scale ceilings**: single-process (in-memory agent sessions), 100ms job-result polling, Redis as a hard dependency.

---

## 10. Gaps, risks & required work before GTM

### P0 — security/correctness (fix before charging real money at scale)
1. **Enable Dodo webhook signature verification** (`standardwebhooks` + `DODO_WEBHOOK_SECRET`). Today the webhook is unauthenticated → forgeable plan upgrades.
2. **Delete legacy unauthenticated routes** (`/api/getResult`, `/api/getTables`, `/api/getTableData`, `/api/testConnection`) — they take a raw DB URI, no auth, no guards, and use string-interpolated SQL (injectable).
3. **Fix the viewer raw-query permission bug** — `checkViewerQueryPermission` selects non-existent `can_read`/`can_create` (schema has `can_select`/`can_insert`) → viewers' raw SQL calls throw.
4. **Stop storing OTP in plaintext** — `email_verifications.otp_code` holds the code alongside its hash; keep only the hash.
5. **Fix the SMTP env mismatch** — `email.service.ts` reads `process.env['smtp.host'|'smtp.login'|'smtp.key'|…]`, but `.env.example`/README document `SMTP_HOST`/`SMTP_USER`/… → email silently fails unless the odd bracket-keys are set. Reconcile and document.

### P1 — correctness/ops
6. **Schedule `reset_monthly_usage()`** (repeatable job) so billing cycles actually reset.
7. **Reconcile `check_user_read_only`'s paid-plan allowlist** — it checks `IN ('pro','lifetime','enterprise')` but current plans are `pro_monthly`/`pro_yearly` (latent; only the default `RETURN FALSE` currently saves paid users from being mislabeled).
8. **Wire the plan-limit middleware** (`checkAITokenLimit`/`checkQueryLimit`/`checkConnectionLimit`) onto routes, or consciously rely on the usage-logging + read-only path and delete the unused middleware.
9. **Harden Bull Board** (`/admin/queues` is open in dev, secret-header only in prod).

### P2 — product/market fit
10. **Deliver or remove multi-DB** — either implement MySQL/Mongo/Snowflake or drop them from the connect wizard to avoid broken promises.
11. **Substantiate or soften landing claims** — SOC2 Type II, named-company logos, "10k+ developers", "99.9% SLA" are unbacked; risky for trust/legal.
12. **Ship optimize/suggest-indexes** or hide them (currently stubs).
13. **Clean the debt**: remove Bolt scaffold identity, orphan `SQLEditor`/unrouted Analytics+Settings, duplicate `src/service` vs `src/services`, the hardcoded `localhost:7070` feedback widget, dual toast libs, and the stale AUTH/UI/ARCHITECTURE markdown that contradicts the code.

### P3 — scale (only when traction demands)
14. Externalize agent session state (Redis) to allow horizontal scaling; consider event-driven job results instead of 100ms polling; containerize + add CI tests.

---

## 11. Suggested near-term roadmap

- **Milestone 0 — "Trustworthy" (P0 list):** close security/correctness holes. Non-negotiable before any paid push.
- **Milestone 1 — "Honest & clean" (P1 + P2 #11/#13):** fix billing reset, align claims to reality, remove dead code, tighten admin surfaces. Now the product matches its promises.
- **Milestone 2 — "Sticky" :** polish the Builder-Dev + Operator loop (onboarding, sample connection, faster first answer), ship query optimize/index suggestions, add CSV/JSON export UX end-to-end.
- **Milestone 3 — "Expand" :** add MySQL (highest-demand second dialect), scheduled/saved reports, and team niceties — then revisit an honest Enterprise tier (SSO, audit logs) if pipeline justifies it.

---

## 12. One-paragraph pitch (for positioning)

ChatSQL turns any PostgreSQL database into a conversational, collaborative workspace: connect once, and your team can ask questions in plain English (grounded in your real, auto-synced schema), run and save SQL with autocomplete, browse and safely edit data, and visualize the ERD — while an AI agent can plan and self-heal multi-step tasks with your approval. Admins invite teammates or contractors with time-boxed, per-table permissions instead of sharing credentials, and usage-based plans (free to $10/mo to $100 lifetime) keep it self-serve. It's the "GUI + SQL editor + AI copilot + scoped sharing" for Postgres-native builders — strongest today for indie devs and small startup teams, with a clear path to team and (eventually) enterprise once security and multi-DB catch up to the marketing.

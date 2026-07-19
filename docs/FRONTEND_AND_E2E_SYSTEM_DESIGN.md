# ChatSQL — Frontend & End-to-End System Design (as-built)

> Companion to `BACKEND_SYSTEM_DESIGN.md`. Covers the `ChatSQL-ui` repo (`ayan-mn18/ChatSQL-ui`) and how the two halves wire together at runtime. Derived from reading the frontend source + corroborated by a full frontend inventory pass.
>
> The future backend contracts and deployment model are planned in [`BACKEND_PLATFORM_MASTER_PLAN.md`](./BACKEND_PLATFORM_MASTER_PLAN.md). That plan intentionally does not redesign the UI.

---

## 1. What the frontend is

A **React 19 + Vite 7 single-page app** deployed on **Vercel** (SPA rewrite → `index.html`). It's the workspace users actually touch: marketing landing → auth → a dashboard for managing database connections → a per-connection workspace (browse tables, run SQL, chat with the DB, view the ERD). It talks to the backend over HTTPS with an **HTTP-only cookie session** and consumes **Server-Sent Events (SSE)** for anything long-running (schema sync progress, AI chat/agent streams, AI job results).

Origin markers: the repo is a **Bolt.new scaffold** (`.bolt/config.json` → `bolt-vite-react-ts`; `package.json` name is still `vite-react-typescript-starter`). API base is `VITE_API_URL` (prod `https://api.sql.bizer.dev/api`, dev fallback `http://localhost:8080/api`).

---

## 2. Tech stack (from `package.json`)

| Layer | Choice |
|---|---|
| Framework / lang | React 19.2, TypeScript 5.5 |
| Build | Vite 7 (`@vitejs/plugin-react`), alias `@ → ./src`, `optimizeDeps.exclude: ['lucide-react']` |
| Routing | `react-router-dom` 7 |
| Server state | **TanStack Query 5** (single hub in `src/hooks/useQueries.ts`; client configured inline in `main.tsx`, not a separate `queryClient.ts`) |
| Client state | React Context only — Auth, JobProgress, TableTabs, QueryTabs (no Redux/Zustand) |
| HTTP | `axios` (`withCredentials: true`) |
| UI | shadcn (New York) over Radix primitives + Tailwind 3 (`cva`, `clsx`, `tailwind-merge`) |
| Icons | `lucide-react` |
| SQL editor | **`@monaco-editor/react`** (the real one, in `QueryConsole`); `react-simple-code-editor` + Prism only in an orphan mock |
| SQL tooling | `node-sql-parser` + custom `sql-autocomplete.ts`, `prism-setup.ts` |
| ERD | `@xyflow/react` + `dagre` |
| Charts | `chart.js` + `react-chartjs-2` |
| Cmd+K | `kbar` |
| Motion / fx | `framer-motion`, `react-spring`, `cobe` (globe), `canvas-confetti`, `html-to-image` |
| Toasts | both `react-hot-toast` and `sonner` (dual systems) |
| OTP UI | `input-otp` |
| DnD | `@dnd-kit/*` + `react-dnd` (both present) |

Scripts: `dev` / `build` / `lint` / `preview`.

Provider nesting (`main.tsx`): `BrowserRouter → QueryClientProvider → AuthProvider → JobProgressProvider → CommandKBarProvider → (AuthRedirector + App + GlobalJobProgress + Toaster)`. TanStack defaults: `staleTime` 5m, `gcTime` 30m, `retry` 2, no refetch-on-focus, global error toast that ignores 401 / `meta.silent`.

---

## 3. Route map (`src/App.tsx`)

| Path | Access | Component | Purpose |
|---|---|---|---|
| `/` | public | `ChatSQLLanding` | primary marketing page |
| `/landing` | public | `FuturisticLanding` | alternate landing (experiment) |
| `/hexora` | public | `LandingPage` | Hexora-branded landing (legacy plan) |
| `/chat` | public | `ChatPage` | **legacy** URI-in-localStorage NL chat → `/api/getResult` |
| `/contact` | public | `ContactPage` | contact / enterprise inquiry |
| `/auth/signin`,`/signup`,`/forgot-password`,`/reset-password` | public | auth pages | password + OTP |
| `/chat/:connectionId` | protected | `StandaloneChat` | full-page `ChatPanel` |
| `/auth/force-change-password` | protected | `ForceChangePasswordPage` | invited-viewer temp-password flow |
| `/dashboard` | protected | `DashboardLayout` | shell; index → `connections` |
| `/dashboard/connections` | protected | `ConnectionsPage` | connection cards + Add/Edit wizard |
| `/dashboard/usage` | protected | `UsageDashboard` | tokens/queries/limits |
| `/dashboard/users` | protected | `UserManagementPage` | admin viewer mgmt (viewers → `/access`) |
| `/dashboard/access` | protected | `MyAccessPage` | viewer "my access" |
| `/dashboard/pricing` · `/billing` · `/checkout/success` · `/checkout/cancelled` | protected | billing pages | plans + Dodo checkout |
| `/dashboard/profile` | protected | `ProfilePage` | profile, password, delete account |
| `/dashboard/connection/:id` | protected | `ConnectionLayout` | index → `overview` |
| `.../overview` | protected | `ConnectionOverview` | connection health/analytics |
| `.../table/:schema/:table` | protected | `TableView` | browse + CRUD rows |
| `.../sql` | protected | `QueryConsole` (exported as `SQLEditor`) | Monaco editor + ChatPanel + charts |
| `.../visualizer` | protected | `SchemaVisualizer` | ERD (xyflow) |
| `*` | public | `NotFoundPage` | 404 |

Route note: `/dashboard/connection/:id/sql` imports `SQLEditor` from `./pages`, but `src/pages/index.ts` re-exports `QueryConsole` under that name — so the **real** SQL page is `QueryConsole`, and the standalone `SQLEditor.tsx` (mock-data, Prism) is an **orphan** that nothing routes to. `AnalyticsPage.tsx` and `SettingsPage.tsx` exist but are **not routed**.

Role gate: `AdminOnlyUserManagement` redirects `role === 'viewer'` from `/dashboard/users` to `/dashboard/access`.

---

## 4. Layouts & navigation

- **`DashboardLayout`**: `AppNavbar` + collapsible `Sidebar` (collapsed by default) + `MobileNav` + `<Outlet/>`.
- **`ConnectionLayout`**: wraps `TableTabsProvider` + `QueryTabsProvider`; desktop `ConnectionSidebar` (searchable schema→table tree via `useTableTreeQuery`, column expand via prefetch), mobile `ConnectionMobileNav`, a sticky `ViewerExpiryBanner`.
- **`AppNavbar`**: logo, Cmd+K trigger, a schema-sync button on connection routes, user dropdown (super_admin sees user management).
- **`CommandKBar`** (`kbar`): Cmd/Ctrl+K palette; static actions + dynamic jump-to-table built from a prefetched `schema-metadata` blob cached under TanStack key `['kbar','fullSchema',id]`.
- Both layouts inject a **feedback widget from a hardcoded `http://localhost:7070/...`** (a dev-only artifact that will 404 in prod).

---

## 5. End-to-end wiring (how the two repos talk)

### 5.1 Session / auth handshake
- Axios client sets `withCredentials: true`; the backend issues an **HTTP-only cookie** `chatsql-access-token` (24h JWT). The frontend never sees or stores the token — there is **no `Authorization` header** on normal calls and **no localStorage token** (the AUTH_*.md docs describing localStorage tokens are stale).
- Bootstrap: `AuthContext` calls `GET /auth/me` on mount; re-checks on window focus, tab visibility, and every 60s while authenticated.
- 401 handling: an axios response interceptor dispatches a `window` event `auth:unauthorized`; `AuthRedirector` force-logs-out and navigates to `/auth/signin` preserving `state.from`.
- `ProtectedRoute` waits for `isLoading`, redirects to signin if unauthenticated, and pushes to `/auth/force-change-password` when `must_change_password` is set (invited viewers).

### 5.2 The core loop: connect → sync → work
```
[ConnectionsPage] AddConnectionDialog
   → POST /connections/test   (backend opens a throwaway conn to the user DB)
   → POST /connections        (backend encrypts creds, enqueues schema-sync job)
        │
        ▼  (backend BullMQ schema-sync worker introspects the user DB)
   SSE  GET /api/jobs/progress  ── progress/complete/error ──►  JobProgressContext
        │                                                       (toasts + TanStack
        ▼                                                        invalidation)
   on 'schema-sync complete' → invalidate ['schemas'],['tableTree'],['columns'],['erd'],['connections']
        │
        ▼
[ConnectionLayout]  ConnectionSidebar shows schema→table tree (now cache-warm on the server)
   ├─ TableView         → GET .../tables/:schema/:table/data  (server runs it via db-operations queue)
   ├─ QueryConsole      → POST .../:id/query                  (raw SQL, same queue)
   ├─ ChatPanel (Ask)   → POST .../chat/:id/stream            (SSE token stream)
   ├─ ChatPanel (Agent) → POST .../chat/:id/agent/start       (SSE) + approve/reject/result/stop (REST)
   └─ SchemaVisualizer  → GET .../relations                    (ERD edges)
```

### 5.3 Realtime transport = SSE everywhere (no WebSockets)
- **Job progress**: `useJobProgress` opens an `EventSource` to `{origin}/api/jobs/progress` (cookie-authed), handles `connected|progress|complete|error|ai-result`, reconnects with exponential backoff (max 5). On a `schema-sync` complete it invalidates the relevant TanStack keys so the sidebar/tables refresh automatically.
- **Chat (Ask mode)**: `chat.service.streamMessage` uses `fetch` + a `ReadableStream` reader to parse `data:` SSE frames from `POST /chat/:id/stream`, appending tokens live and rendering ```sql``` blocks via `SQLCodeBlock`.
- **Agent mode**: `useAgentChat` → `agent.service.startAgent` opens the agent SSE; the UI renders plan → proposal, lets the user approve/reject (optionally editing SQL), **executes the approved SQL itself** via the normal query endpoint through an `onExecuteQuery` callback, then POSTs the result back so the backend agent loop can continue or self-heal.
- **AI job stream**: `ai.service` can `EventSource` `/ai/stream/:jobId?token=…` with a polling fallback on `/ai/result/:jobId`. Because `EventSource` can't send headers, these endpoints accept the JWT as a **`?token=` query param** (the backend's `authenticate` middleware explicitly supports that) — convenient but a token-in-URL leak risk.

### 5.4 Data fetching & caching (client)
- **TanStack Query** is the server-state layer: connections, schemas, table-tree, columns, table data (`keepPreviousData` for pagination), ERD, analytics, usage, viewers, saved queries — each with explicit stale times. All keys/mutations/invalidations live in `src/hooks/useQueries.ts`.
- **localStorage** holds only UI prefs: open table tabs (`TableTabsContext`), query tabs minus results (`QueryTabsContext`), column widths/config, and the legacy ChatPage `dbSettings`.
- There is **no IndexedDB and no client `CacheManager`** — the "Cached" badge in `TableView` reflects the *server's* Redis cache (`cached` flag in the API response), not a browser cache. (The checklist items `useDatabaseCache`, `CacheManager`, `docs/CACHE_IMPLEMENTATION.md`, `DatabaseSidebar` don't exist in this repo.)

### 5.5 Contract details that couple the two repos
- **DB provider cards** (`AddConnectionDialog`) offer Supabase, RDS, PostgreSQL (→ `type: postgres`), MySQL (`mysql`), MongoDB (`mongodb`), Snowflake (→ `postgres`). But the backend create path hardcodes `type='postgres'` and every worker builds a Postgres Sequelize dialect — so **only PostgreSQL is truly supported end-to-end**; MySQL/Mongo/Snowflake are UI-only today.
- **Checkout** posts `pro_monthly | pro_yearly | lifetime` to `/payments/checkout`; the backend maps those to Dodo product IDs. (Some UI copy says "Stripe" but the backend integration is Dodo Payments.)
- **Read-only mode**: `TableView`/`QueryConsole` gate writes on `useReadOnlyStatusQuery` (`GET /payments/read-only-status`), matching the backend's free-tier exhaustion logic.

---

## 6. Feature areas (implemented vs legacy/planned)

**Implemented and wired (high confidence):** cookie auth (login/OTP/reset/force-change), connection wizard + test + CRUD, async schema sync with SSE progress, table browse + inline edit/insert/delete with filters (`AdvancedFilterBuilder`, `WhereClauseEditor`, `TableSearchBar`, `ColumnManager`) and column-width persistence, Monaco `QueryConsole` with schema-aware autocomplete + saved queries + result charts + `QueryExecutionLog`, ChatPanel Ask + Agent over SSE, ERD visualizer, viewer/RBAC management + expiry banner, usage/billing/checkout, Cmd+K, landing + pricing.

**Legacy / scaffold / dead:**
- `/chat` `ChatPage` + `DBSettingsModal` + `SampleQueries` — the original URI-in-localStorage flow calling `POST /api/getResult` (pairs with the backend's dead legacy routes).
- Orphan `SQLEditor.tsx` (mock data), unrouted `AnalyticsPage.tsx` and stub `SettingsPage.tsx`.
- Two extra landings (`FuturisticLanding` `/landing`, Hexora `/hexora`) — brand experiments.
- Dual toast libraries; both `@dnd-kit` and `react-dnd`.
- Stale docs: `AUTH_*.md` (mock/localStorage), `UI_FRONTEND_SPECIFICATION.md` (URI connections), `DASHBOARD_IMPLEMENTATION_PLAN.md` (zustand, `/analytics`, `/settings`).

---

## 7. Landing-page positioning (verbatim, `ChatSQLLanding.tsx`)

- H1: **"Your database, fluent in human."**
- Sub: "Stop writing boilerplate SQL. Ask questions in plain English — get optimized queries, live schema maps, and instant dashboards."
- Badge: "v2.0 — Now with real-time schema sync"; trust line "No credit card · 14-day trial".
- Stats (marketing, not telemetry): **10k+** active developers, **2M+** queries generated, **99.9%** uptime SLA; "Join 10,000+ developers…".
- Features: Natural Language Querying, Schema Visualization, Real-time Sync, Enterprise Security ("SOC2 Type II… data never trains our models"), Query History & Exports.
- Social proof logos: Amazon, Google, Microsoft, Nike, Coinbase ("Trusted by engineering teams worldwide").
- Pricing shown: **Free $0**, **Pro $10/mo ($8/yr equiv)**, **Lifetime $100 one-time**, **Enterprise custom** — CTAs to `/auth/signup`; Enterprise → `/contact?plan=enterprise`.

These claims (SOC2, named-company logos, 10k+ users, 99.9% SLA) are **aspirational marketing copy** in a pre-launch/solo-built product; the PRD flags them as needing substantiation before real go-to-market.

---

## 8. End-to-end sequence: "show me last week's signups" (Ask mode)

1. User opens `/dashboard/connection/:id/sql`, types the question in ChatPanel, mode = Ask.
2. Frontend `POST /chat/:id/stream` (cookie auth). Backend verifies access (owner or viewer `can_use_ai`), gets/creates a `chat_session`, saves the user message.
3. Backend loads last 10 messages + cached schema summary, runs **fast-tier intent classification** → `sql_generation`.
4. Backend streams SQL generation (balanced tier, Anthropic-preferred) as SSE `content` frames; frontend renders tokens live, extracts the ```sql block into a `SQLCodeBlock` with a Run button.
5. Backend persists the assistant message, logs token usage to `ai_token_usage` + increments `user_plans.ai_tokens_used`, sends a final `done` frame (messageId, sql, tablesUsed, model).
6. User clicks **Run** → frontend `POST /connections/:id/query` with the SQL (+ `chatMessageId`). Backend enqueues a `db-operations` raw-SQL job, runs it against the user's DB read-only, returns rows; the result is also stitched back onto the chat message and written to `queries` history.
7. Frontend renders the result grid + optional Chart.js visualization; `QueryExecutionLog` records status/duration.

Agent mode differs at step 4+: the backend plans multiple steps and waits for per-step approval, the frontend runs each approved step and reports results back, and the backend self-heals on errors (≤3 retries).

---

## 9. Frontend-specific gaps / debt (for the PRD & cleanup backlog)

- Bolt scaffold identity not cleaned (`vite-react-typescript-starter`).
- Hardcoded localhost feedback widget in both layouts (breaks/404s in prod).
- Orphan `SQLEditor` mock + unrouted Analytics/Settings pages → confusing dead code.
- MySQL/Mongo/Snowflake advertised in the connect wizard but backend supports Postgres only.
- Landing "Stripe" wording vs actual Dodo Payments; SOC2/logos/10k-users claims unverified.
- Two landing experiments and two toast systems increase surface area.
- Auth/UI markdown docs contradict the shipped implementation (should be rewritten or deleted).

---

## 10. Deployment & runtime summary

- **Frontend**: Vite build → Vercel, SPA rewrite (`vercel.json`). Config via `VITE_API_URL`.
- **Backend**: EC2 + PM2 (GitHub Actions self-hosted runner, `.env` from `secrets.PROD`), Express on `api.sql.bizer.dev`; Postgres app DB, Redis, SMTP (Brevo), Dodo Payments, BetterStack.
- **Cross-origin**: cookie session with `credentials: true` and CORS locked to the frontend origin(s); SSE endpoints accept `?token=` for `EventSource`.
- **Prod domains**: app `sql.bizer.dev`, API `api.sql.bizer.dev`.

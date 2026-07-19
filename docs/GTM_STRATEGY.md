# ChatSQL — GTM, Open-Core & Launch Strategy

> Status: proposed commercial strategy, v2. Pairs with `PRD.md` (as-built), `BACKEND_PLATFORM_MASTER_PLAN.md` (rewrite), and `PRODUCT.md` (brand/positioning).
>
> Operating principle: **sell first, build in parallel.** Two-founder split — one sells full-time, one builds full-time — so the rewrite no longer waits on revenue gates; instead it is scope-gated (a 2-week v1 slice, §4.4) and the selling starts on day one.
>
> Team: two technical cofounders, both currently at the same YC company. Founder A (GTM lead) — Technical Lead there, oversees architecture as senior engineer, sells to fellow developers, and is himself the first power user. Founder B (founding engineer) — builds the new platform.
>
> **Customer Zero:** that YC company is deliberately the first deployment — the team already uses Cursor, Claude Code, *and* Codex daily, making it a perfect gateway test bed. One structured week of real usage produces the demo material, case study, and numbers used in every pitch (§7.1). Preconditions: written permission from company leadership for both the tool-on-company-data and the side venture itself (check PIIA/IP-assignment terms); staging or read-only replica first; schema-only to LLMs, never customer rows.

---

## 1. Executive verdict

1. **Open source + managed cloud is the right model for this category — but sequenced, not simultaneous.** The AI-SQL-client category is already open-source-led (Chat2DB: Apache-2.0, 30k+ stars, ~1M users; WrenAI, Vanna, DBeaver, Beekeeper). A closed-source web app that asks developers for production database credentials is structurally disadvantaged on the #1 objection: trust. Open source is the trust answer *and* the distribution engine. But do not open-source the current codebase — it has known security holes and would not survive public scrutiny. Sell the cloud product now; open-source the **rewrite** (which is designed with clean boundaries) as a deliberate launch weapon.
2. **The backend rewrite runs in parallel, scope-gated instead of revenue-gated.** Founder B builds a deliberately thin v1 slice of the master plan — the Go gateway + MCP server + policy/audit plane — targeted at **2 weeks**, while the existing app keeps serving users and revenue. The full master plan (Temporal, multi-AZ, blue/green, regional cells) stays the north star but is explicitly *not* the 2-week target; the web workspace migrates to the new platform in waves afterwards. Slip rule: if the v1 slice isn't demoable in 4 weeks, cut scope again — never extend the cave. P0 security fixes on the current stack happen first, in days, regardless (§7).
3. **Position as the one database tool for the AI-coding era — not a chatbot for your DB.** The pitch: *your AI coding tools (Cursor, Claude Code, Codex) already read and write your database — ChatSQL is where you see, gate, and audit every query they run, and the workspace you open when you want to look at the data yourself.* The trust pipeline (schema grounding → AST policy → approval → audit → scoped sharing) now covers **two clients: humans and agents**. The MCP gateway is the wedge and goes in every pitch from day one.
4. **First revenue comes from developers already using AI coding tools against real Postgres (Supabase/Neon/RDS), then ≤10-person teams and agencies.** Founder A sells into his own peer network first. Enterprise is a later act, after SOC2/SSO exist.
5. **The UI bar is explicit: good enough that users never reopen DBeaver/DataGrip.** The visualizer/table browser/editor is not a side feature — it is the retention product (§3.6).

---

## 2. Strategic context (what we have)

| Asset | State |
|---|---|
| Working product | Chat (NL→SQL, streamed, schema-grounded), agent with per-step approval + self-heal, Monaco editor, table CRUD, ERD, viewer RBAC with expiry, Dodo billing. Postgres only. |
| Known debt | P0 security list in `PRD.md` §10 (unauthenticated legacy routes, unverified payment webhooks, viewer permission bug, plaintext OTP, SMTP env mismatch). Landing page claims (SOC2, logos, "10k+ devs") are unbacked. |
| Rewrite plan | `BACKEND_PLATFORM_MASTER_PLAN.md`: TS control plane + Go DB gateway + Temporal, ECS/RDS/Valkey/WorkOS/KMS. ~12 Fargate tasks baseline (~$900–1,400/mo infra floor, estimate). |
| Brand | "ChatSQL" live; "Hexora" rebrand drafted in UI docs. Note: `HEXORA_LANDING_PLAN.md` includes a fake logo ticker (Coinbase, Zoom) — this directly violates the honesty principle in `PRODUCT.md` and must not ship. |
| Repo state | **Both repos are already public on GitHub** (`ayan-mn18/ChatSQL`, `ayan-mn18/ChatSQL-ui`) with no LICENSE file, an MIT badge in the README, `ISC` in `package.json`, and an "Open source" claim in the landing footer. Legally this is "all rights reserved" with contradictory signals — and the code containing the known-vulnerable routes is readable by anyone while the same code runs live at `api.sql.bizer.dev`. |

**Naming decision (recommendation):** launch and sell as **ChatSQL**. Descriptive names win in AI-tool directories and search ("chat sql", "chatgpt for postgres"). Revisit a brand name only at the open-source launch, when a memorable name has compounding value. Do not spend cycles on rebranding before revenue.

---

## 3. Core, MVP, and differentiation

### 3.1 The core (what the company is actually about)

> **One database tool for the AI-coding era: every human and every AI agent goes through the same governed door — visible SQL, server-enforced policy, approvals, audit — with a workspace so good you never reopen a desktop GUI.**

Three pillars, in pitch order:

1. **Agent access plane (MCP gateway)** — Cursor, Claude Code, and Codex connect to your database *through ChatSQL* instead of holding raw credentials. Every query any agent runs is logged per tool and per session, read-only by default, writes escalate to human approval, dangerous statements are flagged by the AST policy. You finally know what your coding agents are doing to your database.
2. **Human workspace** — the visualizer, table browser/editor, Monaco SQL editor, ERD, and schema-grounded AI chat/agent, in the browser. When you want to open the DB and look, this is where you look — and the same audit trail covers you.
3. **Team access layer** — scoped, time-boxed, credential-free sharing for teammates and contractors.

Mechanics under all three (unchanged): synced-schema grounding, one AST-parse policy decision per statement, server-side read-only enforcement, per-step approval, attribution for everything.

### 3.2 The MVP (sell-first cut)

The MVP is **the current product after the P0 fixes** — nothing more. Feature inventory already exceeds a normal MVP. Explicitly deferred until revenue proves demand: MySQL/Mongo/Snowflake (remove from the connect wizard rather than promise), dashboards/BI, scheduled reports, SSO, desktop app, the full rewrite.

The activation bar that defines "MVP works": a new user connects a real database and gets a correct plain-English answer in under 5 minutes, then returns the next week. Instrument this from day one.

### 3.3 Differentiation map

| Competitor class | Examples | Their strength | ChatSQL's wedge |
|---|---|---|---|
| Classic desktop GUIs | TablePlus, pgAdmin, DBeaver, Postico, DataGrip | Mature, fast, trusted, offline | Web + zero install; AI grounded in synced schema; sharing without credentials; usable by non-SQL teammates |
| Modern desktop + self-host ("DB Pro" class) | **DB Pro** (desktop $49–99 one-time + self-host Studio, BYOK AI, dashboards), Beekeeper Studio | Polish, local-first, BYOK privacy story, one-time pricing | Multi-tenant team layer: RBAC, time-boxed viewers, server-enforced policy, approval-gated agent, managed AI (no key setup). DB Pro's AI is a client-side assistant; ChatSQL is a governed service. |
| Open-source AI SQL clients | **Chat2DB** (30k+ stars, 30+ DBs), WrenAI, Vanna (framework) | Free, huge community, DB breadth | Postgres depth over breadth; trust pipeline (approval, server-side read-only, audit); team sharing; English-first community and cloud UX |
| Cloud DB consoles | Supabase Studio AI, Neon SQL editor | Bundled, free, zero setup | Provider-agnostic (any Postgres, and later any DB); cross-connection workspace; agent + viewer RBAC; consoles serve only their own hosted DBs |
| Raw AI + MCP | Claude/Cursor + Postgres MCP, psql + LLM | Free, developer-native, improving fast | **This is now our wedge, not our threat.** Raw MCP servers hand agents naked credentials: no approvals, no per-tool audit, no anomaly flags, no scoped access, silent writes. The ChatSQL MCP gateway is the drop-in replacement — same MCP config line in Cursor/Claude Code/Codex, but every query becomes visible, policied, and attributable. Ships in the rewrite v1 slice (§4.4). |
| Lightweight BI | Metabase, Retool, Basedash-style tools | Dashboards, org-wide reporting | Operator-centric (edit rows, run SQL, agent tasks) not dashboard-centric; 10× cheaper; AI-first |

**One-line positioning per audience:**
- Developer using AI tools: *"Point Cursor and Claude Code at your database through ChatSQL — see every query they run, block the dangerous ones, approve the writes."*
- Developer at the keyboard: *"The Postgres workspace good enough to retire your desktop GUI — browser, editor, ERD, and AI that shows its SQL."*
- Team lead: *"Give anyone — human or agent — safe, scoped, expiring access to prod data. No shared credentials, no ticket queue."*
- Investor: *"The governed access layer between AI agents, teams, and production databases."*

### 3.5 The MCP gateway (v1 spec + pitch)

What ships in the rewrite v1 slice:

- **One MCP endpoint per connection**, added to Cursor/Claude Code/Codex with a single config block — identical setup effort to the raw Postgres MCP servers it replaces.
- **Scoped agent tokens**: each tool/machine gets its own token with a permission profile (default read-only, row/byte caps, schema allow-list). Revoke one tool without touching the others.
- **Write escalation**: DML/DDL from an agent parks as a pending approval in the workspace (and later Slack); the human sees the exact SQL, approves or rejects; the agent gets the result. Same approval machinery the chat agent already uses.
- **Per-agent execution log**: every statement attributed to tool + session + repo, with AST fingerprint, rows touched, duration. The "what did my agent do to the DB last night" screen — this is the demo that sells.
- **Policy flags**: AST-detected dangerous patterns (unbounded UPDATE/DELETE, DROP/TRUNCATE, permission changes, full-table scans on large relations) flagged in the log even when allowed, blocked when policy says so. Honest framing: rule-based flags first; ML anomaly detection is roadmap, never claim it early.
- **Schema tools**: agents get the synced catalog (tables/columns/FKs) as MCP resources, so they stop hallucinating schema — a direct code-quality win the developer feels immediately.

Pitch lines that follow: "Your AI already has your database password. ChatSQL takes it back." / "Cursor writes the migration; you approve the ALTER." / "One log of every query — yours, your team's, your agents'."

### 3.6 The UI bar: never reopen DBeaver

"Better UI than DBeaver/DataGrip" is a product gate, not a slogan. Concretely: sub-100ms perceived table paging (keyset pagination is already in the master plan), keyboard-first everything (Cmd+K exists — extend to grid navigation, inline edit, query run), an ERD people screenshot for docs, dark/calm/precise per `PRODUCT.md`, and zero modal-hell. Acceptance test per release: a developer with DataGrip open completes browse → filter → edit → query → share faster in ChatSQL, in the browser. The known escape-hatch cases (deep query plans, vendor-specific admin) are acceptable losses — measure "% of users who also ran a desktop GUI this week" and drive it down.

### 3.4 Moat, honestly (and how to build it)

Today there is no moat; there is a head start on a workflow. Build these three, in order:

1. **Workflow lock-in** — saved queries, approval policies, viewer grants, audit history make ChatSQL the system of record for *how the team touches the database*. Leaving means re-provisioning access for everyone. (Strongest, nearest.)
2. **Per-tenant data flywheel** — approved/edited/rejected SQL per schema is proprietary feedback that improves retrieval and generation for that tenant. A competitor starting fresh on the same schema is measurably worse. Log this signal from day one even before using it.
3. **Distribution via open source + ecosystems** — community, Supabase/Neon integration listings, comparison SEO. Owning the "safe AI DB access" niche is itself defensible.

Model risk is already mitigated: three-provider factory, model as swappable component — say exactly this to investors.

---

## 4. Open source + managed cloud: the decision

### 4.1 Should we? Yes — with evidence

- Category proof: Chat2DB converted OSS scale into a commercial product; DB Pro leads with a free self-host Studio; WrenAI/Vanna own the framework mindshare. OSS is how developer trust is manufactured in this exact market.
- Trust proof: the #1 objection is "you want my prod credentials?" Self-hostable core + BYOK kills the objection outright.
- Economics proof: open-core free→paid conversion is 0.5–2%, and managed hosting is typically 60–70% of open-core revenue. The model works when the funnel is large — which is exactly what OSS distribution buys and paid CAC cannot (at our budget).
- Fundraising proof: star growth and community adoption are traction signals accelerators accept pre-revenue.

Costs to accept: maintaining two editions (community + cloud/EE), slower short-term revenue than pure SaaS, support burden, copycats. Mitigation is sequencing (§4.3) and license choice (§4.2).

### 4.2 License and edition split

- **Community (open source): AGPL-3.0.** Full single-workspace core: chat (BYOK), SQL editor, table browser/editor, ERD, agent with approvals, single-admin sharing. AGPL blocks a cloud vendor from reselling the hosted product without contributing back — the "what stops AWS" answer.
- **Enterprise code: `/ee` directory, commercial license** (PostHog/GitLab pattern): SSO/SAML, SCIM, advanced RBAC and audit export, multi-workspace administration, private-network connector.
- **Cloud (managed):** hosting, managed AI tokens (no key setup), team features, backups, SLA. Sells convenience + team, not artificially crippled core.
- Sign a CLA from contributors so dual-licensing stays possible.

What must stay monetizable regardless of edition: **team/RBAC at scale, SSO/audit, managed AI, hosting.** Never gate basic usability (community backlash) — the free core must be genuinely excellent or the whole motion fails.

### 4.2b Immediate license cleanup (the repos are already public)

The sequencing below assumed a closed codebase; in reality both repos are public today with no license and known vulnerabilities visible in source next to a live deployment. Resolve within days, one of two ways:

- **Recommended: take both repos private now.** No community exists yet, so nothing is lost; it removes the "read the exploit in the source" exposure while P0s are open, and it preserves the OSS launch as a clean future event with the rewrite.
- Alternative (if public history matters to you): fix P0s first, then add an explicit `LICENSE` (AGPL-3.0) and make the MIT badge / `ISC` field / footer claim consistent.

Either way, never advertise "open source" in the footer until a real license file exists — an unlicensed public repo is not open source, and developers in this ICP check.

### 4.3 Sequencing (this is the key decision)

| Phase | What | Why |
|---|---|---|
| Now → month 3 | Closed-source cloud + gateway. Fix P0s, sell, validate pricing, get to first paying customers | Revenue validation needs no OSS; current code can't survive public audit |
| Week 1+ (parallel) | Rewrite v1 slice builds immediately (§4.4); narrate it **in public**: architecture posts, ADRs, benchmarks on X/HN/blog | The build starts day one with Founder B; the content (Go gateway, AST policy, agent governance) builds audience before the repo opens |
| Rewrite core usable | **OSS launch = Show HN + PH relaunch.** AGPL repo, one-command `docker compose up`, BYOK, no-signup demo | The single biggest distribution event available to us; HN's exact taste: self-hosted, AGPL, Go, honest write-up |
| Post-OSS | Cloud = default funnel end; `/ee` for teams; community connectors via the adapter interface | Compounding loop |

### 4.4 Rewrite v1 slice (parallel build, 2-week target)

The master plan remains the north-star architecture. It is **not** the 2-week target — attempting all of it at once is how a 6-month cave happens. Founder B builds this slice, Founder A reviews weekly against demos:

**In the v1 slice (target: 2 weeks, hard stop at 4):**

| Piece | Scope decision |
|---|---|
| Monorepo + contracts | `chatsql-platform` repo per master plan §21; protobuf/OpenAPI from day one (cheap now, expensive later) |
| Control plane | TypeScript Fastify, WorkOS AuthKit (fast to integrate, buys SSO path), org-scoped RLS on app DB |
| DB gateway | Go + `pgx` + `pg_query` AST policy, bounded streaming, cancellation — the heart of the plan, non-negotiable |
| **MCP server** | Built into the gateway: scoped tokens, read-only default, write escalation → approval, per-agent execution log, policy flags (§3.5). **This is the new pitch surface — it ships first** |
| Credentials | KMS envelope encryption per plan (or libsodium envelope with the same interface if KMS slows week one) |
| Audit + executions | App-DB tables + outbox; the per-agent log is a product feature, not just ops |
| Catalog sync | Simplest durable version: job table + worker (`graphile-worker`), immutable snapshots as designed |
| Deploy | One region, plain ECS or Fly/Railway, Docker Compose for local/self-host. No blue/green, no multi-AZ yet |

**Explicitly deferred (adopt later per the master plan's own gates):** Temporal (graphile-worker until agent workflows demand durability), multi-AZ/blue-green/regional cells, exports-to-S3 pipeline, OpenSearch/ClickHouse-anything, private-network connector, SOC2 tooling.

**Migration reality check:** the 2-week slice does *not* migrate the web workspace. The existing app keeps serving users and revenue untouched; the new platform launches as the **additive MCP gateway product** pointed at the same connections. The web workspace then migrates to the new backend in waves (realistically 4–8 further weeks), per the master plan's parallel-migration phases. This is what makes "rewrite in two weeks" true instead of optimistic: two weeks buys the new *pitch surface*, not a full transplant.

**Self-host stays a first-class build target.** Docker Compose deployment, local auth fallback behind the WorkOS interface, OSS-friendly key handling — decided now, before the code exists, so the community edition (§4.3) is a packaging exercise rather than a second rewrite.

---

## 5. Who to reach out to (ICP) and what to say

### 5.1 ICPs in priority order

| # | ICP | Where they are | Trigger pain | Message | Willing to pay |
|---|---|---|---|---|---|
| 0 | **Developer running Cursor / Claude Code / Codex against a real database** (Founder A's own peer network — start here) | Cursor/Claude/AI-coding communities, X, HN, r/cursor, YC company Slacks, colleagues | Agent has raw DB credentials; no idea what it ran; one bad migration away from disaster; MCP setup is DIY | "Your AI already has your database password. ChatSQL takes it back — every agent query logged, writes need your approval." | $15–25/mo, immediate — pain is fresh and unserved |
| 1 | Indie hacker / solo founder on Supabase, Neon, RDS | X (build-in-public), Indie Hackers, r/Supabase, r/SideProject, Supabase & Neon Discords | Pastes schema into ChatGPT; tab-hops GUI ↔ AI; fears prod writes | "Stop pasting your schema into ChatGPT. Ask your DB directly — and approve the SQL before it runs." | $10–15/mo fast, lifetime deals very well |
| 2 | Founding engineer at a ≤10-person startup | Same + YC/startup Slacks, HN | Non-SQL cofounder/PM keeps asking for data; won't share credentials | "Invite your cofounder with read-only, expiring access to exactly three tables. No credentials, no tickets." | $10–25/seat |
| 3 | Dev agencies / freelancers managing client DBs | Peerlist, r/webdev, agency communities, Upwork forums | Client wants data visibility; contractor offboarding = credential rotation nightmare | "Time-boxed client access that expires itself. Look professional, stay safe." | $25+/seat, multiple workspaces — best early $ |
| 4 (later) | Data-adjacent operators (PM/ops) | Arrive via invites, not marketing | Blocked on analysts | Product-led: the invite *is* the acquisition | Seat expansion |

### 5.2 Discovery/sales questions (ask these before building anything else)

Validation interviews (20–30 of them, ICP 1–3):

1. Walk me through the last time you needed something from your production DB. What did you actually do?
2. What tool opens when you think "I need to look at the database"? What do you hate about it?
3. How often does someone non-technical ask you to pull data? What happens then?
4. Have you pasted schema or query results into ChatGPT/Claude? Any hesitation?
5. Would you connect a read-only role of prod to a web tool? What would you need to see to trust it? (Listen for: self-host, encryption, approval gates, audit.)
6. What would this have to do for you to pay $15/month **today**? (Not "would you pay" — "what would make you pay.")
7. If ChatSQL vanished in 6 months, what would you go back to, and what would you miss? (Stickiness probe.)
8. Who else on your team would touch this? (Expansion probe.)
9. Price framing: at what monthly price is this obviously cheap? Expensive but worth it? Insultingly expensive? (Van Westendorp lite.)

ICP 0 (AI-coding) additions:

10. Does Cursor/Claude Code have access to a real database right now? How did you set that up, and what can it do? (Listen for: raw connection string in MCP config, write access nobody remembers granting.)
11. Have you ever checked what queries your agent actually ran? Could you, if you had to?
12. Has an agent ever run something against your DB that scared you — or would you even know?

Log every objection verbatim. The objection list becomes the landing page FAQ and the accelerator Q&A.

### 5.3 Channels, ranked by expected ROI

1. **Founder-led build-in-public** (X + Indie Hackers): free, compounding, feeds every launch. Post real product clips: question → SQL → approve → rows.
2. **Supabase/Neon ecosystems**: Discord presence (help, don't shill), then apply to the Supabase integrations marketplace and Neon's integration listings. These are ICP-pure channels.
3. **Comparison & intent SEO**: "TablePlus alternative in the browser", "Chat2DB vs ChatSQL", "DB Pro vs ChatSQL", **"Outerbase alternative"** (Outerbase was acquired and shut down — its searchers are homeless and high-intent), "ChatGPT for Postgres", "safely let AI query production database".
4. **Launch platforms** (§8): Product Hunt, Show HN (reserved for OSS), Peerlist Launchpad, DevHunt, Uneed, alternativeto.net.
5. **Niche sponsorships once revenue exists**: Postgres Weekly, Console.dev, TLDR (dev tools tier) — cheap, hyper-targeted.
6. **Public demo instance** (sample database, zero signup): converts every channel better; HN will not tolerate a signup wall.

---

## 6. Pricing (revisions to current plans)

| Tier | Price | Contents | Change vs today |
|---|---|---|---|
| Community (OSS) | $0 self-host | Full core, BYOK AI, single workspace | New (at OSS launch) |
| Cloud Free | $0 | 2 connections, 10k AI tokens/mo, **1 MCP agent token**, read-only on exhaustion | Add limited gateway access — hooks ICP 0 |
| Cloud Pro | **$15/mo** ($12/mo annual) | 100k tokens + **BYOK for unlimited**, 10 connections, **unlimited agent tokens + execution log**, saved queries/history | Raise from $10; gateway included — note gateway COGS ≈ 0 (agents bring their own model; we meter executions, not tokens) |
| Cloud Team | **$25/seat/mo** | Everything in Pro + viewer RBAC at scale, expiring invites, **team-wide agent audit**, activity log, priority support | New tier — sharing + governance is the team feature |
| Founding member (limited) | **$149 one-time, 100 seats max** | Pro-for-life with 200k tokens/mo cap + BYOK | Replaces $100 unlimited lifetime, which is an LLM-COGS time bomb |
| Enterprise / EE | From ~$500/mo, sales-led | SSO/SAML, SCIM, audit export, self-host EE, private connector | Only after SOC2 + SSO exist; today's "Enterprise" page is lead capture only |

Rules: grandfather existing customers forever (trust brand). Managed AI tokens are metered with hard caps — never "unlimited" on a subscription. BYOK is the pressure valve that makes caps palatable.

---

## 7. Sell-first plan (first 90 days)

**Non-negotiable precondition — security fixes before charging money at scale.** The following are live risks (from `PRD.md` §10 plus the code audit) and must be closed first: enable Dodo webhook signature verification; delete the unauthenticated legacy routes that accept raw DB URIs and use string-interpolated SQL; fix the viewer permission column bug; stop storing OTP codes in plaintext; **move agent SQL execution server-side** (today the browser executes agent SQL and reports the result — a client can forge outcomes); stop passing JWTs in SSE query strings; enable TLS certificate verification (`rejectUnauthorized` is currently false); close the SSRF surface on connection targets (loopback/metadata/private ranges); fix the SMTP env mismatch; schedule `reset_monthly_usage()`. Also remove unbacked landing claims (SOC2 badge, fake logos, invented user counts) and resolve the public-repo license exposure (§4.2b). Estimated effort: days, not weeks — but all of it before scale-selling.

Two tracks run in parallel from day one. Track A = Founder A (P0s, then Customer Zero, then selling); Track B = Founder B building the v1 slice (§4.4). Selling starts with demo material from real usage, not slideware.

| Week | Track A — dogfood & sell (Founder A) | Track B — build (Founder B) | Target |
|---|---|---|---|
| 1 | **P0 fixes** (split with B), honest landing, repos private, analytics events; **get written company sign-off**; onboard the YC company on the current product — staging DB first, then scoped read-only prod | Platform repo, contracts, control plane skeleton, Go gateway + AST policy | P0s closed; Customer Zero live |
| 2–3 | **Dogfood sprint** (§7.1): whole team uses it daily; the moment the gateway is demoable, wire Cursor + Claude Code + Codex through it at the company; capture metrics, screenshots, quotes | **MCP server demoable**: scoped token, execution log, write escalation → hand to Customer Zero immediately | Gateway running against real work; capture checklist filling |
| 3–4 | Cut demo assets from real usage (§7.1); pre-sell from the demo video: founding-member $149 capped deal + gateway waitlist; start 25 discovery interviews in AI-coding + Supabase communities | Gateway beta hardening from Customer Zero feedback; catalog sync; public no-signup demo | Demo video live; 20-person waitlist; first 5 paying |
| 4–6 | Soft launch: Indie Hackers, X thread, r/cursor + AI-tool communities, Peerlist — every post anchored on the real case study | Iterate on dogfood findings; migration waves begin | First 10–15 paying |
| 5–8 | Agency pre-sell (5 design-partner slots at $500/yr prepaid); comparison pages live ("Outerbase alternative", "raw Postgres MCP vs ChatSQL gateway") | Web-workspace migration waves continue | 2–3 design partners |
| 6–10 | **Product Hunt launch #1: the MCP gateway angle**, demo = the real Customer Zero footage | UI polish sprint toward the §3.6 bar | Top-10 day; 300+ signups; 25+ paying |
| 8–12 | Double down on converting channel; build-in-public posts; accelerator applications with growth chart + case study | Workspace fully on new platform; OSS packaging prep | $1–2k MRR; Show HN (OSS) scheduled |

### 7.1 Customer Zero playbook (the YC company)

Preconditions (do not skip): written permission from founders/CTO covering tool-on-company-data **and** the cofounders' side venture; PIIA/IP-assignment terms reviewed; staging or read-only replica first; prod only via a scoped read-only role; schema-only to LLM providers, never customer rows.

**Capture checklist during the dogfood sprint** — these numbers are the pitch:

- Baseline first: how the team answers data questions today (tool, minutes, who gets asked).
- Gateway: agent queries/day per tool (Cursor vs Claude Code vs Codex), write escalations triggered, dangerous-statement flags caught, schema-hallucination fixes observed.
- Workspace: queries run, tables edited, viewers invited, desktop-GUI opens per week (the §3.6 metric).
- Qualitative: verbatim quotes from teammates; the single best "it caught something" story.

**Demo assets out the other side:** a 3-minute real-usage video (sanitized data), case study #1 — "A YC company's eng team routed Cursor, Claude Code, and Codex through one governed gateway" — a CTO/founder quote, and honest numbers for the landing page. Disclosure rule per `PRODUCT.md`: always say Customer Zero is the founders' own employer. It still lands — "we bet our own company's database on it" is a claim none of the competitors can make.

Pre-selling rule: it is fine to sell the roadmap (Team tier, MySQL) at a discount **with money collected** — a design partner who prepays $500 is validation; a "sounds cool" is not. It is not fine to sell SOC2 or uptime that doesn't exist.

Metrics dashboard from day one: signups; activation rate (<5 min to first correct answer); WAU; week-4 retention; free→paid %; MRR week-over-week; viewer invites per workspace (viral coefficient); LLM COGS per user; churn reasons verbatim.

---

## 8. Launch playbook (Product Hunt and friends)

Run launches as a **cadence, not an event** — every 4–8 weeks something launches somewhere.

### 8.1 Product Hunt — launch #1 (cloud product)

- **Prep (2–3 weeks):** "Coming soon" teaser page on PH to collect followers (aim 200+); 45–60s demo video (real flow: question → streamed SQL → approve → rows → invite viewer; no stock footage, no fake numbers); gallery of 5 real screenshots; maker story comment drafted; line up 20–30 genuine supporters to engage (never coordinate upvote rings — PH filters them and it kills the listing).
- **Day:** launch 12:01 AM PT, Tuesday–Thursday. Maker comment = honest founder story + what's deliberately not built yet. Reply to every comment all day. PH-exclusive offer: 30–50% off first 3 months.
- **Positioning on PH:** lead with the approval-gated agent and credential-free sharing (novel), not "AI SQL" (saturated tagline).
- **Realistic goal:** top 10 of the day; 300–800 visits; the durable value is the badge, backlink, and follower base for launch #2.

### 8.2 Show HN — reserved for the OSS launch

This is the highest-value card we hold; do not waste it on the closed cloud app.

- **When:** the rewrite's community edition runs with one `docker compose up` and a no-signup hosted demo exists.
- **Title:** `Show HN: ChatSQL – open-source AI Postgres workspace with approval-gated agent`
- **Timing:** Tuesday–Thursday, 8:00–11:00 AM ET; be present for 3+ hours; reply to everything, especially teardowns.
- **First comment:** the technical story HN wants — Go gateway with `pg_query` AST policy instead of regex guards, per-step human approval, Temporal for durable agent state, AGPL reasoning, honest limitations (Postgres-only, what's in `/ee` and why). Trade-offs stated plainly outperform marketing.
- **Repo readiness:** excellent README with architecture diagram, 5-minute quickstart, `good-first-issue` labels, demo GIF, security policy.

### 8.3 Secondary platforms

| Platform | When | Note |
|---|---|---|
| Peerlist Launchpad | With soft launch | Strong India dev community; weekly ranking; low effort |
| DevHunt, Uneed, Fazier | Week after PH | Dev-tool directories; backlinks + steady trickle |
| alternativeto.net | Immediately | List as alternative to TablePlus, Outerbase (dead), DB Pro, Chat2DB |
| There's An AI For That + AI directories | Immediately | Cheap discovery for "AI SQL" queries |
| Supabase integrations / Neon partners | After OAuth-ish polish | Highest-quality channel of all; treat as a product feature |
| G2 / Capterra | After ~20 customers | Ask happy users for reviews; needed for team/enterprise credibility later |
| PH launch #2 | OSS release or major version (6+ months later) | Relaunches are allowed and effective for major versions |

---

## 9. Scaling strategy (after initial traction)

Three compounding loops, invested in this order:

1. **Sharing loop (built-in virality):** every invited viewer experiences the product and is a future admin at their next company. Reduce invite friction; add "powered by ChatSQL" on viewer surfaces; measure viral coefficient.
2. **Open-source loop:** self-hosters → cloud converts (0.5–2%) + contributors. The rewrite's database-adapter interface is the community-contribution magnet: let the community build the MySQL/MariaDB/SQLite connectors while the core team owns Postgres depth.
3. **Content/SEO loop:** every discovery-call objection becomes an article; comparison pages; a public cookbook of real queries ("find users who churned after trial" etc.) that ranks and demos the product inline.

Sequencing: dominate the Postgres + Supabase/Neon niche → MySQL (highest-demand second dialect, unlocks huge agency market) → decide deliberately between warehouse direction (BI-adjacent, competitive with Wren/Cortex) vs staying the operational-DB access layer (recommended). Enterprise motion (SSO, audit, SOC2, private connector) only when inbound pipeline justifies it — the rewrite architecture already anticipates all of it (WorkOS SSO path, audit plane, connector repo).

Team: two cofounders carry it to ~$15–20k MRR (one sells, one builds — clean split, no coordination tax). First hire: product engineer to own the workspace UI while Founder B owns the platform. SOC2 Type I at enterprise-pipeline stage (~$20–40k with automation vendors) — not before.

---

## 10. Accelerators

### 10.1 Where to apply

| Program | Fit | Note |
|---|---|---|
| Y Combinator | Best brand, AI-native thesis fit | Solo founder accepted but harder; apply with 6–8 weeks of sell-first data and a week-over-week growth chart |
| Neo Accelerator | Strong for devtools | Smaller, high signal |
| Peak XV Surge / Together Fund / Antler India / 100x.VC | India-based options (founder timezone) | Together is devtools-focused — strong fit; Surge wants some revenue evidence |
| EF (Entrepreneur First) | If seeking a cofounder deliberately | Different bet: team formation |

Apply **after** the 90-day sell-first sprint, with: revenue chart (even small, growing w/w), retention curve, 2–3 design-partner quotes, and (if timed right) OSS star growth. Small-but-real beats big-but-vague.

### 10.2 Barriers and the hard questions (with answers)

1. **"Isn't this a wrapper on OpenAI/Anthropic?"** — The model is a swappable component behind a three-provider gateway (true today). The product is the governance plane: schema-grounded retrieval, AST-enforced policy, approvals, audit, scoped sharing. If models get better, our product gets better; the trust layer is ours.
2. **"MCP lets Claude/Cursor query Postgres for free. Why do you exist?"** — Raw MCP is our distribution, not our competitor: we *are* an MCP server, drop-in for the free one, and the delta is everything a raw connection lacks — scoped per-tool tokens, write approval, per-agent audit log, dangerous-query flags, plus the workspace and team layer. Free raw MCP existing is what educates the market that agents touch databases; we sell making that safe and visible.
3. **"Chat2DB has 30k stars and is free. DB Pro costs $49 once."** — Both are clients for the person at the keyboard. Neither has server-enforced read-only policy, per-step agent approval, or time-boxed per-table sharing. We're the access layer for the whole team; they're tools for one user. Postgres depth beats 30-database breadth for our ICP.
4. **"Why won't Supabase build this?"** — Their AI serves only Supabase-hosted DBs; we're provider-agnostic (RDS, Neon, self-hosted, and later MySQL). Platform vendors historically foster ecosystem tools here. The market is every production database, not one host's.
5. **"What's the moat?"** — Stacked: workflow lock-in (grants, saved queries, approval policies = system of record for DB access), per-tenant SQL feedback flywheel (approved/corrected queries improve generation on that schema), and OSS/ecosystem distribution. None complete today; all three are being built deliberately (data logging already on).
6. **"Two technical founders — who actually sells?"** — Founder A sells: Technical Lead at a YC company, selling to his own peer group (developers using AI coding tools), and the product's heaviest daily user. Founder-led sales to people whose job you've done is the strongest early motion there is. Founder B ships: the platform v1 slice went from empty repo to demoable MCP gateway in N weeks — cite the actual number.
7. **"You're both still employed. Are you committed?"** — Answer honestly, never dodge: today the employer is deliberately Customer Zero (with written permission), which is why the demo shows real production usage. Transition to full-time is tied to a named milestone — funding or $X MRR — and both founders go full-time at batch start if accepted (YC requires it; say so before they do). Moonlighting forever is not the plan; the day job is currently the best possible test lab.
8. **"Your only user is your employer — that's not a market."** — Correct for week two; by application time: N external paying customers, M design partners. Customer Zero existed to produce the demo and case study, not the revenue. The external revenue proves it travels beyond the building.
9. **"Your revenue is tiny."** — Correct: $X MRR, growing Y% w/w over Z weeks, from a motion started N weeks ago. Unit economics per seat including LLM COGS are [known number]. We're here for speed, not validation theater.
10. **"AI costs will eat your margin."** — Gateway usage costs near-zero LLM tokens (agents bring their own model; we meter executions). Chat uses tiered models, hard token caps, and the BYOK pressure valve — metering already built. Current gross margin per Pro seat ≈ [measure and state it].
11. **"Two devs holding production credentials — really?"** — AES-256-GCM envelope encryption today; the rewrite isolates credentials to a data-plane gateway with KMS and per-region decryption; self-host removes the objection entirely. SOC2 on the funded roadmap.
12. **"TAM?"** — Every company with a production database, and now every AI agent touching one. Priced comps: JetBrains DataGrip, Navicat, TablePlus sell hundreds of thousands of paid seats; the wedge expands from $15 prosumer seats to team seats to agent/DB-access governance, which is an enterprise security budget line.
13. **"Why now?"** — Three curves crossing: AI coding tools began routinely executing SQL against real databases with zero governance in the loop; LLMs became reliable at schema-grounded SQL; and lean teams are cutting the analyst middle layer.
14. **"Won't open source cannibalize cloud?"** — Category data says hosting + team features convert at 0.5–2% of a large funnel, and managed hosting is typically the majority of open-core revenue. OSS is our CAC we couldn't otherwise afford.

Pattern for all answers: one clear sentence, then one concrete number or shipped artifact. No hedging.

---

## 11. Risks and honest counterarguments

| Risk | Severity | Mitigation |
|---|---|---|
| "2-week rewrite" optimism — slice quietly grows into the full master plan | High | Scope table in §4.4 is the contract; weekly demo gate; hard stop at 4 weeks → cut scope, never extend; old app keeps serving revenue throughout |
| Category saturation ("AI SQL tool" fatigue) | High | Lead with the agent-observability wedge — nobody else's pitch; comparison SEO captures switchers |
| Anthropic/Cursor ship a governed DB gateway natively | Medium-high | Speed + neutrality: we cover all tools (Cursor, Claude Code, Codex, whatever's next) and the human workspace + team layer they won't build; ship the log/approval UX now and own the category term |
| MCP/agent clients improve faster than expected | Medium | Improving agents *increase* the need for governance; our value scales with agent query volume |
| Free tier + OSS attracts users who never pay | Medium | Accept it: they're the funnel and the community; monetize teams and hosting |
| LLM COGS blowout (lifetime unlimited plans) | Medium | Retire unlimited lifetime now; caps + BYOK |
| Trust incident (one leaked credential ends the company) | Existential | P0 fixes before scale-selling; rewrite's credential isolation; never claim security that doesn't exist |

Kill criteria (intellectual honesty): if after 90 days of real selling — 25+ interviews, soft launch, PH launch — fewer than 15 people pay and week-4 retention is under 15%, the wedge is wrong. Reposition (likely toward the agency/client-access use case, which has the clearest willingness to pay) rather than continuing to build.

---

## 12. Decision log (what this doc commits to)

1. Sell from day one while the rewrite v1 slice builds in parallel — two-founder split: A sells full-time, B builds full-time (§4.4).
2. The rewrite's 2-week target is the **MCP gateway + policy/audit slice**, not the full master plan; the web workspace migrates in waves after; hard scope stop at 4 weeks.
3. Primary positioning: the one database tool for the AI-coding era — agent gateway + human workspace + team access. Never pitch "chatbot for your DB."
4. The MCP gateway (scoped tokens, write approval, per-agent log, policy flags) leads every pitch, demo, and the Product Hunt launch.
5. UI bar: users don't reopen DBeaver/DataGrip — tracked as "% of users also using a desktop GUI weekly," driven down (§3.6).
6. Open-core with AGPL community edition **of the rewrite**, `/ee` commercial, managed cloud as primary revenue. OSS launch is the Show HN moment.
7. Postgres-only until revenue; remove other DBs from the wizard.
8. Retire $100 unlimited lifetime; capped founding-member deal; Team tier at $25/seat.
9. Keep the ChatSQL name through launch; kill the fake-logo ticker in the Hexora landing plan.
10. Beachhead: ICP 0 — developers pointing Cursor/Claude Code/Codex at real Postgres (Founder A's network first); then indie devs, small teams, agencies.
11. **Customer Zero = the founders' YC company**, with written permission, staging-first, schema-only to LLMs. One structured dogfood week produces the demo video, case study #1, and the honest numbers used in every pitch (§7.1). Selling starts from that material, not slideware.
12. Accelerator applications go out around week 8–12 with the growth chart.
13. Take the currently-public, unlicensed repos private now; open source returns deliberately with the rewrite (§4.2b).

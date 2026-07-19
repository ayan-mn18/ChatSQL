# Product

## Register

product

> Note: the primary surface is the ChatSQL workspace app (dashboard, SQL console, chat). Marketing surfaces (`ChatSQL-ui/src/pages/ChatSQLLanding.tsx`, `/contact`) are worked in the **brand** register per-task.

## Platform

web

## Users

Primary: indie developers, solo founders, and engineers on startup teams of ten or fewer who run their own PostgreSQL (Supabase, Neon, RDS, self-hosted). They live in editors and terminals, are fluent or semi-fluent in SQL, and want answers from their database without context-switching between a GUI client and an AI chat tab. Secondary: their non-SQL teammates (PMs, ops, founders' first business hires) who know the question but not the schema, and get invited into ChatSQL as scoped viewers. The landing page speaks to the developer; the viewer arrives by invitation, not marketing.

## Product Purpose

ChatSQL is an AI-native Postgres workspace. Connect a database once; ChatSQL introspects and syncs the schema, then lets you ask questions in plain English (streamed SQL grounded in the real schema), run and save SQL in a Monaco editor, browse and safely edit table data, visualize the ERD, and let an agent plan multi-step SQL tasks with human approval per step and automatic error recovery. Admins share time-boxed, per-table access with teammates instead of sharing credentials. Success: a new user connects a real database and gets a correct plain-English answer within five minutes, then returns weekly for the editor, saved queries, and sharing.

## Positioning

The Postgres client where natural language, raw SQL, and safe data editing live in one workspace, with approval-gated AI you can trust and credential-free sharing built in.

## Conversion & proof

- Primary CTA: sign up free (2 connections, 10k AI tokens/mo, no credit card).
- Secondary CTA: view pricing (Pro $10/mo, Lifetime $100 one-time) or contact for enterprise inquiries.
- The line a visitor remembers after 10 seconds: "Ask your database a question; approve the SQL before it runs."
- Belief ladder: (1) it speaks my stack — Postgres, real schema sync, real SQL out; (2) it is safe — encrypted credentials, read-only by default, nothing executes without my approval; (3) it replaces tab-hopping — chat, editor, table browser, ERD in one place; (4) my team can use it without me handing out credentials; (5) the price is a no-brainer.
- Proof on hand: the product itself (show real interface flows, not stock claims). No customer logos, no SOC2 certification, no usage-scale stats exist yet — never fabricate them. Honest proof: AES-256-GCM credential encryption, read-only query guard, per-step agent approval, human-in-the-loop design, open pricing.

## Brand Personality

Sharp, honest, builder-to-builder. Three words: grounded, direct, technical-warm. The voice of a senior engineer showing a colleague a tool they actually use, not a growth team shouting. Confidence comes from showing the product doing the work, never from claimed scale. Emotional goals: trust (safety story), relief (no more tab-hopping), respect (it doesn't dumb SQL down; it shows you the SQL).

## Anti-references

- The 2024-26 "AI SaaS glow" template: indigo-violet-fuchsia gradient text, glow blobs, glassmorphism cards, meteor animations, fake window chrome with traffic-light dots.
- Fabricated proof: "10k+ developers", "2M+ queries", "99.9% SLA", SOC2 badges, FAANG logo walls. This product has none of these; showing them destroys the trust the product depends on.
- Generic AI-copilot marketing ("Unleash the power of AI", "Revolutionize your workflow").
- Chatbot-first framing that hides the SQL. The SQL is the product's credibility; always show it.

## Design Principles

1. Show the product, not a metaphor. Real interface flows (question → SQL → approval → rows) are the hero imagery; no abstract illustrations, no fake dashboards.
2. Honesty is the brand. Every claim on any surface must be true of the shipped product today. When in doubt, show a mechanism (encryption, approval gate) instead of an adjective.
3. The SQL is always visible. Trust is built by never hiding what will run against the user's database.
4. Dark, calm, precise. The product is used at night next to editors and terminals; surfaces stay dark, type does the talking, one committed accent.
5. Fast first answer. Every surface should shorten the path from "I have a question" to "I see rows."

## Accessibility & Inclusion

WCAG AA minimum: 4.5:1 body contrast on dark surfaces, visible focus states, full keyboard paths for all interactive demos and navigation. All motion honors `prefers-reduced-motion` with instant/crossfade fallbacks. No hover-only functionality.

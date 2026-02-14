---
name: revve-core-implementation
description: Revve AI project implementation guide covering API endpoints, data fetching, database migrations, design system, frontend components, queue processors, and AI/LLM integration. Use this skill when implementing any feature in the Revve codebase — editing TSX/UI files, creating API routes, modifying database schema, building React components, working with LangChain/LLM, or offloading tasks to background queues.
---

# Revve Core Implementation Guide

Comprehensive project-specific patterns and conventions for the Revve AI codebase. Covers all layers from database to
UI. For generic React/Next.js performance optimization, see the `react-best-practices` skill.

## When to Apply

Reference this guide when:

- Creating or editing UI components, styles, or TSX files
- Building React components with shadcn/ui and Tailwind
- Implementing data operations (choosing Supabase client vs Server Actions vs API Routes)
- Creating Next.js API routes with validation and auth
- Modifying database schema (creating tables, columns, constraints)
- Implementing AI features with LangChain or LLM providers
- Offloading heavy tasks to BullMQ background queues

## Section Overview

| # | Section             | Scope                                           | Key Files                            |
|---|---------------------|-------------------------------------------------|--------------------------------------|
| 1 | Design System       | Colors, tokens, component patterns              | `globals.css`, `components/ui/`      |
| 2 | Frontend Components | React structure, state, forms, a11y             | `components/**/*.tsx`                |
| 3 | Data Fetching       | Client Supabase vs Server Actions vs API Routes | `action/*.ts`, `app/api/*`           |
| 4 | API Endpoints       | Auth patterns, validation, response format      | `app/api/**/*.ts`                    |
| 5 | Database Migrations | PostgreSQL, RLS, multi-tenancy                  | `migrations/**/*.js`                 |
| 6 | AI/LLM Integration  | LangChain, providers, RAG, embeddings           | `libs/llm*.ts`, `libs/retriever.ts`  |
| 7 | Queue Processors    | BullMQ workers, deduplication, concurrency      | `workers/jobs/`, `lib/scheduling.ts` |

## Quick Reference

### 1. Design System (CRITICAL — never hardcode colors)

| Need             | Use This                | NOT This          |
|------------------|-------------------------|-------------------|
| Primary color    | `bg-primary`            | `bg-[#E65c1a]`    |
| Primary text     | `text-primary`          | `text-orange-600` |
| Muted background | `bg-muted`              | `bg-gray-100`     |
| Muted text       | `text-muted-foreground` | `text-gray-500`   |
| Destructive      | `bg-destructive`        | `bg-red-500`      |

- Cards: Always `shadow-none`
- Dark mode: Colors switch automatically via CSS variables
- Check `components/ui/` before creating new components

### 2. Frontend Components

- **Structure**: Imports → Types → Component (hooks → handlers → effects → JSX)
- **State**: Local (`useState`), URL (`useSearchParams`), Server (React Query), Forms (react-hook-form + zod)
- **Forms**: Always use `zodResolver` with react-hook-form
- **A11y**: ARIA labels, semantic HTML, keyboard nav, WCAG contrast

### 3. Data Fetching Decision

| Scenario                   | Use             | Location            |
|----------------------------|-----------------|---------------------|
| Simple read with RLS       | Client Supabase | Component           |
| Real-time subscription     | Client Supabase | Component           |
| Multi-step workflow        | Server Action   | `action/*.ts`       |
| Mutation with side effects | Server Action   | `action/*.ts`       |
| External webhook           | API Route       | `app/api/webhook/*` |
| API key auth               | API Route       | `app/api/*`         |
| Public endpoint (widget)   | API Route       | `app/api/*`         |

### 4. API Endpoints

- **User Session auth** → `createRouteHandlerClient` + cookies
- **Service Role** (internal/crons) → `supabaseServiceRoleClient`
- **API Key** (external) → `validateTeamApiKey`
- **Validation**: Always use Zod schemas with `safeParse`
- **Response**: `{ data, message }` (success) / `{ error, details }` (failure)

### 5. Database Migrations

- **Tool**: `pnpm migrate:create [name]` (node-pg-migrate, NEVER Prisma)
- **Multi-tenancy**: Every table MUST have `team_id` + RLS policies using `user_teams()`
- **After migration**: Update `/types/database.ts`

### 6. AI/LLM Integration

- **Factory**: Always use `createOpenAILLM` / `createOpenAIEmbeddings` from `@/libs/llm-factory`
- **Providers**: OpenAI (default), Anthropic Claude, Azure OpenAI
- **RAG**: Use `createRetriever` from `@/libs/retriever`
- **Team keys**: `getOpenAIKeyByTeamId` (falls back to system key)

### 7. Queue Processors

- **When**: Tasks >5s, webhook timeouts, retry needed, deduplication needed
- **Flow**: API/Webhook → Queue (`lib/scheduling.ts`) → Worker (`workers/index.ts`) → Processor (`workers/jobs/`)
- **Dedup**: Use `jobId` for queue-level, `.is('field', null)` for DB-level

## Full Compiled Document

For complete guide with all code examples and patterns: `AGENTS.md`

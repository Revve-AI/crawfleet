# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

OpenClaw Fleet Manager — a Next.js dashboard that provisions and manages per-employee OpenClaw instances as Docker containers on a single server. Each employee gets their own subdomain (`alice.openclaw.company.com`), isolated OpenClaw config, and selective API key access. The admin dashboard controls which AI providers, tools, and capabilities each employee can access without modifying OpenClaw's code.

## Commands

```bash
pnpm dev              # Start Next.js dev server
pnpm build            # Production build (standalone output)
pnpm lint             # ESLint
pnpm db:generate      # Regenerate Prisma client after schema changes
pnpm db:push          # Push schema changes to SQLite (no migration files)
pnpm db:migrate       # Create migration files (dev only)
```

## Stack

Next.js 15 (App Router) + Prisma (SQLite) + dockerode + Traefik + iron-session + Tailwind CSS 4 + Cloudflare Access (JWT auth via middleware)

## Architecture

The dashboard runs as a Docker container alongside Traefik. Tenant OpenClaw containers are created dynamically via the Docker API (not docker-compose). The `fleet-proxy` Docker network connects everything.

```
Traefik (:80/:443)
├── fleet.domain.com     → Dashboard (:3000)
├── alice.domain.com     → fleet-alice container (:18789)
└── bob.domain.com       → fleet-bob container (:18789)
```

### Key Architectural Concepts

**Container provisioning** (`src/lib/docker.ts`): Creates containers with Traefik labels for automatic routing, health checks, and selective env var injection based on tenant's `allow*` flags. Uses `HOST_DATA_DIR` for bind mounts since the dashboard itself runs inside a container (host path != container path).

**Config vs env var changes**: Config-only changes (model, exec security, browser) rewrite `openclaw.json` and hot-reload without restart. Provider access changes require container recreation because API keys are env vars.

**Auth profiles** (`writeAuthProfiles` in docker.ts): AI provider credentials (Anthropic, OpenAI, Gemini) are written to `agents/main/agent/auth-profiles.json` per-tenant, not passed as env vars. Only non-LLM keys (Brave, ElevenLabs) use env vars.

**Key resolution** (`src/lib/key-resolver.ts`): Three-tier fallback for env values — tenant override (`envOverrides` JSON field) → `GlobalSetting` DB table → `process.env`. This allows per-tenant API key overrides.

**Auth**: Cloudflare Access JWT validation in middleware, auto-trusts `X-Auth-Email` header. Dev mode bypasses auth and uses `dev@revve.ai`. iron-session stores admin state in encrypted cookies.

**Cloudflare Access per-tenant** (`src/lib/cloudflare-access.ts`): On tenant creation, a Cloudflare Access app is provisioned for `{slug}.{BASE_DOMAIN}`, restricting access to the tenant's email. Skipped in dev mode.

### Data Layout

```
data/
├── fleet.db                              # SQLite database
└── tenants/{slug}/.openclaw/             # Per-tenant OpenClaw state
    ├── openclaw.json                     # Generated config
    └── agents/main/agent/auth-profiles.json  # AI provider credentials
```

### Key Files

- `src/lib/docker.ts` — Container lifecycle (create, start, stop, recreate, logs)
- `src/lib/config-template.ts` — Generates `openclaw.json` per tenant
- `src/lib/key-resolver.ts` — Three-tier env/key resolution
- `src/lib/constants.ts` — `OPENCLAW_IMAGE`, `FLEET_NETWORK`, `BASE_DOMAIN`, `HOST_DATA_DIR`, `FLEET_TLS`
- `src/middleware.ts` — Cloudflare Access JWT validation, dev bypass
- `src/lib/auth.ts` — iron-session admin auth, reads `X-Auth-Email` from CF Access
- `prisma/schema.prisma` — Tenant, GlobalSetting, AuditLog models
- `src/types/index.ts` — Shared TypeScript interfaces (TenantCreateInput, TenantUpdateInput, FleetStats, ApiResponse)

### API Routes

- `POST/GET /api/tenants` — Create tenant (provisions container + CF Access app), list all
- `GET/PATCH/DELETE /api/tenants/[slug]` — Tenant CRUD, PATCH handles config vs provider changes
- `POST /api/tenants/[slug]/{start,stop,restart}` — Container lifecycle
- `GET /api/tenants/[slug]/health` — Single tenant health
- `GET /api/tenants/[slug]/logs` — SSE log streaming
- `GET /api/health` — Fleet-wide health summary
- `GET/PUT /api/settings` — Global settings (API keys stored in GlobalSetting table)

## Deployment

Uses a multi-stage Dockerfile (node:22-alpine). `entrypoint.sh` runs `prisma db push --skip-generate` before starting the server to auto-migrate the database. The `fleet-proxy` network must exist before `docker compose up` (`docker network create fleet-proxy`).

`FLEET_TLS` env var controls whether Traefik labels use `websecure`+certresolver (production) or `web` (dev/tunnel). Defaults to true.

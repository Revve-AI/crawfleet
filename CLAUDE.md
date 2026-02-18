# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

OpenClaw Fleet Manager — a Next.js dashboard that provisions and manages per-employee OpenClaw instances. Supports two providers: **Docker** (containers on a single server) and **VPS** (dedicated GCP VMs per tenant). Each employee gets their own subdomain (`alice.openclaw.company.com`), isolated OpenClaw config, and selective API key access. The admin dashboard controls which AI providers, tools, and capabilities each employee can access without modifying OpenClaw's code.

## Commands

```bash
pnpm dev              # Start Next.js dev server
pnpm build            # Production build (standalone output)
pnpm lint             # ESLint
pnpm db:migrate       # Run migrations up (node-pg-migrate)
pnpm db:migrate:down  # Roll back last migration
pnpm db:migrate:new   # Create a new migration file
```

## Stack

Next.js 15 (App Router) + Supabase (Postgres + Auth + RLS) + dockerode + Traefik + Tailwind CSS 4 + ssh2 (VPS management) + @google-cloud/compute (GCP VMs) + cloudflared (Cloudflare Tunnels) + node-pg-migrate

## Architecture

Two tenant provider modes with different network topologies:

### Docker Provider (colocated containers)

The dashboard runs as a Docker container alongside Traefik. Tenant OpenClaw containers are created dynamically via the Docker API (not docker-compose). The `fleet-proxy` Docker network connects everything. Containers are isolated — no ports exposed to the host, all traffic through Traefik.

```
Traefik (:80/:443)
├── fleet.domain.com     → Dashboard (:3000)
├── alice.domain.com     → fleet-alice container (:18789)
└── bob.domain.com       → fleet-bob container (:18789)
```

### VPS Provider (dedicated GCP VMs)

Each tenant gets an isolated GCP VM running OpenClaw natively (not in Docker). Traffic flows through a per-tenant Cloudflare Tunnel — the gateway binds to localhost only, with no public ports open except SSH. UFW firewall denies all inbound except SSH.

```
Cloudflare Edge (Access auth) → Cloudflare Tunnel → cloudflared on VM → localhost:18789
```

Provisioning flow: Create GCP VM → SSH in for OS hardening + OpenClaw install → Create Cloudflare Tunnel + DNS → Install cloudflared on VM → Start OpenClaw service.

**Security model**: The gateway must NEVER be directly reachable from the internet. Port 18789 is NOT opened in UFW — cloudflared connects outbound to Cloudflare and forwards to localhost internally. Cloudflare Access enforces per-tenant email authentication at the edge before any request reaches the tunnel.

### Key Architectural Concepts

**Container provisioning** (`src/lib/docker.ts`): Creates containers with Traefik labels for automatic routing, health checks, and selective env var injection based on tenant's `allow*` flags. Uses `HOST_DATA_DIR` for bind mounts since the dashboard itself runs inside a container (host path != container path).

**VPS provisioning** (`src/lib/providers/vps-provider.ts`): Creates GCP VMs via `@google-cloud/compute`, SSHs in via `ssh2` to run setup scripts, creates per-tenant Cloudflare Tunnels. Setup script (`vps-setup-script.ts`) handles OS hardening, OpenClaw install, systemd service, and env var injection.

**Config vs env var changes**: Config-only changes (model, exec security, browser) rewrite `openclaw.json` and hot-reload without restart. Provider access changes require container recreation because API keys are env vars.

**Auth profiles** (`writeAuthProfiles` in docker.ts): AI provider credentials (Anthropic, OpenAI, Gemini) are written to `agents/main/agent/auth-profiles.json` per-tenant, not passed as env vars. Only non-LLM keys (Brave, ElevenLabs) use env vars.

**Key resolution** (`src/lib/key-resolver.ts`): Three-tier fallback for env values — tenant override (`env_overrides` jsonb field) → `global_settings` DB table → `process.env`. This allows per-tenant API key overrides.

**Auth**: Supabase Auth with Google OAuth. Middleware checks Supabase session and redirects to `/login` if unauthenticated. Admin role stored in `app_metadata.role`. Auto-promoted on first login if email is in `ADMIN_EMAILS`. Dev mode bypasses auth and uses `dev@revve.ai`.

**Database**: Supabase Postgres with Row Level Security (RLS). Two client patterns:
- `supabaseAdmin` (`src/lib/supabase/admin.ts`) — Service-role client, bypasses RLS. Used for system operations (health checks, background tasks, admin API routes).
- `createClient()` (`src/lib/supabase/server.ts`) — User-context client, respects RLS. Used for user-facing reads where RLS filters results.

All DB columns use **snake_case** naming. The `env_overrides` field is native jsonb (no JSON.stringify/parse needed).

**Cloudflare Access per-tenant** (`src/lib/cloudflare-access.ts`): On tenant creation (both Docker and VPS), a Cloudflare Access app is provisioned for `{slug}.{BASE_DOMAIN}`, restricting access to the tenant's email. Skipped in dev mode.

**Cloudflare Tunnels per-tenant** (`src/lib/cloudflare-tunnel.ts`): For VPS tenants, a dedicated Cloudflare Tunnel (`fleet-{slug}`) is created with ingress routing `{slug}.{domain}` → `http://localhost:18789`. A proxied CNAME DNS record is created pointing to `{tunnelId}.cfargotunnel.com`. Tunnel credentials are stored in the `vps_instances` DB record.

### Data Layout

```
Supabase Postgres (remote)
├── tenants              # Tenant config, status, env_overrides (jsonb)
├── vps_instances        # VPS-specific data (one-to-one with tenants)
├── global_settings      # Key-value store for fleet-wide settings
└── audit_logs           # Action audit trail

data/
└── tenants/{slug}/.openclaw/             # Per-tenant OpenClaw state (local)
    ├── openclaw.json                     # Generated config
    └── agents/main/agent/auth-profiles.json  # AI provider credentials
```

### Key Files

- `src/lib/supabase/admin.ts` — Service-role Supabase client (bypasses RLS)
- `src/lib/supabase/server.ts` — User-context Supabase client (respects RLS)
- `src/lib/supabase/middleware.ts` — Middleware Supabase client factory
- `src/lib/supabase/types.ts` — TypeScript types for all DB tables (snake_case)
- `src/lib/docker.ts` — Docker container lifecycle (create, start, stop, recreate, logs)
- `src/lib/providers/vps-provider.ts` — VPS tenant lifecycle (create VM, SSH setup, tunnel, start/stop/deploy)
- `src/lib/providers/vps-setup-script.ts` — Generates bash scripts for VM setup, cloudflared install, deploy, config updates
- `src/lib/providers/ssh.ts` — SSH connection helpers (connect with retry, exec, shell)
- `src/lib/clouds/` — Cloud provider abstraction (GCP implementation)
- `src/lib/cloudflare-tunnel.ts` — Per-tenant Cloudflare Tunnel CRUD
- `src/lib/cloudflare-access.ts` — Per-tenant Cloudflare Access app CRUD
- `src/lib/config-template.ts` — Generates `openclaw.json` per tenant
- `src/lib/key-resolver.ts` — Three-tier env/key resolution
- `src/lib/constants.ts` — `OPENCLAW_IMAGE`, `FLEET_NETWORK`, `BASE_DOMAIN`, `HOST_DATA_DIR`, `FLEET_TLS`
- `src/middleware.ts` — Supabase session validation, dev bypass
- `src/lib/auth.ts` — Auth helpers (getAuthEmail, isFleetAdmin, requireFleetAdmin)
- `src/app/login/page.tsx` — Google OAuth login page
- `src/app/auth/callback/route.ts` — OAuth callback with admin auto-promotion
- `migrations/` — node-pg-migrate migration files
- `src/types/index.ts` — Shared TypeScript interfaces (TenantCreateInput, TenantUpdateInput, FleetStats, ApiResponse)

### API Routes

- `POST/GET /api/tenants` — Create tenant (Docker: sync, VPS: SSE streaming for long-running provisioning), list all
- `GET/PATCH/DELETE /api/tenants/[slug]` — Tenant CRUD, PATCH handles config vs provider changes
- `POST /api/tenants/[slug]/{start,stop,restart}` — Container lifecycle
- `GET /api/tenants/[slug]/health` — Single tenant health
- `GET /api/tenants/[slug]/logs` — SSE log streaming
- `GET /api/health` — Fleet-wide health summary
- `GET/PUT /api/settings` — Global settings (API keys stored in global_settings table)

## Environment Variables

### Required
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Public anon key (RLS-enforced)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (server-only, bypasses RLS)
- `DATABASE_URL` — Supabase Postgres connection string (for migrations)
- `ADMIN_EMAILS` — Comma-separated list of admin emails for auto-promotion

## Deployment

### Dashboard deployment

Uses a multi-stage Dockerfile (node:22-alpine). `entrypoint.sh` runs `node-pg-migrate up` before starting the server to auto-run database migrations. The `fleet-proxy` network must exist before `docker compose up` (`docker network create fleet-proxy`).

`scripts/deploy-app.sh` handles deploying the dashboard to a GCP VPS: builds the Docker image, pushes to Artifact Registry, updates Cloudflare Tunnel ingress (fleet + wildcard subdomain routing), and SSHs in to `docker compose up`.

`FLEET_TLS` env var controls whether Traefik labels use `websecure`+certresolver (production) or `web` (dev/tunnel). Defaults to true.

### VPS tenant security invariants

- Port 18789 must NEVER be opened in the VM firewall — all traffic goes through Cloudflare Tunnel
- OpenClaw gateway binds to localhost only (no `--bind lan`) — cloudflared forwards from localhost internally
- Each tenant gets a Cloudflare Access app restricting subdomain access to the tenant's email
- SSH is the only externally accessible port; hardened with key-only auth, no root login

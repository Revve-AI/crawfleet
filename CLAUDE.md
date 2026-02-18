# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

OpenClaw Fleet Manager — a Next.js dashboard that provisions and manages per-employee OpenClaw instances on dedicated GCP VMs. Each employee gets their own subdomain (`alice.openclaw.company.com`), isolated OpenClaw config, and selective API key access. The admin dashboard controls which AI providers, tools, and capabilities each employee can access without modifying OpenClaw's code.

## Commands

```bash
pnpm dev              # Start Next.js dev server (custom server with WebSocket shell support)
pnpm build            # Production build (standalone output)
pnpm lint             # ESLint
pnpm db:migrate       # Run migrations up (node-pg-migrate)
pnpm db:migrate:down  # Roll back last migration
pnpm db:migrate:new   # Create a new migration file
```

## Stack

Next.js 15 (App Router) + Supabase (Postgres + Auth + RLS) + Tailwind CSS 4 + ssh2 (VPS management) + @google-cloud/compute (GCP VMs) + @google-cloud/storage (backups) + cloudflared (Cloudflare Tunnels) + ws (WebSocket shell) + node-pg-migrate

## Architecture

### Network topology

Each tenant gets an isolated GCP VM running OpenClaw natively. Traffic flows through a per-tenant Cloudflare Tunnel — the gateway binds to localhost only, with no public ports open except SSH. UFW firewall denies all inbound except SSH.

```
Cloudflare Edge (Access auth) → Cloudflare Tunnel → cloudflared on VM → localhost:18789
```

The dashboard itself runs as a Docker container on a separate GCP VM, also behind a Cloudflare Tunnel. It listens on `127.0.0.1:3000` — never exposed publicly.

```
Cloudflare Edge → Dashboard Tunnel → localhost:3000 (docker-compose)
```

### Provisioning flow

Create GCP VM → SSH in for OS hardening + OpenClaw install → Create Cloudflare Tunnel + DNS → Install cloudflared on VM → Start OpenClaw service.

All tenant creation uses SSE streaming (`POST /api/tenants`) because VM provisioning takes 2-5 minutes.

### Security model

- The gateway must NEVER be directly reachable from the internet
- Port 18789 is NOT opened in UFW — cloudflared connects outbound to Cloudflare and forwards to localhost internally
- Cloudflare Access enforces per-tenant email authentication at the edge before any request reaches the tunnel
- SSH is the only externally accessible port; hardened with key-only auth, no root login

### Key Architectural Concepts

**VPS provisioning** (`src/lib/providers/vps-provider.ts`): Creates GCP VMs via `@google-cloud/compute`, SSHs in via `ssh2` to run setup scripts, creates per-tenant Cloudflare Tunnels. Setup script (`vps-setup-script.ts`) handles OS hardening, OpenClaw install, systemd service, and env var injection.

**Provider interface** (`src/lib/providers/types.ts`): `TenantProvider` defines the full VM lifecycle — create, start, stop, restart, deploy, remove, health, logs, shell. `getProvider()` in `src/lib/providers/index.ts` lazy-loads the VpsProvider singleton.

**Cloud abstraction** (`src/lib/clouds/`): Pluggable cloud providers. Currently only GCP (`gcp.ts`). Each cloud exposes `createVM`, `deleteVM`, `getVMStatus`, `listRegions`, `listMachineTypes`. The `GET /api/clouds` route aggregates metadata from all configured clouds.

**Config vs env var changes**: Config-only changes (model, exec security, browser) can hot-reload without restart. Provider access changes require VM redeploy because API keys are injected as env vars on the VM.

**Key resolution** (`src/lib/key-resolver.ts`): Three-tier fallback for env values — tenant override (`env_overrides` jsonb field) → `global_settings` DB table → `process.env`. This allows per-tenant API key overrides.

**Auth**: Supabase Auth with Google OAuth. Middleware checks Supabase session and redirects to `/login` if unauthenticated. Admin role stored in `app_metadata.role`. Auto-promoted on first login if email is in `ADMIN_EMAILS`. Dev mode bypasses auth and uses `dev@revve.ai`.

**Database**: Supabase Postgres with Row Level Security (RLS). Two client patterns:
- `supabaseAdmin` (`src/lib/supabase/admin.ts`) — Service-role client, bypasses RLS. Used for system operations (health checks, background tasks, admin API routes).
- `createClient()` (`src/lib/supabase/server.ts`) — User-context client, respects RLS. Used for user-facing reads where RLS filters results.

All DB columns use **snake_case** naming. The `env_overrides` field is native jsonb (no JSON.stringify/parse needed).

**Cloudflare Access per-tenant** (`src/lib/cloudflare-access.ts`): On tenant creation, a Cloudflare Access app is provisioned for `{slug}.{BASE_DOMAIN}`, restricting access to the tenant's email. Skipped in dev mode.

**Cloudflare Tunnels per-tenant** (`src/lib/cloudflare-tunnel.ts`): A dedicated Cloudflare Tunnel (`fleet-{slug}`) is created with ingress routing `{slug}.{domain}` → `http://localhost:18789`. A proxied CNAME DNS record is created pointing to `{tunnelId}.cfargotunnel.com`. Tunnel credentials are stored in the `vps_instances` DB record.

**Custom server** (`server.ts`): Wraps Next.js with a raw HTTP server + WebSocket server (`ws`). Handles `GET /api/tenants/{slug}/shell` WebSocket upgrades for interactive terminal access to tenant VMs via SSH. Auth enforced via Supabase access token in query string.

**Backups** (`src/lib/backup.ts`): Optional periodic backup of `data/` directory to GCS. Enabled when `BACKUP_BUCKET` is set. Handles sqlite files safely (copies before upload). Runs on interval from `server.ts`.

**Health monitor** (`src/lib/health-monitor.ts`): Periodically checks all tenants' VM status and gateway health, updates `status` and `last_health_status` in the DB.

### Data Layout

```
Supabase Postgres (remote)
├── tenants              # Tenant config, status, env_overrides (jsonb)
├── vps_instances        # VPS-specific data (one-to-one with tenants)
├── global_settings      # Key-value store for fleet-wide settings
└── audit_logs           # Action audit trail

data/                    # Mounted volume in dashboard container
└── .ssh/fleet_key       # SSH key for connecting to tenant VMs
```

### Key Files

- `server.ts` — Custom HTTP + WebSocket server wrapping Next.js (shell access)
- `entrypoint.sh` — Docker entrypoint: replaces Supabase URL placeholders in built JS, runs migrations, starts server
- `src/lib/providers/index.ts` — `getProvider()` returns VpsProvider singleton
- `src/lib/providers/vps-provider.ts` — VPS tenant lifecycle (create VM, SSH setup, tunnel, start/stop/deploy)
- `src/lib/providers/vps-setup-script.ts` — Generates bash scripts for VM setup, cloudflared install, deploy
- `src/lib/providers/ssh.ts` — SSH connection helpers (connect with retry, exec, shell, tunnel proxy)
- `src/lib/providers/types.ts` — `TenantProvider` interface, `ShellHandle`, `StatusCallback`
- `src/lib/clouds/` — Cloud provider abstraction (`gcp.ts` implementation)
- `src/lib/cloudflare-tunnel.ts` — Per-tenant Cloudflare Tunnel CRUD
- `src/lib/cloudflare-access.ts` — Per-tenant Cloudflare Access app CRUD
- `src/lib/key-resolver.ts` — Three-tier env/key resolution
- `src/lib/health-monitor.ts` — Periodic health checks for all tenants
- `src/lib/backup.ts` — Optional GCS backup of data directory
- `src/lib/constants.ts` — `BASE_DOMAIN`, `DATA_DIR`, `FLEET_TLS`, cloud/VPS constants
- `src/lib/supabase/admin.ts` — Service-role Supabase client (bypasses RLS)
- `src/lib/supabase/server.ts` — User-context Supabase client (respects RLS)
- `src/lib/supabase/middleware.ts` — Middleware Supabase client factory
- `src/lib/supabase/types.ts` — TypeScript types for all DB tables (snake_case)
- `src/lib/auth.ts` — Auth helpers (getAuthEmail, isFleetAdmin, requireFleetAdmin)
- `src/lib/tenant-access.ts` — `requireTenantAccess(slug)` — loads tenant with VPS data, enforces ownership
- `src/lib/sse.ts` — SSE response helper (`sseResponse`) and client reader (`readSSE`)
- `src/middleware.ts` — Supabase session validation, dev bypass
- `src/app/login/page.tsx` — Google OAuth login page
- `src/app/auth/callback/route.ts` — OAuth callback with admin auto-promotion
- `migrations/` — node-pg-migrate migration files
- `src/types/index.ts` — Shared TypeScript interfaces (TenantCreateInput, TenantUpdateInput, FleetStats, ApiResponse)

### API Routes

- `POST /api/tenants` — Create tenant (SSE streaming for long-running VPS provisioning)
- `GET /api/tenants` — List all tenants (admin sees all, users see own)
- `GET/PATCH/DELETE /api/tenants/[slug]` — Tenant CRUD
- `POST /api/tenants/[slug]/start` — Start VM (SSE)
- `POST /api/tenants/[slug]/stop` — Stop VM
- `POST /api/tenants/[slug]/restart` — Restart VM
- `POST /api/tenants/[slug]/deploy` — Deploy new version (SSE, accepts `gitTag`)
- `GET /api/tenants/[slug]/health` — Single tenant health check
- `GET /api/tenants/[slug]/logs` — SSE log streaming (journalctl)
- `WS /api/tenants/[slug]/shell` — WebSocket interactive shell (handled by `server.ts`)
- `GET /api/health` — Fleet-wide health summary
- `GET /api/clouds` — Available cloud providers, regions, machine types
- `GET/PUT /api/settings` — Global settings (API keys stored in global_settings table)

## Environment Variables

### Required
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Public anon key (RLS-enforced)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (server-only, bypasses RLS)
- `DATABASE_URL` — Supabase Postgres connection string (for migrations)
- `ADMIN_EMAILS` — Comma-separated list of admin emails for auto-promotion

### VPS / Cloud
- `GCP_PROJECT` — GCP project ID (enables GCP cloud provider)
- `VPS_SSH_KEY_PATH` — Path to SSH private key for tenant VMs (default: `./data/.ssh/fleet_key`)
- `VPS_SSH_PUBLIC_KEY` — SSH public key injected into tenant VMs
- `OPENCLAW_DEFAULT_GIT_TAG` — Default OpenClaw version for new tenants (default: `latest`)

### Cloudflare
- `CLOUDFLARE_ACCOUNT_ID` — Account ID for Access apps and Tunnels
- `CLOUDFLARE_API_KEY` — API token with Tunnel and DNS permissions
- `CLOUDFLARE_ZONE_ID` — DNS zone for tenant subdomains
- `CLOUDFLARE_DOMAIN` — Domain for tunnel routing (may differ from BASE_DOMAIN in dev)
- `CLOUDFLARE_IDP_ID` — Google Workspace IdP ID for Access app login

### Optional
- `BASE_DOMAIN` — Base domain for tenant subdomains (default: `openclaw.example.com`)
- `DATA_DIR` — Local data directory (default: `./data`)
- `FLEET_TLS` — Whether tenant URLs use HTTPS (default: `true`)
- `BACKUP_BUCKET` — GCS bucket name for periodic backups (disabled if empty)
- `BACKUP_INTERVAL_MIN` — Backup interval in minutes (default: `15`)

## Deployment

### Dashboard deployment

Uses a multi-stage Dockerfile (node:22-alpine). `entrypoint.sh` replaces build-time Supabase URL placeholders in client JS, runs `node-pg-migrate up`, then starts the custom server. Dashboard binds to `127.0.0.1:3000` — accessed via its own Cloudflare Tunnel.

`docker-compose.yml` runs a single `dashboard` service. No Traefik or Docker networking — all routing is handled by Cloudflare Tunnels.

`scripts/deploy-app.sh` handles deploying the dashboard to a GCP VPS: builds the Docker image, pushes to Artifact Registry, updates Cloudflare Tunnel ingress, and SSHs in to `docker compose up`.

### VPS tenant security invariants

- Port 18789 must NEVER be opened in the VM firewall — all traffic goes through Cloudflare Tunnel
- OpenClaw gateway binds to localhost only (no `--bind lan`) — cloudflared forwards from localhost internally
- Each tenant gets a Cloudflare Access app restricting subdomain access to the tenant's email
- SSH is the only externally accessible port; hardened with key-only auth, no root login

# Architecture

The big idea: every tenant gets a real VM. Not a container. Not a namespace. A whole machine with its own firewall, its own tunnel, its own Cloudflare Access policy. Overkill? Maybe. But isolation is easy to reason about when it's a literal separate computer.

## Network topology

Nothing is publicly accessible. Everything goes through Cloudflare. Every tenant VM has zero open ports after provisioning.

```
User browser
    │
    ▼
Cloudflare Edge
    │  ← Access policy: "is this alice@company.com? no? get out"
    │
    ▼
Cloudflare Tunnel (per tenant, outbound-only)
    │
    ▼
cloudflared on VM → localhost:18789
                     └── OpenClaw Gateway (never binds to 0.0.0.0)
```

The dashboard itself follows the same pattern:

```
Admin browser → Cloudflare Edge → Dashboard Tunnel → localhost:3000
```

### Security invariants (don't break these)

- Port 18789 is **never** opened in UFW. Ever.
- OpenClaw gateway binds to `localhost` only. No `--bind lan`.
- cloudflared connects *outbound* to Cloudflare. No inbound ports needed.
- SSH is open only during initial setup, then UFW locks it down.
- Each subdomain has a Cloudflare Access app scoped to exactly one email.

## What happens when you click "Create Tenant"

The whole thing streams over SSE because it takes 2-5 minutes. Here's the play-by-play:

```
 1. Create a GCP VM (Debian 12, e2-small by default)
 2. Wait for it to boot (~30-60s)
 3. SSH in as 'openclaw' user
 4. Run the setup script:
    ├── Harden SSH (key-only, no root login)
    ├── Set up UFW (deny all inbound except SSH — for now)
    ├── Install fail2ban + unattended-upgrades
    ├── Install OpenClaw via the official installer
    ├── Write API keys to /etc/openclaw.env
    └── Create a systemd service for openclaw
 5. Create a Cloudflare Tunnel (fleet-{slug})
 6. Configure ingress: {slug}.domain → localhost:18789
 7. Create a CNAME DNS record pointing to the tunnel
 8. Install cloudflared on the VM with the tunnel token
 9. Start the OpenClaw systemd service
10. Wait for health checks to pass (~1-3 min on small VMs)
11. Lock down the firewall — close SSH and DNS. Zero open ports.
```

If anything fails, it rolls back: deletes the tunnel, destroys the VM, marks the instance as `error`. No half-provisioned zombies.

## Database

Four tables in Supabase Postgres. All have RLS. All use `snake_case`.

### tenants

The main table. One row per person.

| Column | Type | What it is |
|--------|------|------------|
| id | uuid | PK |
| user_id | uuid | Supabase auth user (nullable) |
| slug | text | Unique subdomain — `alice` in `alice.openclaw.company.com` |
| display_name | text | Human name |
| email | text | Owner's email |
| enabled | boolean | Kill switch |
| status | text | `running` or `stopped` |
| access_app_id | text | Cloudflare Access app ID |
| env_overrides | jsonb | Per-tenant API key overrides (native jsonb, no stringify dance) |
| gateway_token | text | OpenClaw gateway auth token |
| last_health_check | timestamptz | When we last checked |
| last_health_status | text | What we found |

### vps_instances

One-to-one with tenants. All the VM details.

| Column | Type | What it is |
|--------|------|------------|
| tenant_id | uuid | FK to tenants (unique) |
| cloud | text | `gcp` (for now) |
| region | text | e.g. `us-central1-a` |
| instance_id | text | GCP instance name |
| machine_type | text | e.g. `e2-small` |
| external_ip | text | VM's public IP |
| tunnel_id | text | Cloudflare Tunnel ID |
| tunnel_token | text | Tunnel auth token |
| git_tag | text | OpenClaw version |
| ssh_user | text | Always `openclaw` |
| ssh_port | int | Always `22` |
| vm_status | text | `creating` / `running` / `stopped` / `error` / `destroying` |

### global_settings

Key-value store. Fleet-wide API keys live here.

### audit_logs

Who did what, when. `action` + `details` (jsonb) + `tenant_id` + timestamp.

## RLS policies

- **Admins** — full CRUD on everything
- **Regular users** — can read their own tenants (matched by `user_id` or `email`), plus associated VPS instances and audit logs
- **Global settings** — admin-only, obviously

Admin status comes from `app_metadata.role = 'admin'` in the Supabase JWT.

## Auth flow

```
/login → Google OAuth via Supabase → /auth/callback
  → Exchange code for session
  → If email in ADMIN_EMAILS → auto-promote to admin
  → If nobody's logged in yet → first user gets admin (YOLO mode)
  → Redirect to dashboard
```

Dev mode: middleware injects `X-Auth-Email: dev@revve.ai` and skips the whole song and dance.

## Key resolution (the three-tier thing)

When a tenant VM needs `ANTHROPIC_API_KEY`, Crawfleet resolves it with fallback:

```
1. tenant.env_overrides   →  per-tenant override (if set)
2. global_settings table  →  fleet-wide default (Settings page)
3. process.env            →  server env var (last resort)
```

This lets you set keys once for everyone, then override for specific tenants. Env var changes require a redeploy — they get baked into `/etc/openclaw.env` on the VM.

## The custom server

Next.js doesn't do WebSockets natively, so `server.ts` wraps it with a raw HTTP server:

```
server.ts
├── HTTP → Next.js (normal pages and API routes)
└── WebSocket upgrades on /api/tenants/{slug}/shell
    ├── Auth via Supabase token in query string
    ├── Ownership check (your tenant or you're admin)
    ├── SSH through Cloudflare Tunnel to the VM
    └── Bidirectional pipe: xterm.js ↔ WebSocket ↔ SSH
```

Messages are JSON:
- `{"type": "input", "data": "ls\n"}` — keystrokes from browser
- `{"type": "output", "data": "..."}` — terminal output from VM
- `{"type": "resize", "cols": 80, "rows": 24}` — window resize
- `{"type": "exit"}` — shell ended
- `{"type": "error", "message": "..."}` — something broke

30-second ping keepalive so Cloudflare doesn't kill idle connections.

## Cloud provider abstraction

The `CloudProvider` interface (`src/lib/clouds/types.ts`) is how you'd add AWS or Hetzner:

```typescript
interface CloudProvider {
  createVm(spec): Promise<string>;
  waitForReady(instanceId, region, timeout?): Promise<string>;
  startVm(instanceId, region): Promise<void>;
  stopVm(instanceId, region): Promise<void>;
  deleteVm(instanceId, region): Promise<void>;
  getVmInfo(instanceId, region): Promise<VmInfo>;
  listMachineTypes(region): Promise<Array<{id, description}>>;
  listRegions(): Promise<Array<{id, description}>>;
}
```

Only GCP exists today. See [adding-cloud-providers.md](adding-cloud-providers.md) if you want to change that.

## Directory layout

```
├── server.ts                    # Custom HTTP + WebSocket server
├── entrypoint.sh                # Docker entrypoint
├── Dockerfile                   # Multi-stage build (node:22-alpine)
├── docker-compose.yml           # Dashboard container
├── migrations/                  # node-pg-migrate SQL
│
├── src/
│   ├── middleware.ts             # Auth gate
│   ├── app/
│   │   ├── page.tsx              # Dashboard home
│   │   ├── login/                # Google OAuth
│   │   ├── auth/callback/        # OAuth callback + admin promotion
│   │   ├── settings/             # Fleet-wide API keys
│   │   ├── tenants/              # Tenant CRUD pages
│   │   └── api/                  # REST endpoints
│   │
│   ├── lib/
│   │   ├── constants.ts          # BASE_DOMAIN, DATA_DIR, etc.
│   │   ├── auth.ts               # Who are you? Are you admin?
│   │   ├── key-resolver.ts       # Three-tier env resolution
│   │   ├── tenant-access.ts      # "Is this your tenant?" guard
│   │   ├── sse.ts                # SSE streaming helpers
│   │   ├── cloudflare-tunnel.ts  # Tunnel CRUD per tenant
│   │   ├── cloudflare-access.ts  # Access app CRUD per tenant
│   │   ├── supabase/             # DB clients and types
│   │   ├── providers/            # VM lifecycle (the big one)
│   │   └── clouds/               # Cloud abstraction (GCP impl)
│   │
│   ├── components/               # React UI
│   └── types/                    # Shared TS interfaces
│
├── scripts/
│   ├── deploy-app.sh             # Ship dashboard to prod
│   └── setup.sh                  # Initial server bootstrapping
│
└── data/                         # Runtime data (gitignored)
    └── .ssh/fleet_key            # SSH key for tenant VMs
```

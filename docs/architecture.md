# Architecture

Each tenant runs on a dedicated GCP VM with its own firewall, Cloudflare Tunnel, and Cloudflare Access policy. This provides strong isolation between tenants at the infrastructure level.

## Network topology

No services are directly exposed to the internet. All traffic routes through Cloudflare.

```
User browser
    |
    v
Cloudflare Edge
    |  <- Access policy enforces per-tenant email authentication
    |
    v
Cloudflare Tunnel (per tenant, outbound-only)
    |
    v
cloudflared on VM -> localhost:18789
                     └── OpenClaw Gateway (binds to localhost only)
```

The dashboard follows the same pattern:

```
Admin browser -> Cloudflare Edge -> Dashboard Tunnel -> localhost:3000
```

### Security invariants

- Port 18789 is **never** opened in the VM firewall.
- The OpenClaw gateway binds to `localhost` only. No `--bind lan`.
- `cloudflared` connects outbound to Cloudflare. No inbound ports are required.
- SSH is the only externally accessible port during initial setup. After provisioning, the firewall locks it down.
- Each tenant subdomain has a Cloudflare Access app scoped to exactly one email address.

## Provisioning flow

Tenant creation streams progress over SSE because the process takes 2-5 minutes:

```
 1. Create a GCP VM (Debian 12, e2-small by default)
 2. Wait for the VM to boot (~30-60s)
 3. SSH in as the 'openclaw' user
 4. Run the setup script:
    ├── Harden SSH (key-only auth, no root login)
    ├── Configure UFW (deny all inbound except SSH temporarily)
    ├── Install fail2ban and unattended-upgrades
    ├── Install OpenClaw via the official installer
    ├── Write API keys to /etc/openclaw.env
    └── Create a systemd service for OpenClaw
 5. Create a Cloudflare Tunnel (fleet-{slug})
 6. Configure ingress: {slug}.domain -> localhost:18789
 7. Create a CNAME DNS record pointing to the tunnel
 8. Install cloudflared on the VM with the tunnel token
 9. Start the OpenClaw systemd service
10. Wait for health checks to pass (~1-3 min on small VMs)
11. Lock down the firewall — close SSH and DNS. Zero open ports remain.
```

If any step fails, the process rolls back: the tunnel is deleted, the VM is destroyed, and the instance is marked as `error`.

## Database

Four tables in Supabase Postgres, all with RLS enabled. All columns use `snake_case`.

### tenants

The primary table. One row per tenant.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | Supabase auth user (nullable) |
| slug | text | Unique subdomain identifier (e.g., `alice` in `alice.openclaw.company.com`) |
| display_name | text | Display name |
| email | text | Owner's email address |
| enabled | boolean | Whether the tenant is active |
| status | text | `running` or `stopped` |
| access_app_id | text | Cloudflare Access app ID |
| env_overrides | jsonb | Per-tenant API key overrides (native jsonb) |
| gateway_token | text | OpenClaw gateway auth token |
| last_health_check | timestamptz | Timestamp of last health check |
| last_health_status | text | Result of last health check |

### vps_instances

One-to-one relationship with tenants. Stores VM-specific details.

| Column | Type | Description |
|--------|------|-------------|
| tenant_id | uuid | Foreign key to tenants (unique) |
| cloud | text | Cloud provider identifier (e.g., `gcp`) |
| region | text | e.g., `us-central1-a` |
| instance_id | text | Cloud provider instance name |
| machine_type | text | e.g., `e2-small` |
| external_ip | text | VM public IP address |
| tunnel_id | text | Cloudflare Tunnel ID |
| tunnel_token | text | Tunnel authentication token |
| git_tag | text | OpenClaw version |
| ssh_user | text | SSH username (always `openclaw`) |
| ssh_port | int | SSH port (always `22`) |
| vm_status | text | `creating` / `running` / `stopped` / `error` / `destroying` |

### global_settings

Key-value store for fleet-wide configuration. API keys set here apply to all tenants unless overridden.

### audit_logs

Records all administrative actions. Fields: `action`, `details` (jsonb), `tenant_id`, and timestamp.

## RLS policies

- **Admins** have full CRUD access to all tables.
- **Regular users** can read their own tenants (matched by `user_id` or `email`), along with associated VPS instances and audit logs.
- **Global settings** are restricted to admin access only.

Admin status is determined by `app_metadata.role = 'admin'` in the Supabase JWT.

## Authentication flow

```
/login -> Google OAuth via Supabase -> /auth/callback
  -> Exchange code for session
  -> If email is in ADMIN_EMAILS -> auto-promote to admin
  -> If no users exist yet -> first user becomes admin
  -> Redirect to dashboard
```

Authentication is required in all environments. In development, Cloudflare Access app creation and WebSocket shell authentication are skipped.

## Key resolution

When a tenant VM needs an API key (e.g., `ANTHROPIC_API_KEY`), Crawfleet resolves it using a three-tier fallback:

```
1. tenant.env_overrides   ->  per-tenant override (if set)
2. global_settings table  ->  fleet-wide default (configured in Settings)
3. process.env            ->  server environment variable (fallback)
```

This allows setting keys once for all tenants while still supporting per-tenant overrides. Note that environment variable changes require a redeploy, as they are written to `/etc/openclaw.env` on the VM.

## Cloud provider abstraction

The `CloudProvider` interface (`src/lib/clouds/types.ts`) defines the contract for adding new cloud providers:

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

Currently only GCP is implemented. See [adding-cloud-providers.md](adding-cloud-providers.md) for instructions on adding new providers.

## Directory layout

```
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
│   │   ├── auth.ts               # Auth helpers
│   │   ├── key-resolver.ts       # Three-tier env resolution
│   │   ├── tenant-access.ts      # Tenant ownership guard
│   │   ├── sse.ts                # SSE streaming helpers
│   │   ├── cloudflare-tunnel.ts  # Tunnel CRUD per tenant
│   │   ├── cloudflare-access.ts  # Access app CRUD per tenant
│   │   ├── supabase/             # DB clients and types
│   │   ├── providers/            # VM lifecycle management
│   │   └── clouds/               # Cloud abstraction (GCP impl)
│   │
│   ├── components/               # React UI
│   └── types/                    # Shared TS interfaces
│
├── scripts/
│   ├── deploy-app.sh             # Deploy dashboard to production
│   └── setup.sh                  # Initial server bootstrapping
│
└── data/                         # Runtime data (gitignored)
    └── .ssh/fleet_key            # SSH key for tenant VMs
```

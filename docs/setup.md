# Setup Guide

Three external services. Sounds like a lot, but each one does something you'd have to build yourself otherwise — so just roll with it.

- **Supabase** — database + auth (free tier is fine for dev)
- **GCP** — where the tenant VMs live
- **Cloudflare** — tunnels, DNS, per-user access control

## Prerequisites

- Node.js 22+ and pnpm (corepack)
- A Supabase project
- A GCP project with Compute Engine enabled
- A Cloudflare account with a domain
- An SSH key pair (we'll generate one)

## 1. Clone and install

```bash
git clone https://github.com/your-org/crawfleet.git
cd crawfleet
pnpm install
```

Nothing exciting here. Moving on.

## 2. Supabase

### Create a project

1. Head to [supabase.com](https://supabase.com), create a project
2. Grab your **Project URL**, **anon key**, and **service role key** from Settings > API
3. Grab the **Postgres connection string** from Settings > Database > Connection string (URI)

### Set up Google OAuth

1. Go to Authentication > Providers > Google
2. Enable it, plug in your Google OAuth client ID and secret
3. Add redirect URLs:
   - `http://localhost:3000/auth/callback` (dev)
   - `https://fleet.yourdomain.com/auth/callback` (prod)

### Env vars

```bash
NEXT_PUBLIC_SUPABASE_URL="https://xxxxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
SUPABASE_SERVICE_ROLE_KEY="eyJ..."
DATABASE_URL="postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres"
```

## 3. GCP

### Enable the API

```bash
gcloud services enable compute.googleapis.com
```

### Auth — pick your fighter

**Local dev (easiest):**
```bash
gcloud auth application-default login
```

**Production (service account key):**
1. Create a service account with `Compute Admin` role
2. Download the JSON key
3. Set `GCP_SERVICE_ACCOUNT_KEY` to the raw JSON, or `GCP_CREDENTIALS_FILE` to the file path

**Running on GCP already?** Attach a service account to the VM and you're done. ADC just works.

### Env vars

```bash
GCP_PROJECT="your-gcp-project-id"
```

### SSH key pair

Crawfleet needs to SSH into tenant VMs during setup. Generate a key:

```bash
mkdir -p data/.ssh
ssh-keygen -t ed25519 -f data/.ssh/fleet_key -N "" -C "crawfleet"
```

```bash
VPS_SSH_KEY_PATH="./data/.ssh/fleet_key"
VPS_SSH_PUBLIC_KEY="ssh-ed25519 AAAA... crawfleet"
```

## 4. Cloudflare

### Domain and zone

1. Add your domain to Cloudflare (or use one that's already there)
2. Note the **Zone ID** from the domain overview
3. Note the **Account ID** from the sidebar

### API token

Create one at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens). It needs:

- **Account > Cloudflare Tunnel** — Edit
- **Account > Access: Apps and Policies** — Edit
- **Zone > DNS** — Edit

Yes, it needs all three. Crawfleet creates tunnels, Access apps, and DNS records for every tenant. That's the whole point.

### Identity provider (optional)

If you're on Google Workspace and want to force org-only logins:

1. Zero Trust > Settings > Authentication > Add new IdP
2. Set up Google
3. Note the **IdP ID**

### Env vars

```bash
CLOUDFLARE_ACCOUNT_ID="your-account-id"
CLOUDFLARE_API_KEY="your-api-token"
CLOUDFLARE_ZONE_ID="your-zone-id"
CLOUDFLARE_DOMAIN="yourdomain.com"
CLOUDFLARE_IDP_ID=""              # optional
BASE_DOMAIN="openclaw.yourdomain.com"
```

## 5. Admin emails

Who gets the keys to the kingdom?

```bash
ADMIN_EMAILS="alice@company.com,bob@company.com"
```

Leave it empty and the first person to log in becomes admin. Living dangerously.

## 6. Run migrations

```bash
pnpm db:migrate
```

Creates four tables (`tenants`, `vps_instances`, `global_settings`, `audit_logs`) with RLS policies. Takes about two seconds.

## 7. Start it up

```bash
pnpm dev
```

Open `http://localhost:3000`. In dev mode:
- Auth is bypassed — you're `dev@revve.ai`, congrats
- Cloudflare Access app creation is skipped
- WebSocket shell auth is skipped

You can browse the UI, but actually provisioning a VM requires GCP + Cloudflare to be configured for real.

## Full `.env` reference

```bash
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=""
NEXT_PUBLIC_SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""
DATABASE_URL=""

# Auth
ADMIN_EMAILS=""

# Cloudflare (required for provisioning)
CLOUDFLARE_ACCOUNT_ID=""
CLOUDFLARE_API_KEY=""
CLOUDFLARE_ZONE_ID=""
CLOUDFLARE_DOMAIN=""
CLOUDFLARE_IDP_ID=""

# Domain
BASE_DOMAIN="openclaw.example.com"
FLEET_TLS="true"

# GCP (required for provisioning)
GCP_PROJECT=""

# SSH (required for provisioning)
VPS_SSH_KEY_PATH="./data/.ssh/fleet_key"
VPS_SSH_PUBLIC_KEY=""

# OpenClaw version
OPENCLAW_DEFAULT_GIT_TAG="latest"

# API keys (shared fleet-wide, overridable per tenant)
ANTHROPIC_API_KEY=""
OPENAI_API_KEY=""
GEMINI_API_KEY=""
BRAVE_API_KEY=""
ELEVENLABS_API_KEY=""

# Data
DATA_DIR="./data"

# Backups (optional)
BACKUP_BUCKET=""
BACKUP_INTERVAL_MIN="15"
```

## When things go wrong

**"Supabase not configured" on startup**
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` need to exist when the dev server starts. They're compile-time vars. No `.env`, no party.

**VM provisioning dies at the SSH step**
- Does `VPS_SSH_PUBLIC_KEY` actually match the private key at `VPS_SSH_KEY_PATH`? Double check.
- GCP injects the key for user `openclaw`. Crawfleet connects as that user.
- VMs need 30-60s after creation before SSH works. Patience.

**Cloudflare tunnel won't connect**
- Does your `CLOUDFLARE_API_KEY` have Tunnel Edit permissions? Go check.
- Look at Zero Trust > Tunnels in the Cloudflare dashboard
- On the VM: `systemctl status cloudflared`

**Google OAuth callback fails**
- The callback URL in Supabase needs to match your dashboard URL exactly
- Behind Cloudflare Tunnel, the callback reads `x-forwarded-proto` and `x-forwarded-host` headers. If those are wrong, the redirect URL is wrong

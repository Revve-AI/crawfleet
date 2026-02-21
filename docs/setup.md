# Setup Guide

Crawfleet depends on three external services:

- **Supabase** — database and authentication
- **GCP** — hosts tenant VMs
- **Cloudflare** — tunnels, DNS, and per-user access control

## Prerequisites

- Node.js 22+ and pnpm (corepack)
- A Supabase project
- A GCP project with Compute Engine enabled
- A Cloudflare account with a domain
- An SSH key pair (generated below)

## 1. Clone and install

```bash
git clone https://github.com/Revve-AI/crawfleet.git
cd crawfleet
pnpm install
```

## 2. Supabase

### Create a project

1. Go to [supabase.com](https://supabase.com) and create a project
2. Copy your **Project URL**, **anon key**, and **service role key** from Settings > API
3. Copy the **Postgres connection string** from Settings > Database > Connection string (URI)

### Set up Google OAuth

1. Go to Authentication > Providers > Google
2. Enable it and enter your Google OAuth client ID and secret
3. Add redirect URLs:
   - `http://localhost:3000/auth/callback` (development)
   - `https://fleet.yourdomain.com/auth/callback` (production)

### Environment variables

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

### Authentication

**Local development:**
```bash
gcloud auth application-default login
```

**Production (service account):**
1. Create a service account with the `Compute Admin` role
2. Download the JSON key
3. Set `GCP_SERVICE_ACCOUNT_KEY` to the raw JSON, or `GCP_CREDENTIALS_FILE` to the file path

**Running on GCP:** Attach a service account to the VM directly. No key file needed.

### Environment variables

```bash
GCP_PROJECT="your-gcp-project-id"
```

### SSH key pair

Crawfleet uses SSH to connect to tenant VMs during provisioning. Generate a dedicated key pair:

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

1. Add your domain to Cloudflare (or use an existing one)
2. Note the **Zone ID** from the domain overview page
3. Note the **Account ID** from the sidebar

### API token

Create a token at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) with these permissions:

- **Account > Cloudflare Tunnel** — Edit
- **Account > Access: Apps and Policies** — Edit
- **Zone > DNS** — Edit

All three are required. Crawfleet creates tunnels, Access apps, and DNS records for each tenant.

### Identity provider (optional)

To restrict logins to a specific Google Workspace organization:

1. Go to Zero Trust > Settings > Authentication > Add new IdP
2. Configure Google as the identity provider
3. Note the **IdP ID**

### Environment variables

```bash
CLOUDFLARE_ACCOUNT_ID="your-account-id"
CLOUDFLARE_API_KEY="your-api-token"
CLOUDFLARE_ZONE_ID="your-zone-id"
CLOUDFLARE_DOMAIN="yourdomain.com"
CLOUDFLARE_IDP_ID=""              # optional
BASE_DOMAIN="openclaw.yourdomain.com"
```

## 5. Admin emails

Specify which users should have admin access:

```bash
ADMIN_EMAILS="alice@company.com,bob@company.com"
```

If left empty, the first user to log in is automatically promoted to admin.

## 6. Run migrations

```bash
pnpm db:migrate
```

Creates four tables (`tenants`, `vps_instances`, `global_settings`, `audit_logs`) with RLS policies.

## 7. Start the dev server

```bash
pnpm dev
```

Open `http://localhost:3000`. You will need to log in via Google OAuth. In development mode:
- Cloudflare Access app creation is skipped
- WebSocket shell authentication is skipped

The dashboard UI is fully functional, but provisioning VMs requires valid GCP and Cloudflare configuration.

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

## Troubleshooting

**"Supabase not configured" on startup**
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be set before starting the dev server. These are compile-time variables that Next.js inlines during build.

**VM provisioning fails at the SSH step**
- Verify that `VPS_SSH_PUBLIC_KEY` matches the private key at `VPS_SSH_KEY_PATH`.
- GCP injects the key for user `openclaw`. Crawfleet connects as that user.
- New VMs typically need 30-60 seconds after creation before SSH is available.

**Cloudflare Tunnel does not connect**
- Confirm that your `CLOUDFLARE_API_KEY` has Tunnel Edit permissions.
- Check the tunnel status in Zero Trust > Tunnels in the Cloudflare dashboard.
- On the VM: `systemctl status cloudflared`

**Google OAuth callback fails**
- The callback URL configured in Supabase must match your dashboard URL exactly.
- When running behind a Cloudflare Tunnel, the callback relies on `x-forwarded-proto` and `x-forwarded-host` headers. Incorrect values will produce a redirect URL mismatch.

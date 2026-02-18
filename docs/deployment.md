# Production Deployment

Time to ship. Crawfleet runs as a Docker container on a GCP VM, listening on `localhost:3000`, accessed through a Cloudflare Tunnel. Same zero-trust pattern as the tenant VMs.

## What you need

- Everything in [setup.md](setup.md) already working
- `docker` and `gcloud` CLI locally
- A GCP Artifact Registry repo for images
- A GCP VM for the dashboard (separate from tenant VMs — don't mix these)
- `cloudflared` locally

## 1. Create the dashboard VM

A small VM. The dashboard isn't doing heavy compute — it's just orchestrating.

```bash
gcloud compute instances create crawfleet-dashboard \
  --project=YOUR_PROJECT \
  --zone=us-central1-a \
  --machine-type=e2-small \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=20GB
```

SSH in and get Docker running:

```bash
gcloud compute ssh crawfleet-dashboard --zone=us-central1-a
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in for group change
```

## 2. Create a Cloudflare Tunnel

```bash
cloudflared tunnel create crawfleet-dashboard
cloudflared tunnel route dns crawfleet-dashboard fleet.yourdomain.com
```

Install cloudflared on the VM as a service, routing `fleet.yourdomain.com` to `localhost:3000`. The [Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/as-a-service/) cover this well enough.

## 3. Set up Artifact Registry

One-time:

```bash
gcloud artifacts repositories create crawfleet \
  --repository-format=docker \
  --location=us-central1

gcloud auth configure-docker us-central1-docker.pkg.dev
```

## 4. Configure deploy env vars

Add to your `.env`:

```bash
DEPLOY_INSTANCE="crawfleet-dashboard"
DEPLOY_PROJECT="your-gcp-project"
DEPLOY_ZONE="us-central1-a"
DEPLOY_HOST="crawfleet-dashboard.yourdomain.com"
DEPLOY_TUNNEL_ID="your-dashboard-tunnel-id"
DEPLOY_USER="your-username"
DEPLOY_REGISTRY="us-central1-docker.pkg.dev/your-project/crawfleet"
```

## 5. Deploy

```bash
# First time — does everything
./scripts/deploy-app.sh all

# After code changes — the usual loop
./scripts/deploy-app.sh deploy
```

### What each step does

| Step | Command | What happens |
|------|---------|--------------|
| `docker` | `deploy-app.sh docker` | Installs Docker on the server if it's not there |
| `build` | `deploy-app.sh build` | Builds the image, pushes to Artifact Registry |
| `auth` | `deploy-app.sh auth` | Sets up gcloud + Docker auth on the server |
| `tunnel` | `deploy-app.sh tunnel` | Updates Cloudflare Tunnel ingress |
| `deploy` | `deploy-app.sh deploy` | Build + push + pull + restart. Your typical Thursday. |
| `start` | `deploy-app.sh start` | Pull latest and restart (no rebuild) |
| `verify` | `deploy-app.sh verify` | Checks if it's actually running |
| `all` | `deploy-app.sh all` | The full shebang |

## 6. Server-side files

On the dashboard VM:

```bash
mkdir -p ~/crawfleet/data/.ssh
cd ~/crawfleet
```

Copy your `.env` and SSH key:

```bash
scp .env user@crawfleet-dashboard.yourdomain.com:~/crawfleet/.env
scp data/.ssh/fleet_key user@crawfleet-dashboard.yourdomain.com:~/crawfleet/data/.ssh/
```

The container mounts `./data` for persistent storage.

## What's in the Docker build

Multi-stage, node:22-alpine. Four stages:

1. **deps** — all dependencies
2. **prod-deps** — production only
3. **builder** — `next build` + esbuild compiles `server.ts`
4. **runner** — minimal image with cloudflared, prod deps, built assets. Runs as `node` user.

The `entrypoint.sh` at container start:
1. Replaces Supabase URL placeholders in the client JS bundles (a Next.js quirk — public env vars are inlined at build time)
2. Runs `node-pg-migrate up`
3. Starts the custom server

## Updating

Code change → deploy:

```bash
./scripts/deploy-app.sh deploy
```

Rebuilds, pushes, pulls on server, restarts container. That's it.

## Backups (optional)

Want to back up the `data/` directory to GCS periodically?

```bash
BACKUP_BUCKET="your-gcs-bucket"
BACKUP_INTERVAL_MIN="15"
```

Crawfleet handles the rest. Copies files safely before upload — no sqlite corruption surprises.

## Health monitoring

Crawfleet periodically pings all tenant VMs. Fleet-wide stats at `/api/health`. Per-tenant health at `/api/tenants/{slug}/health`. If something's down, you'll see it on the dashboard.

# Production Deployment

Crawfleet runs as a Docker container on a GCP VM, listening on `localhost:3000` behind a Cloudflare Tunnel. This follows the same zero-trust pattern used for tenant VMs.

## Prerequisites

- Everything in [setup.md](setup.md) working locally
- `docker` and `gcloud` CLI installed
- A GCP Artifact Registry repository for container images
- A dedicated GCP VM for the dashboard (separate from tenant VMs)
- `cloudflared` installed locally

## 1. Create the dashboard VM

The dashboard has modest resource requirements since it only orchestrates tenant VMs.

```bash
gcloud compute instances create crawfleet-dashboard \
  --project=YOUR_PROJECT \
  --zone=us-central1-a \
  --machine-type=e2-small \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=20GB
```

SSH in and install Docker:

```bash
gcloud compute ssh crawfleet-dashboard --zone=us-central1-a
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in for the group change to take effect
```

## 2. Create a Cloudflare Tunnel

```bash
cloudflared tunnel create crawfleet-dashboard
cloudflared tunnel route dns crawfleet-dashboard fleet.yourdomain.com
```

Install `cloudflared` on the VM as a service, routing `fleet.yourdomain.com` to `localhost:3000`. See the [Cloudflare documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/as-a-service/) for detailed instructions.

## 3. Set up Artifact Registry

Create the repository (one-time setup):

```bash
gcloud artifacts repositories create crawfleet \
  --repository-format=docker \
  --location=us-central1

gcloud auth configure-docker us-central1-docker.pkg.dev
```

## 4. Configure deployment environment variables

Add these to your `.env`:

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
# First deployment — runs all steps
./scripts/deploy-app.sh all

# Subsequent deployments — build, push, and restart
./scripts/deploy-app.sh deploy
```

### Available commands

| Step | Command | Description |
|------|---------|-------------|
| `docker` | `deploy-app.sh docker` | Installs Docker on the server if not present |
| `build` | `deploy-app.sh build` | Builds the container image and pushes to Artifact Registry |
| `auth` | `deploy-app.sh auth` | Configures gcloud and Docker authentication on the server |
| `tunnel` | `deploy-app.sh tunnel` | Updates Cloudflare Tunnel ingress configuration |
| `deploy` | `deploy-app.sh deploy` | Builds, pushes, pulls on server, and restarts the container |
| `start` | `deploy-app.sh start` | Pulls the latest image and restarts (no rebuild) |
| `verify` | `deploy-app.sh verify` | Checks that the container is running |
| `all` | `deploy-app.sh all` | Runs all steps in sequence |

## 6. Server-side files

On the dashboard VM, create the data directory:

```bash
mkdir -p ~/crawfleet/data/.ssh
cd ~/crawfleet
```

Copy your `.env` file and SSH key to the server:

```bash
scp .env user@crawfleet-dashboard.yourdomain.com:~/crawfleet/.env
scp data/.ssh/fleet_key user@crawfleet-dashboard.yourdomain.com:~/crawfleet/data/.ssh/
```

The container mounts `./data` as a volume for persistent storage.

## Docker build details

The Dockerfile uses a multi-stage build with `node:22-alpine`:

1. **deps** — installs all dependencies
2. **prod-deps** — installs production dependencies only
3. **builder** — runs `next build`
4. **runner** — minimal image with `cloudflared`, production dependencies, and built assets (runs as `node` user)

At container startup, `entrypoint.sh`:
1. Replaces Supabase URL placeholders in client JS bundles (required because Next.js inlines `NEXT_PUBLIC_*` variables at build time)
2. Runs `node-pg-migrate up`
3. Starts the Next.js server

## Updating

To deploy code changes:

```bash
./scripts/deploy-app.sh deploy
```

This rebuilds the image, pushes it to the registry, pulls it on the server, and restarts the container.

## Backups (optional)

To enable periodic backups of the `data/` directory to Google Cloud Storage:

```bash
BACKUP_BUCKET="your-gcs-bucket"
BACKUP_INTERVAL_MIN="15"
```

Crawfleet copies files safely before uploading to avoid corruption from active databases.

## Health monitoring

Crawfleet periodically checks all tenant VMs for availability. Fleet-wide statistics are available at `/api/health`, and per-tenant health status at `/api/tenants/{slug}/health`. The dashboard displays health status for all tenants.

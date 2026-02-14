# Deploy OpenClaw Fleet Manager to Server

Build the dashboard image locally, push to Artifact Registry, and deploy on the server. Reads connection info from `.env` (`DEPLOY_*` vars).

If `$ARGUMENTS` is provided, treat it as a specific step to run (e.g., "docker", "build", "deploy"). Otherwise, run all steps in order, skipping any that are already done.

## Prerequisites

**Cloudflare Access** must be configured before first deploy. Run the setup script:
```bash
CLOUDFLARE_ACCOUNT_ID=<id> tsx scripts/setup-cloudflare-access.ts
```
Then add the output `CLOUDFLARE_TEAM_DOMAIN` and `CF_ACCESS_AUD` values to `.env`. Google Workspace IdP must be configured in the Cloudflare Access dashboard first.

Read `.env` and extract these values (fail if missing):
- `DEPLOY_HOST` — SSH hostname (e.g., `openclaw-fleet.revve.dev`)
- `DEPLOY_USER` — SSH user
- `DEPLOY_INSTANCE` — GCP instance name
- `DEPLOY_PROJECT` — GCP project ID
- `DEPLOY_ZONE` — GCP zone
- `DEPLOY_TUNNEL_ID` — Cloudflare tunnel ID
- `DEPLOY_REGISTRY` — Artifact Registry path (e.g., `asia-southeast1-docker.pkg.dev/project/repo`)

Verify SSH works:
```bash
ssh -o ConnectTimeout=10 -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "echo SSH_OK"
```

## Steps

### Step 1: Install Docker on Server

Check if Docker is already installed:
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "docker --version 2>/dev/null && echo DOCKER_OK || echo DOCKER_MISSING"
```

If missing:
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ${DEPLOY_USER}"
```

Verify docker works (may need `newgrp docker` or reconnect):
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "docker ps && echo DOCKER_OK"
```

### Step 2: Build and Push Image

Build for linux/amd64 (server architecture) and push to Artifact Registry:

```bash
# Ensure docker auth is configured
gcloud auth configure-docker $(echo ${DEPLOY_REGISTRY} | cut -d/ -f1) --quiet

# Build
docker build --platform linux/amd64 -t ${DEPLOY_REGISTRY}/dashboard:latest .

# Push
docker push ${DEPLOY_REGISTRY}/dashboard:latest
```

If the build fails, check the error. Common issues:
- Missing `.dockerignore` — should exclude node_modules, .next, data, .env, .git
- Native module errors — use pure JS alternatives

### Step 3: Sync Compose and Config Files

Only sync the files needed to run on the server (NOT the full source — the image has the app). **Never overwrite the production `.env`** — it is only seeded on first deploy.

```bash
rsync -avz \
  --include='docker-compose.yml' \
  --include='prisma/***' \
  --exclude='*' \
  -e "ssh -o ProxyCommand='cloudflared access ssh --hostname %h'" \
  ./ ${DEPLOY_USER}@${DEPLOY_HOST}:~/openclaw-fleet/
```

**First deploy only**: check if `.env` exists on the server. If missing, copy the local one as a starting point and tell the user to review production values:
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "test -f ~/openclaw-fleet/.env && echo ENV_EXISTS || echo ENV_MISSING"
```

If `ENV_MISSING`, seed the production `.env`:
```bash
rsync -avz \
  --include='.env' \
  --exclude='*' \
  -e "ssh -o ProxyCommand='cloudflared access ssh --hostname %h'" \
  ./ ${DEPLOY_USER}@${DEPLOY_HOST}:~/openclaw-fleet/
```
Then remind the user to update these values on the server for production:
- `BASE_DOMAIN` — actual domain (e.g., `revve.dev`, not `localhost`)
- `SESSION_SECRET` — unique random string
- `CLOUDFLARE_TEAM_DOMAIN` — e.g., "revve"
- `CF_ACCESS_AUD` — audience tag from Cloudflare Access app
- API keys — production keys

### Step 4: Configure Server Docker Auth

The server needs permission to pull from Artifact Registry. Use the GCP service account:
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "gcloud auth configure-docker $(echo ${DEPLOY_REGISTRY} | cut -d/ -f1) --quiet 2>/dev/null || echo 'GCLOUD_MISSING'"
```

If gcloud is missing on the server, install it:
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "curl -fsSL https://sdk.cloud.google.com | bash -s -- --disable-prompts && echo 'PATH=\$HOME/google-cloud-sdk/bin:\$PATH' >> ~/.bashrc"
```

Then authenticate:
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "~/google-cloud-sdk/bin/gcloud auth login --no-launch-browser"
```

Follow the auth URL flow. Then configure docker:
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "~/google-cloud-sdk/bin/gcloud auth configure-docker $(echo ${DEPLOY_REGISTRY} | cut -d/ -f1) --quiet"
```

### Step 5: Set Up Docker Network

```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "docker network create fleet-proxy 2>/dev/null; echo NETWORK_OK"
```

### Step 6: Update Tunnel Ingress for HTTP

Add HTTP routing to the existing tunnel. Use the Cloudflare API:

```bash
CF_ACCT="${CLOUDFLARE_ACCOUNT_ID}"
CF_TOKEN="${CLOUDFLARE_API_TOKEN}"
TUNNEL_ID="${DEPLOY_TUNNEL_ID}"

curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCT}/cfd_tunnel/${TUNNEL_ID}/configurations" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "ingress": [
        {
          "hostname": "'${DEPLOY_HOST}'",
          "service": "ssh://localhost:22"
        },
        {
          "hostname": "fleet.'${BASE_DOMAIN}'",
          "service": "http://localhost:3000"
        },
        {
          "hostname": "*.'${BASE_DOMAIN}'",
          "service": "http://localhost:80"
        },
        {
          "service": "http_status:404"
        }
      ]
    }
  }'
```

Create DNS CNAME records:
```bash
cloudflared tunnel route dns ${DEPLOY_INSTANCE} fleet.${BASE_DOMAIN}
```

For wildcard `*.${BASE_DOMAIN}`, add a CNAME via Cloudflare API or dashboard pointing to `${DEPLOY_TUNNEL_ID}.cfargotunnel.com`.

### Step 7: Pull and Start

```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "cd ~/openclaw-fleet && docker compose pull && docker compose up -d"
```

Check status:
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "cd ~/openclaw-fleet && docker compose ps"
```

Check logs if unhealthy:
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "cd ~/openclaw-fleet && docker compose logs --tail=50"
```

### Step 8: Verify

1. **Dashboard reachable**:
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "curl -sL http://localhost:3000 | head -20"
```

2. **Compose healthy**:
```bash
ssh -o ProxyCommand="cloudflared access ssh --hostname %h" \
  ${DEPLOY_USER}@${DEPLOY_HOST} "cd ~/openclaw-fleet && docker compose ps"
```

### Step 9: Report

```
=== App Deployed ===
Image:       ${DEPLOY_REGISTRY}/dashboard:latest
Dashboard:   fleet.${BASE_DOMAIN}
SSH:         ssh ${DEPLOY_USER}@${DEPLOY_HOST}
Containers:  <docker compose ps output>

To redeploy after code changes:
  /deploy-app build   (rebuild + push image)
  /deploy-app deploy  (pull + restart on server)
```

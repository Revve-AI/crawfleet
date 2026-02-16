#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
else
  echo "ERROR: .env not found in $PROJECT_DIR"
  exit 1
fi

# Validate required vars
for var in DEPLOY_HOST DEPLOY_USER DEPLOY_INSTANCE DEPLOY_PROJECT DEPLOY_ZONE DEPLOY_TUNNEL_ID DEPLOY_REGISTRY BASE_DOMAIN; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set in .env"
    exit 1
  fi
done

SSH_CMD=(ssh -o ConnectTimeout=10 -o "ProxyCommand=cloudflared access ssh --hostname %h")
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
REGISTRY_HOST="$(echo "$DEPLOY_REGISTRY" | cut -d/ -f1)"
IMAGE="${DEPLOY_REGISTRY}/dashboard:latest"

remote() {
  "${SSH_CMD[@]}" "$REMOTE" "$@"
}

step_docker() {
  echo "=== Step 1: Ensure Docker on server ==="
  result=$(remote "docker --version 2>/dev/null && echo DOCKER_OK || echo DOCKER_MISSING")
  if echo "$result" | grep -q "DOCKER_OK"; then
    echo "Docker already installed"
  else
    echo "Installing Docker..."
    remote "curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ${DEPLOY_USER}"
    echo "Docker installed — you may need to reconnect for group changes"
  fi
  remote "docker ps >/dev/null && echo 'Docker working'"
}

step_build() {
  echo "=== Step 2: Build and push image ==="
  cd "$PROJECT_DIR"
  gcloud auth configure-docker "$REGISTRY_HOST" --quiet
  docker build --platform linux/amd64 -t "$IMAGE" .
  docker push "$IMAGE"
  echo "Pushed $IMAGE"
}

step_auth() {
  echo "=== Step 4: Configure server Docker auth ==="
  result=$(remote "gcloud auth configure-docker $REGISTRY_HOST --quiet 2>/dev/null && echo GCLOUD_OK || echo GCLOUD_MISSING")
  if echo "$result" | grep -q "GCLOUD_MISSING"; then
    echo "gcloud missing on server — installing..."
    remote "curl -fsSL https://sdk.cloud.google.com | bash -s -- --disable-prompts && echo 'PATH=\$HOME/google-cloud-sdk/bin:\$PATH' >> ~/.bashrc"
    echo "Run this manually to authenticate:"
    echo "  ssh $REMOTE '~/google-cloud-sdk/bin/gcloud auth login --no-launch-browser'"
    echo "  ssh $REMOTE '~/google-cloud-sdk/bin/gcloud auth configure-docker $REGISTRY_HOST --quiet'"
    echo ""
    read -p "Press enter once server gcloud auth is done..."
  else
    echo "Docker auth configured"
  fi
}

step_network() {
  echo "=== Step 5: Set up Docker network ==="
  remote "docker network create fleet-proxy 2>/dev/null || true; echo NETWORK_OK"
}

step_tunnel() {
  echo "=== Step 6: Update tunnel ingress ==="
  CF_ACCT="${CLOUDFLARE_ACCOUNT_ID:-}"
  CF_TOKEN="${CLOUDFLARE_API_KEY:-}"

  if [ -z "$CF_ACCT" ] || [ -z "$CF_TOKEN" ]; then
    echo "SKIP: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_KEY not set — configure tunnel manually"
    return
  fi

  curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCT}/cfd_tunnel/${DEPLOY_TUNNEL_ID}/configurations" \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{
      "config": {
        "ingress": [
          {"hostname": "'"${DEPLOY_HOST}"'", "service": "ssh://localhost:22"},
          {"hostname": "fleet.'"${BASE_DOMAIN}"'", "service": "http://localhost:80"},
          {"hostname": "*.'"${BASE_DOMAIN}"'", "service": "http://localhost:80"},
          {"service": "http_status:404"}
        ]
      }
    }'
  echo ""

  cloudflared tunnel route dns "${DEPLOY_INSTANCE}" "fleet.${BASE_DOMAIN}" 2>/dev/null || true
  echo "Tunnel ingress updated"
  echo "NOTE: Wildcard *.${BASE_DOMAIN} CNAME to ${DEPLOY_TUNNEL_ID}.cfargotunnel.com must be set in Cloudflare dashboard"
}

step_deploy() {
  echo "=== Step 7: Pull and start ==="
  remote "cd ~/openclaw-fleet && docker compose pull && docker compose up -d"
  echo ""
  remote "cd ~/openclaw-fleet && docker compose ps"
}

step_verify() {
  echo "=== Step 8: Verify ==="
  echo "Checking dashboard..."
  remote "curl -sL -o /dev/null -w '%{http_code}' http://localhost:3000" || true
  echo ""
  echo "Container status:"
  remote "cd ~/openclaw-fleet && docker compose ps"
}

step_report() {
  echo ""
  echo "=== App Deployed ==="
  echo "Image:       $IMAGE"
  echo "Dashboard:   fleet.${BASE_DOMAIN}"
  echo "SSH:         ssh ${REMOTE}"
  echo ""
  echo "To redeploy after code changes:"
  echo "  ./scripts/deploy-app.sh build    (rebuild + push image)"
  echo "  ./scripts/deploy-app.sh deploy   (pull + restart on server)"
}

# ---- Main ----

STEP="${1:-all}"

case "$STEP" in
  docker)   step_docker ;;
  build)    step_build ;;
  auth)     step_auth ;;
  network)  step_network ;;
  tunnel)   step_tunnel ;;
  deploy)   step_build; step_deploy; step_verify; step_report ;;
  start)    step_deploy ;;
  verify)   step_verify ;;
  all)
    echo "Verifying SSH..."
    remote "echo SSH_OK"
    echo ""
    step_docker
    step_build
    step_auth
    step_network
    step_tunnel
    step_deploy
    step_verify
    step_report
    ;;
  *)
    echo "Usage: $0 [docker|build|auth|network|tunnel|deploy|start|verify|all]"
    echo ""
    echo "  all      — run all steps (default)"
    echo "  build    — build dashboard image and push to registry"
    echo "  deploy   — build + pull + restart (typical redeploy)"
    echo "  start    — just pull and restart on server"
    echo "  verify   — check if dashboard is running"
    echo ""
    echo "First-time setup steps:"
    echo "  docker   — install Docker on server"
    echo "  auth     — configure server gcloud/docker auth"
    echo "  network  — create fleet-proxy Docker network"
    echo "  tunnel   — update Cloudflare tunnel ingress"
    exit 1
    ;;
esac

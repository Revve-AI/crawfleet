#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Only require tag and registry
TAG="${1:?Usage: $0 <tag> [registry]}"
REGISTRY="${2:-}"

CLONE_DIR="${OPENCLAW_CLONE_DIR:-/tmp/openclaw-build}"
REPO_URL="${OPENCLAW_REPO_URL:-https://github.com/openclaw/openclaw.git}"
APT_PACKAGES="${OPENCLAW_DOCKER_APT_PACKAGES:-git curl wget jq socat python3 python3-pip ffmpeg build-essential procps}"

IMG_TAG="revve-${TAG}"

# Clone or fetch
if [ -d "$CLONE_DIR/.git" ]; then
  echo "Fetching tags in $CLONE_DIR ..."
  git -C "$CLONE_DIR" fetch --tags --force
else
  echo "Cloning OpenClaw repo into $CLONE_DIR ..."
  git clone "$REPO_URL" "$CLONE_DIR"
fi

git -C "$CLONE_DIR" checkout "tags/${TAG}"

# Replace upstream Dockerfile with our custom one
cp "$PROJECT_DIR/openclaw.Dockerfile" "$CLONE_DIR/Dockerfile"

# Build
cd "$CLONE_DIR"
docker build --platform linux/amd64 \
  --build-arg OPENCLAW_DOCKER_APT_PACKAGES="$APT_PACKAGES" \
  -t "openclaw:${IMG_TAG}" .

echo ""
echo "Built openclaw:${IMG_TAG}"

# Push to registry if provided
if [ -n "$REGISTRY" ]; then
  REGISTRY_HOST="$(echo "$REGISTRY" | cut -d/ -f1)"
  gcloud auth configure-docker "$REGISTRY_HOST" --quiet
  REMOTE_IMG="${REGISTRY}/openclaw:${IMG_TAG}"
  docker tag "openclaw:${IMG_TAG}" "$REMOTE_IMG"
  docker push "$REMOTE_IMG"
  echo "Pushed $REMOTE_IMG"
fi

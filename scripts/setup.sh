#!/bin/bash
set -euo pipefail

echo "=== OpenClaw Fleet Server Setup ==="

# Install Docker if not present
if ! command -v docker &> /dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  echo "Docker installed. You may need to log out and back in."
fi

# Create fleet-proxy network
docker network create fleet-proxy 2>/dev/null || echo "Network fleet-proxy already exists"

# Pull OpenClaw image
echo "Pulling OpenClaw image..."
docker pull openclaw/openclaw:latest

# Create data directories
mkdir -p data/tenants

# Copy env example if no .env exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example -- please edit it with your values"
fi

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Edit .env with your domain, API keys, and admin password hash"
echo "  2. Run: pnpm db:seed <password> to generate admin password hash"
echo "  3. Run: docker compose up -d"
echo "  4. Point DNS: A record + wildcard *.yourdomain.com to this server's IP"

#!/bin/bash
set -euo pipefail

echo "=== OpenClaw Fleet Server Setup ==="

# Install Docker if not present (dashboard runs in Docker)
if ! command -v docker &> /dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  echo "Docker installed. You may need to log out and back in."
fi

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
echo "  1. Edit .env with your Supabase credentials, API keys, and cloud provider config"
echo "  2. Run: docker compose up -d"

interface SetupOptions {
  sshPublicKey: string;
  gitTag: string;
  tunnelToken: string;
  envVars: Record<string, string>;
  gatewayToken: string;
}

export function generateSetupScript(opts: SetupOptions): string {
  const envLines = Object.entries(opts.envVars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  return `#!/bin/bash
set -euo pipefail

echo "=== Fleet VPS Setup ==="

# ─── Create non-root user ───
if ! id openclaw &>/dev/null; then
  useradd -m -s /bin/bash openclaw
  echo "openclaw ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/openclaw
  chmod 0440 /etc/sudoers.d/openclaw
fi

# Copy SSH authorized keys to openclaw user
mkdir -p /home/openclaw/.ssh
echo '${opts.sshPublicKey}' > /home/openclaw/.ssh/authorized_keys
chmod 700 /home/openclaw/.ssh
chmod 600 /home/openclaw/.ssh/authorized_keys
chown -R openclaw:openclaw /home/openclaw/.ssh

# ─── SSH hardening ───
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# ─── Firewall ───
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ufw fail2ban > /dev/null

ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw --force enable

# ─── Auto-updates ───
apt-get install -y -qq unattended-upgrades > /dev/null

# ─── Install OpenClaw via official installer ───
# Installs Node.js, git, build tools, and OpenClaw globally via npm
curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash -s -- --no-prompt --no-onboard

# ─── Install Homebrew (as openclaw user) ───
su - openclaw -c 'NONINTERACTIVE=1 /bin/bash -c "\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
# Add brew to openclaw's PATH
echo 'eval "\$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> /home/openclaw/.bashrc
chown openclaw:openclaw /home/openclaw/.bashrc

# ─── Enable user lingering (so user services start at boot without login) ───
loginctl enable-linger openclaw

# Start the user manager immediately (lingering alone doesn't start it until next boot)
OPENCLAW_UID=\$(id -u openclaw)
systemctl start user@\${OPENCLAW_UID}.service
# Wait for the user runtime directory to be created
for i in \$(seq 1 15); do
  [ -d /run/user/\${OPENCLAW_UID} ] && break
  sleep 1
done

# ─── Environment file (read by gateway service via drop-in) ───
mkdir -p /home/openclaw/.openclaw
chown openclaw:openclaw /home/openclaw/.openclaw
chmod 700 /home/openclaw/.openclaw
cat > /home/openclaw/.openclaw/fleet.env << 'ENVEOF'
OPENCLAW_GATEWAY_TOKEN=${opts.gatewayToken}
HOME=/home/openclaw
TERM=xterm-256color
NODE_OPTIONS=--max-old-space-size=1024
${envLines}
ENVEOF
chmod 600 /home/openclaw/.openclaw/fleet.env
chown openclaw:openclaw /home/openclaw/.openclaw/fleet.env

# ─── Install OpenClaw's native gateway service + fleet env drop-in ───
su - openclaw -c 'export XDG_RUNTIME_DIR=/run/user/\$(id -u) && openclaw gateway install --token ${opts.gatewayToken}'

# Add drop-in: inject fleet env vars + allow-unconfigured (no openclaw.json on fresh installs)
OPENCLAW_BIN=\$(which openclaw 2>/dev/null || echo "/usr/local/bin/openclaw")
mkdir -p /home/openclaw/.config/systemd/user/openclaw-gateway.service.d
cat > /home/openclaw/.config/systemd/user/openclaw-gateway.service.d/fleet.conf << DROPEOF
[Service]
EnvironmentFile=/home/openclaw/.openclaw/fleet.env
ExecStart=
ExecStart=\${OPENCLAW_BIN} gateway --port 18789 --allow-unconfigured
DROPEOF
chown -R openclaw:openclaw /home/openclaw/.config/systemd/user/openclaw-gateway.service.d

su - openclaw -c 'export XDG_RUNTIME_DIR=/run/user/\$(id -u) && systemctl --user daemon-reload'

echo "=== Setup complete ==="
`;
}

export function generateInstallCloudflaredScript(tunnelToken: string): string {
  return `#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "=== Installing cloudflared ==="

# Install cloudflared
if ! command -v cloudflared &>/dev/null; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \\
    | tee /etc/apt/sources.list.d/cloudflared.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq cloudflared > /dev/null
fi

# Install as service with tunnel token
cloudflared service install ${tunnelToken}
systemctl enable cloudflared
systemctl start cloudflared

echo "=== cloudflared installed ==="
`;
}

export function generateDeployScript(gitTag: string): string {
  return `#!/bin/bash
set -euo pipefail

echo "=== Deploying OpenClaw ==="

# Re-run installer to upgrade (needs sudo for global npm install)
sudo bash -c 'curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-prompt --no-onboard'

# Reinstall native service (picks up new binary version)
export XDG_RUNTIME_DIR=/run/user/\$(id -u)
systemctl --user stop openclaw-gateway 2>/dev/null || true
openclaw gateway install --force
systemctl --user daemon-reload
systemctl --user start openclaw-gateway

echo "=== Deploy complete ==="
`;
}

export function generateLockdownScript(): string {
  return `#!/bin/bash
set -euo pipefail

echo "=== Locking down firewall ==="

# Remove the SSH allow rule and deny SSH + DNS inbound
ufw delete allow ssh || true
ufw deny 22/tcp
ufw deny 53
ufw reload

echo "=== Firewall locked down: zero open ports ==="
`;
}

export function generateAddUserSshKeyScript(publicKey: string): string {
  return `#!/bin/bash
set -euo pipefail

AUTHORIZED_KEYS="/home/openclaw/.ssh/authorized_keys"

# Ensure .ssh dir exists
mkdir -p /home/openclaw/.ssh
touch "\${AUTHORIZED_KEYS}"

# Remove any existing user key (lines after the fleet key)
# The fleet key is always line 1; user keys are appended after a marker comment
sed -i '/^# user-ssh-key$/,\$d' "\${AUTHORIZED_KEYS}"

# Append user key
echo '# user-ssh-key' >> "\${AUTHORIZED_KEYS}"
echo '${publicKey}' >> "\${AUTHORIZED_KEYS}"

chmod 700 /home/openclaw/.ssh
chmod 600 "\${AUTHORIZED_KEYS}"
chown -R openclaw:openclaw /home/openclaw/.ssh

echo "=== User SSH key installed ==="
`;
}

export function generateRemoveUserSshKeyScript(): string {
  return `#!/bin/bash
set -euo pipefail

AUTHORIZED_KEYS="/home/openclaw/.ssh/authorized_keys"

# Remove user key section
sed -i '/^# user-ssh-key$/,\$d' "\${AUTHORIZED_KEYS}"

echo "=== User SSH key removed ==="
`;
}

export function generateWriteConfigScript(envVars: Record<string, string>, gatewayToken: string): string {
  const envLines = Object.entries(envVars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  return `#!/bin/bash
set -euo pipefail

cat > /home/openclaw/.openclaw/fleet.env << 'ENVEOF'
OPENCLAW_GATEWAY_TOKEN=${gatewayToken}
HOME=/home/openclaw
TERM=xterm-256color
NODE_OPTIONS=--max-old-space-size=1024
${envLines}
ENVEOF
chmod 600 /home/openclaw/.openclaw/fleet.env
chown openclaw:openclaw /home/openclaw/.openclaw/fleet.env
`;
}

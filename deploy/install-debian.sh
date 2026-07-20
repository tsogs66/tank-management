#!/bin/bash
# Install Vessel Fuel TMS on Debian (bare metal or Proxmox LXC)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tank-management}"
APP_USER="${APP_USER:-fueltms}"
PORT="${PORT:-3080}"

echo "==> Installing Vessel Fuel Tank Management into ${APP_DIR}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (or sudo)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg rsync python3 python3-pip python3-venv

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

mkdir -p "$APP_DIR"
# Copy from current working tree if running from repo
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ "$REPO_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude 'data/vessels/*' \
    "$REPO_DIR/" "$APP_DIR/"
fi

cd "$APP_DIR"
npm install --omit=dev
if [[ -f requirements.txt ]]; then
  pip3 install --break-system-packages -r requirements.txt 2>/dev/null \
    || pip3 install -r requirements.txt
fi
node scripts/seed-vessel.js || true
mkdir -p "$APP_DIR/data/vessels"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cat > /etc/systemd/system/tank-management.service <<EOF
[Unit]
Description=Vessel Fuel Tank Management
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=0.0.0.0
ExecStart=/usr/bin/node $APP_DIR/server/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now tank-management.service

echo ""
echo "Installed. Open: http://$(hostname -I | awk '{print $1}'):${PORT}"
echo "Data directory: ${APP_DIR}/data/vessels/"
echo "Logs: journalctl -u tank-management -f"
echo ""
echo "For Proxmox LXC: create a Debian CT, run this script inside, map port ${PORT}."
echo "Configure peer sync URL in Backup/Sync settings to mirror databases."

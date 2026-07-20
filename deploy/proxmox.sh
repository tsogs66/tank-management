#!/bin/bash
# One-liner (run as root inside a Debian Proxmox LXC):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/proxmox.sh)"
#
# Optional env vars: PORT=3080 BRANCH=main APP_DIR=/opt/tank-management
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tsogs66/tank-management.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/tank-management}"
APP_USER="${APP_USER:-fueltms}"
PORT="${PORT:-3080}"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root inside the Proxmox LXC (Debian)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git rsync

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE 'v(1[89]|[2-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP/repo"

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude 'data/vessels/*' \
  "$TMP/repo/" "$APP_DIR/"

cd "$APP_DIR"
npm install --omit=dev
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

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "Vessel Fuel TMS ready: http://${IP:-<ct-ip>}:${PORT}"
echo "Data: ${APP_DIR}/data/vessels/"
echo "Logs: journalctl -u tank-management -f"

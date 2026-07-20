#!/bin/bash
# Proxmox LXC (Debian) — update Vessel Fuel Tank Management in place
#
# One-liner (as root inside the CT):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/update.sh)"
#
# Preserves data/vessels/ and settings. Pulls latest code, reinstalls deps, restarts service.
# Optional env: PORT=3080 APP_DIR=/opt/tank-management BRANCH=main REPO_URL=...
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tsogs66/tank-management.git}"
BRANCH="${BRANCH:-${REPO_REF:-main}}"
APP_DIR="${APP_DIR:-/opt/tank-management}"
APP_USER="${APP_USER:-fueltms}"
PORT="${PORT:-3080}"
SERVICE_NAME="${SERVICE_NAME:-tank-management}"

if [[ ${EUID:-0} -ne 0 ]]; then
  echo "Run as root inside the Proxmox LXC (Debian)."
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "App not found at $APP_DIR — run the install one-liner first:"
  echo "  bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/proxmox.sh)\""
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates rsync

# Ensure Node.js present / reasonably current
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Fetching ${REPO_URL} @ ${BRANCH}"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP/tank-management"

echo "==> Backing up live data (vessels + settings)"
BACKUP_DIR="${APP_DIR}/.update-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
[[ -d "${APP_DIR}/data" ]] && cp -a "${APP_DIR}/data" "$BACKUP_DIR/data" || true

echo "==> Syncing application files (preserving data/vessels and settings)"
rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude 'data/' \
  --exclude '.update-backup-*/' \
  "$TMP/tank-management/" "$APP_DIR/"

# Keep existing data; only ensure directory exists
mkdir -p "${APP_DIR}/data/vessels"

# Restore data if rsync somehow removed it (should not — excluded)
if [[ ! -d "${APP_DIR}/data" && -d "${BACKUP_DIR}/data" ]]; then
  cp -a "${BACKUP_DIR}/data" "${APP_DIR}/data"
fi

cd "$APP_DIR"
echo "==> Installing npm dependencies"
npm install --omit=dev

# Refresh systemd unit (port / paths) without wiping user data
cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
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

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# Keep only the latest 5 update backups
ls -1dt "${APP_DIR}"/.update-backup-* 2>/dev/null | tail -n +6 | xargs -r rm -rf

echo ""
echo "Updated successfully."
echo "  URL:  http://$(hostname -I | awk '{print $1}'):${PORT}"
echo "  Data: ${APP_DIR}/data/vessels/  (preserved)"
echo "  Backup snapshot: ${BACKUP_DIR}"
echo "  Status: systemctl status ${SERVICE_NAME}"
echo "  Logs:   journalctl -u ${SERVICE_NAME} -f"

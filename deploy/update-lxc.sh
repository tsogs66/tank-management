#!/bin/bash
# Proxmox HOST script — update Fuel TMS inside an existing LXC
#
# Run as root on the Proxmox VE host:
#   CTID=130 bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/update-lxc.sh)"
#
# Optional: BRANCH=main PORT=3080 CTID=130
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tsogs66/tank-management.git}"
BRANCH="${BRANCH:-${REPO_REF:-main}}"
RAW_BASE="${RAW_BASE:-https://raw.githubusercontent.com/tsogs66/tank-management/${BRANCH}}"
CTID="${CTID:-}"
PORT="${PORT:-3080}"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ ${EUID:-0} -eq 0 ]] || die "Run as root on the Proxmox VE host."
command -v pct >/dev/null 2>&1 || die "pct not found — run on the Proxmox host."

if [[ -z "$CTID" ]]; then
  # Prefer hostname fuel-tms
  CTID="$(pct list 2>/dev/null | awk 'NR>1 && $3=="fuel-tms" {print $1; exit}')"
fi
if [[ -z "$CTID" ]]; then
  # Fallback: first running CT whose config mentions tank-management (best-effort)
  CTID="$(pct list 2>/dev/null | awk 'NR>1 && $2=="running" {print $1; exit}')"
fi
[[ -n "$CTID" ]] || die "Set CTID=<id> (e.g. CTID=130). No matching CT found."

pct status "$CTID" >/dev/null 2>&1 || die "CT $CTID not found."

status="$(pct status "$CTID" | awk '{print $2}')"
if [[ "$status" != "running" ]]; then
  echo "==> Starting CT ${CTID}"
  pct start "$CTID"
  sleep 3
fi

echo "==> Updating Fuel TMS inside CT ${CTID} (data preserved)"
pct exec "$CTID" -- env BRANCH="$BRANCH" REPO_URL="$REPO_URL" PORT="$PORT" \
  bash -c "bash -c \"\$(curl -fsSL '${RAW_BASE}/deploy/update.sh)\""

GUEST_IP="$(pct exec "$CTID" -- bash -c "hostname -I 2>/dev/null | awk '{print \$1}'" 2>/dev/null || true)"
echo ""
echo "Update complete for CT ${CTID}."
[[ -n "$GUEST_IP" ]] && echo "Open: http://${GUEST_IP}:${PORT}"

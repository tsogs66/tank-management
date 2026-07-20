#!/bin/bash
# Proxmox HOST script — create a Debian LXC and install Vessel Fuel TMS inside it
#
# Run as root on the Proxmox VE host (not inside a CT):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/create-lxc.sh)"
#
# Optional env:
#   CTID=130 HOSTNAME=fuel-tms PASSWORD=... STORAGE=local-lvm TEMPLATE_STORAGE=local
#   BRIDGE=vmbr0 CORES=2 MEMORY=1024 DISK=8 PORT=3080 IP=dhcp
#   STATIC_IP=192.168.1.50/24 GATEWAY=192.168.1.1 BRANCH=main
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tsogs66/tank-management.git}"
BRANCH="${BRANCH:-${REPO_REF:-main}}"
RAW_BASE="${RAW_BASE:-https://raw.githubusercontent.com/tsogs66/tank-management/${BRANCH}}"

CTID="${CTID:-}"
HOSTNAME="${HOSTNAME:-fuel-tms}"
PASSWORD="${PASSWORD:-FuelTMS!ChangeMe}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
CORES="${CORES:-2}"
MEMORY="${MEMORY:-1024}"
SWAP="${SWAP:-512}"
DISK="${DISK:-8}"
PORT="${PORT:-3080}"
IP="${IP:-dhcp}"                 # dhcp | static (use STATIC_IP + GATEWAY)
STATIC_IP="${STATIC_IP:-}"
GATEWAY="${GATEWAY:-}"
UNPRIVILEGED="${UNPRIVILEGED:-1}"
NESTING="${NESTING:-1}"
ONBOOT="${ONBOOT:-1}"
START_TIMEOUT="${START_TIMEOUT:-120}"

die() { echo "ERROR: $*" >&2; exit 1; }

if [[ ${EUID:-0} -ne 0 ]]; then
  die "Run as root on the Proxmox VE host."
fi

command -v pct >/dev/null 2>&1 || die "pct not found — this script must run on the Proxmox host."
command -v pveam >/dev/null 2>&1 || die "pveam not found — Proxmox VE tools required."

# Pick next free CTID if not set
if [[ -z "$CTID" ]]; then
  CTID=130
  while pct status "$CTID" &>/dev/null; do
    CTID=$((CTID + 1))
  done
fi

if pct status "$CTID" &>/dev/null; then
  die "CT $CTID already exists. Set CTID= to a free ID, or destroy it first: pct destroy $CTID"
fi

echo "==> Proxmox Fuel TMS LXC creator"
echo "    CTID=$CTID  HOSTNAME=$HOSTNAME  STORAGE=$STORAGE  PORT=$PORT"

# Refresh appliance list and select latest Debian standard amd64 template
echo "==> Resolving Debian LXC template"
pveam update >/dev/null 2>&1 || true

TEMPLATE_NAME="${TEMPLATE_NAME:-}"
if [[ -z "$TEMPLATE_NAME" ]]; then
  TEMPLATE_NAME="$(
    pveam available --section system 2>/dev/null \
      | awk '/debian-[0-9]+-standard_.*_amd64/ {print $2}' \
      | sort -V \
      | tail -n1
  )"
fi
[[ -n "$TEMPLATE_NAME" ]] || die "No Debian standard amd64 template found in pveam available."

TEMPLATE_VOL="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE_NAME}"
if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -qF "$TEMPLATE_NAME"; then
  echo "==> Downloading template ${TEMPLATE_NAME} to ${TEMPLATE_STORAGE}"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE_NAME"
else
  echo "==> Template already present: ${TEMPLATE_NAME}"
fi

# Network config
if [[ "$IP" == "static" ]]; then
  [[ -n "$STATIC_IP" && -n "$GATEWAY" ]] || die "STATIC_IP and GATEWAY required when IP=static"
  NET0="name=eth0,bridge=${BRIDGE},ip=${STATIC_IP},gw=${GATEWAY},type=veth"
else
  NET0="name=eth0,bridge=${BRIDGE},ip=dhcp,type=veth"
fi

FEATURES="nesting=${NESTING}"

echo "==> Creating CT ${CTID} (${HOSTNAME})"
pct create "$CTID" "$TEMPLATE_VOL" \
  --hostname "$HOSTNAME" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap "$SWAP" \
  --rootfs "${STORAGE}:${DISK}" \
  --net0 "$NET0" \
  --unprivileged "$UNPRIVILEGED" \
  --features "$FEATURES" \
  --onboot "$ONBOOT" \
  --password "$PASSWORD" \
  --ostype debian \
  --timezone host \
  --start 0

echo "==> Starting CT ${CTID}"
pct start "$CTID"

# Wait for network / systemd inside CT
echo "==> Waiting for CT to become ready"
deadline=$((SECONDS + START_TIMEOUT))
ready=0
while (( SECONDS < deadline )); do
  if pct exec "$CTID" -- true >/dev/null 2>&1; then
    # Prefer network reachability for apt
    if pct exec "$CTID" -- bash -c 'getent hosts deb.debian.org >/dev/null 2>&1 || ping -c1 -W2 1.1.1.1 >/dev/null 2>&1'; then
      ready=1
      break
    fi
    ready=1
  fi
  sleep 2
done
[[ "$ready" -eq 1 ]] || die "CT ${CTID} did not become ready within ${START_TIMEOUT}s"

echo "==> Installing Fuel TMS inside CT ${CTID}"
pct exec "$CTID" -- bash -c "apt-get update -qq && apt-get install -y -qq curl ca-certificates"
pct exec "$CTID" -- env \
  BRANCH="$BRANCH" \
  REPO_URL="$REPO_URL" \
  PORT="$PORT" \
  bash -c "bash -c \"\$(curl -fsSL '${RAW_BASE}/deploy/proxmox.sh')\""

# Discover guest IP for the summary
GUEST_IP="$(pct exec "$CTID" -- bash -c "hostname -I 2>/dev/null | awk '{print \$1}'" 2>/dev/null || true)"
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

echo ""
echo "=============================================="
echo " Fuel TMS LXC created and installed"
echo "=============================================="
echo "  CTID:       ${CTID}"
echo "  Hostname:   ${HOSTNAME}"
echo "  Root pass:  ${PASSWORD}"
echo "  App port:   ${PORT}"
if [[ -n "$GUEST_IP" ]]; then
  echo "  Guest IP:   ${GUEST_IP}"
  echo "  Open:       http://${GUEST_IP}:${PORT}"
else
  echo "  Open:       http://<guest-ip>:${PORT}"
  echo "  (find IP:   pct exec ${CTID} -- hostname -I)"
fi
echo ""
echo "  Enter CT:   pct enter ${CTID}"
echo "  Update app: pct exec ${CTID} -- bash -c \"\$(curl -fsSL ${RAW_BASE}/deploy/update.sh)\""
echo "  Or host:    CTID=${CTID} bash -c \"\$(curl -fsSL ${RAW_BASE}/deploy/update-lxc.sh)\""
echo "=============================================="

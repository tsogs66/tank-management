#!/bin/bash
# Proxmox LXC (Debian) — Vessel Fuel Tank Management one-shot installer
# Usage (as root inside the CT):
#   curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/proxmox.sh | bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tsogs66/tank-management.git}"
REPO_REF="${REPO_REF:-main}"
APP_DIR="${APP_DIR:-/opt/tank-management}"
PORT="${PORT:-3080}"

if [[ ${EUID:-0} -ne 0 ]]; then
  echo "Run as root inside the Proxmox LXC (Debian)."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates rsync

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$TMP/tank-management"
APP_DIR="$APP_DIR" PORT="$PORT" bash "$TMP/tank-management/deploy/install-debian.sh"

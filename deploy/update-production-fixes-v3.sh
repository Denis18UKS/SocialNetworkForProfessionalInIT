#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
PAYLOAD="deploy/payloads/update-production-fixes-v3.full.sh.gz.b64"
TMP="$(mktemp /tmp/socialbird-production-fixes-v3.XXXXXX.sh)"
trap 'rm -f "$TMP"' EXIT

[[ ${EUID} -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
cd "$APP_DIR"

sudo -u "$APP_USER" git fetch origin "+$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- "$PAYLOAD"

base64 -d "$PAYLOAD" | gzip -dc > "$TMP"
chmod 700 "$TMP"
bash -n "$TMP"
exec bash "$TMP"

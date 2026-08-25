#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
SOURCE="$APP_DIR/deploy/update-socialbird-final-platform.sh"
TMP="$(mktemp /tmp/socialbird-final-no-disk-guard.XXXXXX.sh)"
TMP2="$(mktemp /tmp/socialbird-final-unrestricted.XXXXXX.sh)"
trap 'rm -f "$TMP" "$TMP2"' EXIT

[[ ${EUID} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
cd "$APP_DIR"
[[ -f "$SOURCE" ]] || { echo "Missing $SOURCE" >&2; exit 1; }

# Ensure the unrestricted storage patcher itself is current.
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- deploy/apply-cinema-unrestricted-storage.mjs
node --check deploy/apply-cinema-unrestricted-storage.mjs

# SOCIALBIRD_UNRESTRICTED_DEPLOY_V2
# Remove only the artificial pre-deploy free-space gate. All normal build,
# verification, rollback, nginx, PM2 and smoke-test checks stay enabled.
awk '
BEGIN { skipping=0 }
/^MIN_FREE_KB=/ { next }
/^FREE_KB="\$\(df -Pk / { skipping=1; next }
skipping && /^fi$/ { skipping=0; next }
skipping { next }
{ print }
' "$SOURCE" > "$TMP"

# After the updater refreshes the backend sources from GitHub, relax C-Party
# upload size/reserve defaults before syntax and feature verification.
awk '
/^echo "\[2\/10\] Checking modules"/ {
  print "sudo -u \"$APP_USER\" node deploy/apply-cinema-unrestricted-storage.mjs"
}
{ print }
' "$TMP" > "$TMP2"

chmod 700 "$TMP2"
bash -n "$TMP2"

echo "Artificial disk preflight limit disabled."
echo "C-Party upload size/reserve limits disabled by default."
df -h "$APP_DIR" || true
exec bash "$TMP2"

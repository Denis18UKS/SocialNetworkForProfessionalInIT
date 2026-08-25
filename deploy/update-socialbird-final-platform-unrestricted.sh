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

# Ensure deploy-time C-Party patchers and the detached transcoding worker are current.
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  deploy/apply-cinema-unrestricted-storage.mjs \
  deploy/apply-cinema-format-normalization-v1.mjs \
  deploy/apply-cinema-existing-normalize-v1.mjs \
  deploy/apply-cinema-upload-compat-v1.mjs \
  backend/cinema-transcode-worker.js
node --check deploy/apply-cinema-unrestricted-storage.mjs
node --check deploy/apply-cinema-format-normalization-v1.mjs
node --check deploy/apply-cinema-existing-normalize-v1.mjs
node --check deploy/apply-cinema-upload-compat-v1.mjs
node --check backend/cinema-transcode-worker.js

# SOCIALBIRD_UNRESTRICTED_DEPLOY_V3
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

# After the updater refreshes the canonical backend sources from GitHub:
# 1) ensure FFmpeg/FFprobe exist,
# 2) add automatic browser-compatible media normalization,
# 3) add conversion controls for already-uploaded legacy media,
# 4) preserve compatibility with old Admin Desktop clients,
# 5) keep the user's unrestricted upload/storage defaults,
# 6) syntax-check the resulting backend before later build/restart stages.
awk '
/^echo "\[2\/10\] Checking modules"/ {
  print "if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then"
  print "  export DEBIAN_FRONTEND=noninteractive"
  print "  apt-get update -qq"
  print "  apt-get install -y ffmpeg"
  print "fi"
  print "ffmpeg -version | head -n 1"
  print "ffprobe -version | head -n 1"
  print "sudo -u \"$APP_USER\" node deploy/apply-cinema-format-normalization-v1.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-cinema-existing-normalize-v1.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-cinema-upload-compat-v1.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-cinema-unrestricted-storage.mjs"
  print "node --check backend/admin-cinema-library.js"
  print "node --check backend/cinema-transcode-worker.js"
}
{ print }
' "$TMP" > "$TMP2"

chmod 700 "$TMP2"
bash -n "$TMP2"

echo "Artificial disk preflight limit disabled."
echo "C-Party upload size/reserve limits disabled by default."
echo "C-Party browser video normalization enabled (FFmpeg/FFprobe)."
echo "Existing incompatible C-Party media can be normalized without re-upload."
echo "Older Admin Desktop clients remain upload-compatible during background conversion."
df -h "$APP_DIR" || true
exec bash "$TMP2"

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

# Only optional/unrestricted C-Party patchers and new additive Call V4 bridge files
# are refreshed before the generated deployment starts. Canonical application files
# are fetched by the normal updater after its rollback backup is created.
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  deploy/apply-cinema-unrestricted-storage.mjs \
  deploy/apply-cinema-format-normalization-v1.mjs \
  deploy/apply-cinema-existing-normalize-v1.mjs \
  deploy/apply-cinema-upload-compat-v1.mjs \
  deploy/apply-cparty-session-media-change-v1.mjs \
  deploy/apply-cparty-participant-media-reload-v2.mjs \
  src/components/call/NativeCallAudioBridge.tsx \
  src/components/call/PushCallDeepLinkBridge.tsx \
  backend/cinema-transcode-worker.js
node --check deploy/apply-cinema-unrestricted-storage.mjs
node --check deploy/apply-cinema-format-normalization-v1.mjs
node --check deploy/apply-cinema-existing-normalize-v1.mjs
node --check deploy/apply-cinema-upload-compat-v1.mjs
node --check deploy/apply-cparty-session-media-change-v1.mjs
node --check deploy/apply-cparty-participant-media-reload-v2.mjs
node --check backend/cinema-transcode-worker.js

# SOCIALBIRD_UNRESTRICTED_DEPLOY_V10
# Remove only the artificial pre-deploy free-space gate. Normal backup, rollback,
# syntax checks, frontend build, nginx, PM2 and smoke tests remain enabled.
awk '
BEGIN { skipping=0 }
/^MIN_FREE_KB=/ { next }
/^FREE_KB="\$\(df -Pk / { skipping=1; next }
skipping && /^fi$/ { skipping=0; next }
skipping { next }
{ print }
' "$SOURCE" > "$TMP"

# Add the user's unrestricted C-Party policy and the in-session media extensions.
# Call System V4 is already canonical in the normal updater and is deliberately not
# rewritten here.
awk '
/^echo "\[2\/10\] Checking modules"/ {
  print "test -s src/components/call/NativeCallAudioBridge.tsx"
  print "test -s src/components/call/PushCallDeepLinkBridge.tsx"
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
/sudo -u "\$APP_USER" node deploy\/apply-cparty-realtime-end-v1\.mjs/ {
  print
  print "sudo -u \"$APP_USER\" node deploy/apply-cparty-session-media-change-v1.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-cparty-participant-media-reload-v2.mjs"
  next
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
echo "C-Party custom-upload rooms can switch video during an active session."
echo "C-Party participants force-reload the new media source in realtime and via polling fallback."
echo "Unified Call System V4 enabled: mobile controls, speaking indicator, camera flip, screen share and push-answer bridge."
echo "SocialBIRD offline shell/static/private-API cache support enabled."
df -h "$APP_DIR" || true
exec bash "$TMP2"
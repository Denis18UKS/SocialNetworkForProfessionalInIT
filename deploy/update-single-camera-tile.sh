#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/single-camera-tile-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"
cp -a src/components/VoiceCallControls.tsx "$BACKUP_DIR/VoiceCallControls.tsx"
cp -a src/components/RealtimeNotifications.tsx "$BACKUP_DIR/RealtimeNotifications.tsx"
cp -a src/lib/call-media-bus.ts "$BACKUP_DIR/call-media-bus.ts"
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

rollback() {
  echo "Single-camera update failed; restoring previous frontend..." >&2
  cp -a "$BACKUP_DIR/VoiceCallControls.tsx" src/components/VoiceCallControls.tsx
  cp -a "$BACKUP_DIR/RealtimeNotifications.tsx" src/components/RealtimeNotifications.tsx
  cp -a "$BACKUP_DIR/call-media-bus.ts" src/lib/call-media-bus.ts
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -a "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/5] Fetching single-camera fix"
sudo -u "$APP_USER" git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- deploy/apply-single-camera-tile-fix.mjs

echo "[2/5] Checking patch"
node --check deploy/apply-single-camera-tile-fix.mjs

echo "[3/5] Applying hard camera dedupe"
sudo -u "$APP_USER" node deploy/apply-single-camera-tile-fix.mjs
grep -q 'SINGLE_CAMERA_TILE_FIX: one-entry-per-user-kind' src/lib/call-media-bus.ts
grep -q 'SINGLE_CAMERA_TILE_FIX: stable-peer-role' src/components/VoiceCallControls.tsx

if grep -q 'callMediaSnapshot' src/components/RealtimeNotifications.tsx; then
  grep -q 'SINGLE_CAMERA_TILE_FIX: remove-legacy-video-nodes' src/components/RealtimeNotifications.tsx
fi

echo "[4/5] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[5/5] Final verification"
node --check deploy/apply-single-camera-tile-fix.mjs

trap - ERR
chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true

echo
echo "Single-camera tile update completed."
echo "Backup: $BACKUP_DIR"
echo "Guarantee: one camera tile per participant; a separate screen-share tile may still be shown."

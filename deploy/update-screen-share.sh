#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/screen-share-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"
cp -a src/components/VoiceCallControls.tsx "$BACKUP_DIR/VoiceCallControls.tsx"
cp -a src/components/RealtimeNotifications.tsx "$BACKUP_DIR/RealtimeNotifications.tsx"
[[ -f src/lib/screen-share.ts ]] && cp -a src/lib/screen-share.ts "$BACKUP_DIR/screen-share.ts"
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

rollback() {
  echo "Screen-share update failed; restoring the previous frontend..." >&2
  cp -a "$BACKUP_DIR/VoiceCallControls.tsx" src/components/VoiceCallControls.tsx
  cp -a "$BACKUP_DIR/RealtimeNotifications.tsx" src/components/RealtimeNotifications.tsx
  if [[ -f "$BACKUP_DIR/screen-share.ts" ]]; then
    cp -a "$BACKUP_DIR/screen-share.ts" src/lib/screen-share.ts
  else
    rm -f src/lib/screen-share.ts
  fi
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -a "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/6] Fetching production branch"
sudo -u "$APP_USER" git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"

echo "[2/6] Loading screen-share helper and patch"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- src/lib/screen-share.ts deploy/apply-screen-share-audio-fixes.mjs

echo "[3/6] Checking patch syntax"
node --check deploy/apply-screen-share-audio-fixes.mjs

echo "[4/6] Applying screen audio and mobile capability handling"
sudo -u "$APP_USER" node deploy/apply-screen-share-audio-fixes.mjs
grep -q 'SCREEN_SHARE_AUDIO_FIX: outgoing' src/components/VoiceCallControls.tsx
grep -q 'SCREEN_SHARE_AUDIO_FIX: incoming' src/components/RealtimeNotifications.tsx
grep -q 'requestScreenShare' src/components/VoiceCallControls.tsx
grep -q 'requestScreenShare' src/components/RealtimeNotifications.tsx

echo "[5/6] Building production frontend"
sudo -u "$APP_USER" npm run build

echo "[6/6] Verifying deployed assets"
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

trap - ERR
chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true

echo
echo "Screen-share update completed."
echo "Backup: $BACKUP_DIR"
echo "Desktop: share audio is sent when the browser/source provides a display-audio track."
echo "Mobile: unsupported browsers now show the real platform limitation instead of a generic failure."

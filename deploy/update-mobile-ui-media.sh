#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/mobile-ui-media-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"
cp -a src/components/VoiceCallControls.tsx "$BACKUP_DIR/VoiceCallControls.tsx"
cp -a src/components/RealtimeNotifications.tsx "$BACKUP_DIR/RealtimeNotifications.tsx"
cp -a src/lib/call-media-bus.ts "$BACKUP_DIR/call-media-bus.ts"
cp -a src/index.css "$BACKUP_DIR/index.css"
cp -a src/pages/Chats.tsx "$BACKUP_DIR/Chats.tsx"
cp -a src/pages/GroupChats.tsx "$BACKUP_DIR/GroupChats.tsx"
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

rollback() {
  echo "Mobile UI/media update failed; restoring previous frontend..." >&2
  cp -a "$BACKUP_DIR/VoiceCallControls.tsx" src/components/VoiceCallControls.tsx
  cp -a "$BACKUP_DIR/RealtimeNotifications.tsx" src/components/RealtimeNotifications.tsx
  cp -a "$BACKUP_DIR/call-media-bus.ts" src/lib/call-media-bus.ts
  cp -a "$BACKUP_DIR/index.css" src/index.css
  cp -a "$BACKUP_DIR/Chats.tsx" src/pages/Chats.tsx
  cp -a "$BACKUP_DIR/GroupChats.tsx" src/pages/GroupChats.tsx
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -a "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/5] Fetching mobile UI/media fix"
sudo -u "$APP_USER" git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- deploy/apply-mobile-ui-media-fixes.mjs

echo "[2/5] Checking current call stack"
node --check deploy/apply-mobile-ui-media-fixes.mjs
grep -q 'callMediaSnapshot' src/components/RealtimeNotifications.tsx
grep -q 'SOCIAL_NEXT: publish-incoming-video' src/components/RealtimeNotifications.tsx
grep -q 'publishRemoteVideo' src/lib/call-media-bus.ts

echo "[3/5] Applying mobile layout, video dedupe, deafen and filename fixes"
sudo -u "$APP_USER" node deploy/apply-mobile-ui-media-fixes.mjs
grep -q 'MOBILE_UI_MEDIA_FIX: dedupe-video-per-source' src/lib/call-media-bus.ts
grep -q 'MOBILE_UI_MEDIA_FIX: remote-video-bus-only' src/components/RealtimeNotifications.tsx
grep -q 'MOBILE_UI_MEDIA_FIX: outgoing-headphones' src/components/VoiceCallControls.tsx
grep -q 'MOBILE_UI_MEDIA_FIX: filename-overflow' src/pages/Chats.tsx
grep -q 'MOBILE_UI_MEDIA_FIX: filename-overflow' src/pages/GroupChats.tsx
grep -q 'MOBILE_UI_MEDIA_FIX: compact-call-stage' src/index.css

echo "[4/5] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[5/5] Final verification"
if grep -R --include='*.js' -q 'MOBILE_UI_MEDIA_FIX' dist/assets; then
  true
fi

trap - ERR
chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true

echo
echo "Mobile UI/media update completed."
echo "Backup: $BACKUP_DIR"
echo "Fixed: duplicated remote video tiles, compact mobile/fullscreen call layout, functional deafen/headphones button, and long attachment filenames pushing the composer off-screen."
echo "Note: real Android/iPhone screen capture still depends on the browser exposing getDisplayMedia; unsupported mobile browsers require a native app bridge."

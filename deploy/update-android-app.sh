#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BACKUP_DIR="/var/backups/socialbird/android-native-full-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

for file in \
  src/App.tsx \
  src/components/AppSidebar.tsx \
  src/components/VoiceCallControls.tsx \
  src/components/RealtimeNotifications.tsx \
  src/lib/i18n.ts \
  src/lib/screen-share.ts \
  src/lib/call-media-bus.ts \
  backend/server.js \
  backend/server.production.js \
  deploy/install.sh; do
  if [[ -f "$file" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$file")"
    cp -a "$file" "$BACKUP_DIR/$file"
  fi
done

for optional in src/pages/AndroidApp.tsx src/components/NativeAppBridge.tsx; do
  if [[ -f "$optional" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$optional")"
    cp -a "$optional" "$BACKUP_DIR/$optional"
    touch "$BACKUP_DIR/$(basename "$optional").existed"
  fi
done
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

restart_api() {
  (
    cd /var/lib/socialbird
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs" >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save >/dev/null 2>&1 || true
  )
}

rollback() {
  echo "Android native integration failed; restoring previous live version..." >&2
  for file in \
    src/App.tsx \
    src/components/AppSidebar.tsx \
    src/components/VoiceCallControls.tsx \
    src/components/RealtimeNotifications.tsx \
    src/lib/i18n.ts \
    src/lib/screen-share.ts \
    src/lib/call-media-bus.ts \
    backend/server.js \
    backend/server.production.js \
    deploy/install.sh; do
    [[ -f "$BACKUP_DIR/$file" ]] && cp -a "$BACKUP_DIR/$file" "$file"
  done

  if [[ -f "$BACKUP_DIR/AndroidApp.tsx.existed" ]]; then
    cp -a "$BACKUP_DIR/src/pages/AndroidApp.tsx" src/pages/AndroidApp.tsx
  else
    rm -f src/pages/AndroidApp.tsx
  fi
  if [[ -f "$BACKUP_DIR/NativeAppBridge.tsx.existed" ]]; then
    cp -a "$BACKUP_DIR/src/components/NativeAppBridge.tsx" src/components/NativeAppBridge.tsx
  else
    rm -f src/components/NativeAppBridge.tsx
  fi

  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -a "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" src dist backend 2>/dev/null || true
  restart_api
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/8] Fetching production Android integration"
sudo -u "$APP_USER" git fetch origin "+$BRANCH:refs/remotes/origin/$BRANCH"

echo "[2/8] Loading shared website/native bridge files"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  src/App.tsx \
  src/components/AppSidebar.tsx \
  src/components/NativeAppBridge.tsx \
  src/lib/i18n.ts \
  src/lib/screen-share.ts \
  src/pages/AndroidApp.tsx \
  deploy/apply-screen-share-audio-fixes.mjs \
  deploy/apply-single-camera-tile-fix.mjs \
  deploy/apply-native-android-integration.mjs \
  deploy/harden-source.mjs

echo "[3/8] Applying call, screen-share and native notification integration"
node --check deploy/apply-screen-share-audio-fixes.mjs
node --check deploy/apply-single-camera-tile-fix.mjs
node --check deploy/apply-native-android-integration.mjs
sudo -u "$APP_USER" node deploy/apply-screen-share-audio-fixes.mjs
sudo -u "$APP_USER" node deploy/apply-single-camera-tile-fix.mjs
sudo -u "$APP_USER" node deploy/apply-native-android-integration.mjs

grep -q 'AUTH_NATIVE' backend/server.js
grep -q '<NativeAppBridge />' src/App.tsx
grep -q 'SINGLE_CAMERA_TILE_FIX' src/components/VoiceCallControls.tsx
grep -q 'ITBirdAndroid' src/lib/screen-share.ts

echo "[4/8] Rebuilding hardened API"
sudo -u "$APP_USER" node deploy/harden-source.mjs
node --check backend/server.production.js
grep -q 'AUTH_NATIVE' backend/server.production.js
grep -q 'registerOfflineCallQueue' backend/server.production.js

echo "[5/8] Building production frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[6/8] Restarting SocialBIRD API"
restart_api
for attempt in {1..25}; do
  if ss -lnt | grep -q '127.0.0.1:5000'; then
    break
  fi
  if [[ "$attempt" -eq 25 ]]; then
    echo "API did not return on port 5000." >&2
    tail -n 160 /var/log/socialbird/api-error.log 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

echo "[7/8] Verifying website and native bridge support"
grep -q 'path="/android-app"' src/App.tsx
grep -q 'url: "/android-app"' src/components/AppSidebar.tsx
grep -q 'syncAuthToken' src/components/NativeAppBridge.tsx
grep -q 'MediaProjection' src/pages/AndroidApp.tsx
curl -fsS http://127.0.0.1:5000/password-reset/mail-status >/dev/null

echo "[8/8] Final status"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status

trap - ERR
chown -R "$APP_USER:$APP_USER" src dist backend 2>/dev/null || true

echo
echo "Android native integration completed."
echo "Backup: $BACKUP_DIR"
echo "Website: /android-app"
echo "Native background channel: AUTH_NATIVE + durable WebRTC replay"
echo "APK: https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android.apk"

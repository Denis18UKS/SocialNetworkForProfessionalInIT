#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BACKUP_DIR="/var/backups/socialbird/native-android-complete-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

backup_file() {
  local source="$1"
  local name="$2"
  if [[ -e "$source" ]]; then cp -a "$source" "$BACKUP_DIR/$name"; fi
  return 0
}

backup_file backend/server.js server.js
backup_file backend/server.production.js server.production.js
backup_file src/App.tsx App.tsx
backup_file src/components/AppSidebar.tsx AppSidebar.tsx
backup_file src/components/PushCallRegistration.tsx PushCallRegistration.tsx
backup_file src/components/RealtimeNotifications.tsx RealtimeNotifications.tsx
backup_file src/components/VoiceCallControls.tsx VoiceCallControls.tsx
backup_file src/components/NativeAppBridge.tsx NativeAppBridge.tsx
backup_file src/pages/AndroidApp.tsx AndroidApp.tsx
backup_file src/lib/i18n.ts i18n.ts
backup_file src/lib/screen-share.ts screen-share.ts
backup_file deploy/install.sh install.sh
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

rollback() {
  echo "Native Android integration failed; restoring previous live version..." >&2
  [[ -f "$BACKUP_DIR/server.js" ]] && cp -a "$BACKUP_DIR/server.js" backend/server.js
  [[ -f "$BACKUP_DIR/server.production.js" ]] && cp -a "$BACKUP_DIR/server.production.js" backend/server.production.js
  [[ -f "$BACKUP_DIR/App.tsx" ]] && cp -a "$BACKUP_DIR/App.tsx" src/App.tsx
  [[ -f "$BACKUP_DIR/AppSidebar.tsx" ]] && cp -a "$BACKUP_DIR/AppSidebar.tsx" src/components/AppSidebar.tsx
  [[ -f "$BACKUP_DIR/PushCallRegistration.tsx" ]] && cp -a "$BACKUP_DIR/PushCallRegistration.tsx" src/components/PushCallRegistration.tsx
  [[ -f "$BACKUP_DIR/RealtimeNotifications.tsx" ]] && cp -a "$BACKUP_DIR/RealtimeNotifications.tsx" src/components/RealtimeNotifications.tsx
  [[ -f "$BACKUP_DIR/VoiceCallControls.tsx" ]] && cp -a "$BACKUP_DIR/VoiceCallControls.tsx" src/components/VoiceCallControls.tsx
  if [[ -f "$BACKUP_DIR/NativeAppBridge.tsx" ]]; then cp -a "$BACKUP_DIR/NativeAppBridge.tsx" src/components/NativeAppBridge.tsx; else rm -f src/components/NativeAppBridge.tsx; fi
  [[ -f "$BACKUP_DIR/AndroidApp.tsx" ]] && cp -a "$BACKUP_DIR/AndroidApp.tsx" src/pages/AndroidApp.tsx
  [[ -f "$BACKUP_DIR/i18n.ts" ]] && cp -a "$BACKUP_DIR/i18n.ts" src/lib/i18n.ts
  [[ -f "$BACKUP_DIR/screen-share.ts" ]] && cp -a "$BACKUP_DIR/screen-share.ts" src/lib/screen-share.ts
  [[ -f "$BACKUP_DIR/install.sh" ]] && cp -a "$BACKUP_DIR/install.sh" deploy/install.sh
  if [[ -d "$BACKUP_DIR/dist" ]]; then rm -rf dist; cp -a "$BACKUP_DIR/dist" dist; fi
  chown -R "$APP_USER:$APP_USER" src backend/server.js backend/server.production.js dist 2>/dev/null || true
  (
    cd /var/lib/socialbird
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs" >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save >/dev/null 2>&1 || true
  )
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/8] Fetching production Android integration"
sudo -u "$APP_USER" git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"

echo "[2/8] Loading shared UI and native integration files"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  src/App.tsx \
  src/components/AppSidebar.tsx \
  src/components/NativeAppBridge.tsx \
  src/pages/AndroidApp.tsx \
  src/lib/i18n.ts \
  src/lib/screen-share.ts \
  deploy/apply-native-android-integration.mjs \
  deploy/harden-source.mjs \
  deploy/enable-sandbox-compiler.mjs \
  deploy/install.sh

echo "[3/8] Applying one shared call/session architecture"
node --check deploy/apply-native-android-integration.mjs
sudo -u "$APP_USER" node deploy/apply-native-android-integration.mjs

grep -q 'AUTH_NATIVE' backend/server.js
grep -q 'durable-call-replay-owner' backend/server.js
grep -q 'clientRole: "call-host"' src/components/RealtimeNotifications.tsx
grep -q 'clientRole: "call-control"' src/components/VoiceCallControls.tsx
grep -q 'native-notifications-own-background' src/components/PushCallRegistration.tsx
grep -q 'NativeAppBridge' src/App.tsx
grep -q 'itbird-native-answer-call' src/components/RealtimeNotifications.tsx
grep -q 'ITBirdAndroid' src/lib/screen-share.ts

echo "[4/8] Rebuilding hardened API"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
grep -q 'AUTH_NATIVE' backend/server.production.js
grep -q 'durable-call-replay-owner' backend/server.production.js

echo "[5/8] Building shared production frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[6/8] Restarting SocialBIRD API"
(
  cd /var/lib/socialbird
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
)

for attempt in {1..25}; do
  if ss -lnt | grep -q '127.0.0.1:5000'; then break; fi
  if [[ "$attempt" -eq 25 ]]; then
    echo "API did not return on port 5000." >&2
    tail -n 160 /var/log/socialbird/api-error.log 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

echo "[7/8] Verifying live API and Android page"
curl -fsS http://127.0.0.1:5000/push/public-key | grep -q 'publicKey'
grep -q 'path="/android-app"' src/App.tsx
grep -q 'url: "/android-app"' src/components/AppSidebar.tsx
grep -q 'SocialBIRD-Android.apk' src/pages/AndroidApp.tsx

echo "[8/8] Final status"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
ss -lntp | grep ':5000'

trap - ERR
chown -R "$APP_USER:$APP_USER" src backend/server.js backend/server.production.js dist 2>/dev/null || true

echo
echo "Native Android integration completed."
echo "Backup: $BACKUP_DIR"
echo "Shared UI/backend/WebRTC: enabled"
echo "Native background calls/messages: enabled"
echo "Native Android answer/decline bridge: enabled"
echo "Native screen share bridge: enabled"
echo "APK page: /android-app"
echo "APK: https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android.apk"

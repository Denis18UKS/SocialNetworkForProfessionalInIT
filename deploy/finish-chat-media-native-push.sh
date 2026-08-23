#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/final-chat-push-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

BACKUP_FILES=(
  backend/server.js
  backend/server.production.js
  backend/native-fcm-push.js
  src/pages/Chats.tsx
  src/pages/GroupChats.tsx
  src/App.tsx
  src/components/PushCallRegistration.tsx
  src/components/VoiceCallControls.tsx
  src/components/RealtimeNotifications.tsx
  deploy/install.sh
)

for file in "${BACKUP_FILES[@]}"; do
  if [[ -e "$file" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$file")"
    cp -a "$file" "$BACKUP_DIR/$file"
  fi
done
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

rollback() {
  echo "Final chat/push deployment failed; restoring source backup..." >&2
  for file in "${BACKUP_FILES[@]}"; do
    if [[ -e "$BACKUP_DIR/$file" ]]; then
      mkdir -p "$(dirname "$file")"
      cp -a "$BACKUP_DIR/$file" "$file"
    fi
  done
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -a "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" backend src dist 2>/dev/null || true
  echo "Rollback source restored from: $BACKUP_DIR" >&2
}
trap rollback ERR

require_marker() {
  local file="$1"
  local marker="$2"
  local label="$3"
  if ! grep -Fq -- "$marker" "$file"; then
    echo "Verification failed: $label" >&2
    echo "File: $file" >&2
    echo "Expected marker: $marker" >&2
    return 1
  fi
  echo "  OK: $label"
}

echo "[1/9] Fetching current production repair files"
sudo -u "$APP_USER" git fetch origin +"$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  backend/native-fcm-push.js \
  deploy/apply-chat-media-mobile-fix.mjs \
  deploy/apply-chat-media-mobile-fix-v3.mjs \
  deploy/apply-chat-media-backend-fix.mjs \
  deploy/apply-native-android-integration.mjs \
  deploy/apply-native-fcm-push.mjs \
  deploy/harden-source.mjs \
  deploy/enable-sandbox-compiler.mjs \
  deploy/configure-fcm-server.sh
chmod 700 deploy/configure-fcm-server.sh

echo "[2/9] Applying chat media fixes"
node --check deploy/apply-chat-media-mobile-fix.mjs
node --check deploy/apply-chat-media-mobile-fix-v3.mjs
node --check deploy/apply-chat-media-backend-fix.mjs
sudo -u "$APP_USER" node deploy/apply-chat-media-mobile-fix.mjs
sudo -u "$APP_USER" node deploy/apply-chat-media-backend-fix.mjs
require_marker src/pages/Chats.tsx 'MAX_TRANSPORT_FILENAME_CHARS = 48' 'private chat long filename transport'
require_marker src/pages/GroupChats.tsx 'MAX_TRANSPORT_FILENAME_CHARS = 48' 'group chat long filename transport'
require_marker src/pages/Chats.tsx 'playsInline' 'private chat inline bounded video'
require_marker src/pages/GroupChats.tsx 'playsInline' 'group chat inline bounded video'
require_marker backend/server.js 'const uploadChatMedia = (req, res, next) => {' 'guarded chat upload middleware declaration'
require_marker backend/server.js "group-chats/:chatId/upload', verifyToken, uploadChatMedia" 'guarded group upload route'

echo "[3/9] Applying shared Android/web call and native FCM wiring"
node --check deploy/apply-native-android-integration.mjs
node --check deploy/apply-native-fcm-push.mjs
node --check backend/native-fcm-push.js
sudo -u "$APP_USER" node deploy/apply-native-android-integration.mjs
sudo -u "$APP_USER" node deploy/apply-native-fcm-push.mjs
require_marker backend/server.js 'NATIVE_FCM_PUSH: dispatch-targeted-notification' 'native FCM dispatcher'
require_marker backend/server.js 'NATIVE_FCM_PUSH: register-routes' 'native FCM routes registration'

echo "[4/9] Rebuilding hardened production API"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
require_marker backend/server.production.js 'const uploadChatMedia = (req, res, next) => {' 'production guarded chat upload middleware'
require_marker backend/server.production.js 'NATIVE_FCM_PUSH: dispatch-targeted-notification' 'production FCM dispatcher'
require_marker backend/server.production.js 'NATIVE_FCM_PUSH: register-routes' 'production FCM routes'
require_marker backend/server.production.js 'PRODUCTION_HARDENING: sandboxed-compiler-route' 'compiler sandbox remains enabled'

echo "[5/9] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[6/9] Restarting only SocialBIRD API"
cd "$APP_HOME"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"

HEALTH_FILE="$(mktemp)"
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:5000/native-push/status -o "$HEALTH_FILE" 2>/dev/null; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "SocialBIRD API failed health verification." >&2
    tail -n 120 /var/log/socialbird/api-error.log 2>/dev/null || true
    rm -f "$HEALTH_FILE"
    false
  fi
  sleep 1
done

echo "[7/9] Verifying API health and FCM transport"
require_marker "$HEALTH_FILE" 'fcm-http-v1' 'native push status endpoint'
cat "$HEALTH_FILE"
rm -f "$HEALTH_FILE"

PUBLIC_KEY_FILE="$(mktemp)"
curl -fsS https://api.socialbird.ru/push/public-key -o "$PUBLIC_KEY_FILE"
require_marker "$PUBLIC_KEY_FILE" 'publicKey' 'public API through api.socialbird.ru'
rm -f "$PUBLIC_KEY_FILE"

echo "[8/9] Saving stable PM2 state"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
sleep 2
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
curl -fsS http://127.0.0.1:5000/native-push/status >/dev/null

echo "[9/9] Completed"
trap - ERR
chown -R "$APP_USER:$APP_USER" "$APP_DIR/backend" "$APP_DIR/src" "$APP_DIR/dist" 2>/dev/null || true

echo
 echo "Chat media + native push backend deployment completed successfully."
echo "Backup: $BACKUP_DIR"
echo "Website/API are healthy."
echo "If native-push status says configured=false, only Firebase credentials + APK rebuild remain."

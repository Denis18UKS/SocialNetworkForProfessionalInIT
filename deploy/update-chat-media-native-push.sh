#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/media-native-push-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

backup_file() {
  local file="$1"
  if [[ -e "$file" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$file")"
    cp -a "$file" "$BACKUP_DIR/$file"
  fi
  return 0
}

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

for file in src/pages/Chats.tsx src/pages/GroupChats.tsx backend/server.js backend/server.production.js backend/native-fcm-push.js; do
  backup_file "$file"
done
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

rollback() {
  echo "Media/native push update failed; restoring previous live version..." >&2
  for file in src/pages/Chats.tsx src/pages/GroupChats.tsx backend/server.js backend/server.production.js backend/native-fcm-push.js; do
    if [[ -e "$BACKUP_DIR/$file" ]]; then
      mkdir -p "$(dirname "$file")"
      cp -a "$BACKUP_DIR/$file" "$file"
    elif [[ "$file" == "backend/native-fcm-push.js" ]]; then
      rm -f "$file"
    fi
  done
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -a "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" src backend dist 2>/dev/null || true
  (
    cd "$APP_HOME"
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs" >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save >/dev/null 2>&1 || true
  )
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/8] Fetching media and native push fixes"
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

echo "[2/8] Fixing long filenames, video layout and media upload backend"
node --check deploy/apply-chat-media-mobile-fix.mjs
node --check deploy/apply-chat-media-mobile-fix-v3.mjs
node --check deploy/apply-chat-media-backend-fix.mjs
sudo -u "$APP_USER" node deploy/apply-chat-media-mobile-fix.mjs
sudo -u "$APP_USER" node deploy/apply-chat-media-backend-fix.mjs
require_marker src/pages/Chats.tsx 'MAX_TRANSPORT_FILENAME_CHARS = 48' 'private chat long filename transport'
require_marker src/pages/GroupChats.tsx 'MAX_TRANSPORT_FILENAME_CHARS = 48' 'group chat long filename transport'
require_marker src/pages/Chats.tsx 'playsInline' 'private chat bounded inline video'
require_marker src/pages/GroupChats.tsx 'playsInline' 'group chat bounded inline video'
require_marker backend/server.js 'CHAT_MEDIA_BACKEND_FIX' 'group media backend mention fix'
require_marker backend/server.js 'const uploadChatMedia = (req, res, next) => {' 'guarded chat upload middleware declaration'
require_marker backend/server.js "group-chats/:chatId/upload', verifyToken, uploadChatMedia" 'group upload guarded middleware route'

echo "[3/8] Wiring the shared Android/web call architecture and FCM transport"
node --check backend/native-fcm-push.js
node --check deploy/apply-native-android-integration.mjs
node --check deploy/apply-native-fcm-push.mjs
sudo -u "$APP_USER" node deploy/apply-native-android-integration.mjs
sudo -u "$APP_USER" node deploy/apply-native-fcm-push.mjs
require_marker backend/server.js 'NATIVE_FCM_PUSH: dispatch-targeted-notification' 'native FCM notification dispatcher'
require_marker backend/native-fcm-push.js '/native-push/register' 'native FCM device registration route'

echo "[4/8] Rebuilding hardened SocialBIRD API"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
require_marker backend/server.production.js 'NATIVE_FCM_PUSH: dispatch-targeted-notification' 'production FCM dispatcher'
require_marker backend/server.production.js 'CHAT_MEDIA_BACKEND_FIX' 'production media backend fix'
require_marker backend/server.production.js 'const uploadChatMedia = (req, res, next) => {' 'production guarded chat upload middleware declaration'

echo "[5/8] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[6/8] Restarting only SocialBIRD API"
(
  cd "$APP_HOME"
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
)

for attempt in {1..25}; do
  if curl -fsS http://127.0.0.1:5000/native-push/status >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 25 ]]; then
    echo "API did not return a healthy native-push status endpoint." >&2
    tail -n 160 /var/log/socialbird/api-error.log 2>/dev/null || true
    false
  fi
  sleep 1
done

echo "[7/8] Verifying native push endpoint"
STATUS_FILE="$(mktemp)"
trap 'rm -f "$STATUS_FILE"; rollback' ERR
curl -fsS http://127.0.0.1:5000/native-push/status -o "$STATUS_FILE"
require_marker "$STATUS_FILE" 'fcm-http-v1' 'native push HTTP v1 status endpoint'
cat "$STATUS_FILE"
rm -f "$STATUS_FILE"

echo
echo "[8/8] Final status"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status

trap - ERR
chown -R "$APP_USER:$APP_USER" src backend dist 2>/dev/null || true

echo
echo "Chat media + native Android push backend update completed."
echo "Backup: $BACKUP_DIR"
echo "Long filenames are shortened only for multipart transport; mobile UI remains bounded to the viewport."
echo "Group media upload no longer references an undefined mention list."
echo "Native FCM routes are installed. Use deploy/configure-fcm-server.sh only after the Firebase service-account JSON actually exists on this VPS."

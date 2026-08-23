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
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- backend/native-fcm-push.js deploy/apply-chat-media-mobile-fix.mjs deploy/apply-chat-media-backend-fix.mjs deploy/apply-native-android-integration.mjs deploy/apply-native-fcm-push.mjs deploy/harden-source.mjs deploy/enable-sandbox-compiler.mjs deploy/configure-fcm-server.sh
chmod 700 deploy/configure-fcm-server.sh

echo "[2/8] Fixing long filenames, video layout and media upload backend"
node --check deploy/apply-chat-media-mobile-fix.mjs
node --check deploy/apply-chat-media-backend-fix.mjs
sudo -u "$APP_USER" node deploy/apply-chat-media-mobile-fix.mjs
sudo -u "$APP_USER" node deploy/apply-chat-media-backend-fix.mjs
grep -q 'MAX_TRANSPORT_FILENAME_CHARS = 48' src/pages/Chats.tsx
grep -q 'MAX_TRANSPORT_FILENAME_CHARS = 48' src/pages/GroupChats.tsx
grep -q 'playsInline' src/pages/Chats.tsx
grep -q 'playsInline' src/pages/GroupChats.tsx
grep -q 'CHAT_MEDIA_BACKEND_FIX' backend/server.js
grep -q "group-chats/:chatId/upload', verifyToken, uploadChatMedia" backend/server.js

echo "[3/8] Wiring the shared Android/web call architecture and FCM transport"
node --check backend/native-fcm-push.js
node --check deploy/apply-native-android-integration.mjs
node --check deploy/apply-native-fcm-push.mjs
sudo -u "$APP_USER" node deploy/apply-native-android-integration.mjs
sudo -u "$APP_USER" node deploy/apply-native-fcm-push.mjs
grep -q 'NATIVE_FCM_PUSH: dispatch-targeted-notification' backend/server.js
grep -q '/native-push/register' backend/native-fcm-push.js

echo "[4/8] Rebuilding hardened SocialBIRD API"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
grep -q 'NATIVE_FCM_PUSH: dispatch-targeted-notification' backend/server.production.js
grep -q 'CHAT_MEDIA_BACKEND_FIX' backend/server.production.js

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
  if ss -lnt | grep -q '127.0.0.1:5000'; then break; fi
  if [[ "$attempt" -eq 25 ]]; then
    echo "API did not return on port 5000." >&2
    tail -n 160 /var/log/socialbird/api-error.log 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

echo "[7/8] Verifying native push endpoint"
STATUS_FILE="$(mktemp)"
trap 'rm -f "$STATUS_FILE"; rollback' ERR
curl -fsS http://127.0.0.1:5000/native-push/status -o "$STATUS_FILE"
grep -q 'fcm-http-v1' "$STATUS_FILE"
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
echo "Native FCM routes are installed. Use deploy/configure-fcm-server.sh after creating the Firebase service account."

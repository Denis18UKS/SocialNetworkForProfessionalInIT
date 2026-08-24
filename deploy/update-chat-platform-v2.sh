#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/chat-platform-v2-$(date +%Y%m%d-%H%M%S)"
DEPLOY_RESTARTED=0

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

BACKUP_FILES=(
  backend/server.js
  backend/server.production.js
  src/pages/Chats.tsx
  src/pages/GroupChats.tsx
  src/App.tsx
)

for file in "${BACKUP_FILES[@]}"; do
  if [[ -e "$file" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$file")"
    cp -a "$file" "$BACKUP_DIR/$file"
  fi
done
if [[ -d dist ]]; then
  cp -a dist "$BACKUP_DIR/dist"
fi

rollback() {
  echo "Chat platform deployment failed; restoring previous SocialBIRD source/build..." >&2
  cd "$APP_DIR"
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
  if [[ "$DEPLOY_RESTARTED" -eq 1 ]]; then
    cd "$APP_HOME"
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs" >/dev/null 2>&1 || true
  fi
  echo "Rollback restored from: $BACKUP_DIR" >&2
}
trap rollback ERR

require_text() {
  local file="$1"
  local text="$2"
  local label="$3"
  grep -Fq -- "$text" "$file" || { echo "Verification failed: $label" >&2; return 1; }
  echo "  OK: $label"
}

echo "[1/10] Fetching Chat Platform v2 files"
sudo -u "$APP_USER" git fetch origin +"$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  backend/resumable-chat-upload.js \
  backend/stickers.js \
  backend/registration-verification.js \
  backend/admin-desktop.js \
  backend/android-version.js \
  src/lib/resumable-chat-upload.ts \
  src/lib/chat-drafts.ts \
  src/lib/stickers.ts \
  src/components/StickerPicker.tsx \
  src/components/StickerBubble.tsx \
  src/components/MediaViewerHost.tsx \
  src/styles/chat-platform-v1.css \
  public/stickers/socialbird \
  deploy/apply-chat-platform-v1.mjs \
  deploy/apply-chat-draft-persistence-v1.mjs \
  deploy/fix-chat-platform-patcher-v2.mjs \
  deploy/apply-chat-media-backend-fix.mjs \
  deploy/apply-native-android-integration.mjs \
  deploy/apply-native-fcm-push.mjs \
  deploy/apply-security-admin-update.mjs \
  deploy/harden-source.mjs \
  deploy/enable-sandbox-compiler.mjs

echo "[2/10] Checking backend modules and patchers"
node deploy/fix-chat-platform-patcher-v2.mjs
node --check backend/resumable-chat-upload.js
node --check backend/stickers.js
node --check deploy/apply-chat-platform-v1.mjs
node --check deploy/apply-chat-draft-persistence-v1.mjs
node --check deploy/apply-chat-media-backend-fix.mjs
node --check deploy/apply-native-android-integration.mjs
node --check deploy/apply-native-fcm-push.mjs
node --check deploy/apply-security-admin-update.mjs

require_text deploy/apply-chat-platform-v1.mjs "SOCIALBIRD_CHAT_PLATFORM_V2_COMPAT" "live workspace compatibility"
require_text backend/resumable-chat-upload.js "preservesOriginalBytes" "original media bytes preserved"
require_text backend/resumable-chat-upload.js "app.put('/chat-upload/:uploadId/chunks/:index'" "resumable chunk route"
require_text backend/stickers.js "app.post('/stickers/send'" "native sticker message route"
require_text src/components/MediaViewerHost.tsx "requestFullscreen" "fullscreen media viewer"
require_text src/components/MediaViewerHost.tsx "pinchStart" "touch pinch zoom"
require_text src/components/StickerPicker.tsx "Недавние" "sticker recents UI"

echo "[3/10] Applying current production wiring"
sudo -u "$APP_USER" node deploy/apply-chat-media-backend-fix.mjs
sudo -u "$APP_USER" node deploy/apply-native-android-integration.mjs
sudo -u "$APP_USER" node deploy/apply-native-fcm-push.mjs
sudo -u "$APP_USER" node deploy/apply-security-admin-update.mjs
sudo -u "$APP_USER" node deploy/apply-chat-platform-v1.mjs
sudo -u "$APP_USER" node deploy/apply-chat-draft-persistence-v1.mjs

require_text backend/server.js "SOCIALBIRD_CHAT_PLATFORM_V1: resumable-upload-stickers" "Chat Platform backend wired"
require_text backend/server.js "NATIVE_FCM_PUSH: register-routes" "FCM wiring preserved"
require_text backend/server.js "registerEmailVerifiedRegistration({" "verified registration preserved"
require_text src/pages/Chats.tsx "SOCIALBIRD_CHAT_PLATFORM_V1: drag-drop-resumable-upload" "personal chat resumable upload"
require_text src/pages/GroupChats.tsx "SOCIALBIRD_CHAT_PLATFORM_V1: drag-drop-resumable-upload" "group chat resumable upload"
require_text src/pages/Chats.tsx "personal-draft-persist" "personal draft isolation"
require_text src/pages/GroupChats.tsx "group-draft-persist" "group draft isolation"
require_text src/pages/Chats.tsx "StickerPicker" "personal stickers"
require_text src/pages/GroupChats.tsx "StickerPicker" "group stickers"
require_text src/App.tsx "MediaViewerHost" "global fullscreen viewer"

echo "[4/10] Rebuilding hardened production backend"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
require_text backend/server.production.js "SOCIALBIRD_CHAT_PLATFORM_V1: resumable-upload-stickers" "production resumable upload wiring"
require_text backend/server.production.js "NATIVE_FCM_PUSH: register-routes" "production FCM preserved"
require_text backend/server.production.js "PRODUCTION_HARDENING: sandboxed-compiler-route" "compiler sandbox preserved"
require_text backend/server.production.js "registerEmailVerifiedRegistration({" "production registration verification preserved"

echo "[5/10] Building frontend before touching live API"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[6/10] Checking Nginx upload transport"
nginx -t
NGINX_BODY_LINE="$(nginx -T 2>/dev/null | grep -E '^[[:space:]]*client_max_body_size[[:space:]]+' | tail -n 1 || true)"
echo "Nginx body setting: ${NGINX_BODY_LINE:-not explicitly reported}"
echo "Large SocialBIRD files use 8 MiB resumable chunks, so a 125 MiB video no longer depends on one 125 MiB request."
echo "No video transcoding or quality reduction is performed."

echo "[7/10] Restarting only SocialBIRD API"
DEPLOY_RESTARTED=1
cd "$APP_HOME"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"

for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:5000/native-push/status >/tmp/socialbird-native-status.json 2>/dev/null; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "SocialBIRD API did not become healthy." >&2
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 logs socialbird-api --lines 120 --nostream >&2 || true
    false
  fi
  sleep 1
done

echo "[8/10] Verifying new authenticated routes and existing services"
CHAT_UPLOAD_HTTP="$(curl -sS -o /tmp/socialbird-chat-upload-check.json -w '%{http_code}' http://127.0.0.1:5000/chat-upload/config || true)"
STICKERS_HTTP="$(curl -sS -o /tmp/socialbird-stickers-check.json -w '%{http_code}' http://127.0.0.1:5000/stickers/packs || true)"
if [[ "$CHAT_UPLOAD_HTTP" != "401" ]]; then
  echo "Unexpected /chat-upload/config status: $CHAT_UPLOAD_HTTP" >&2
  cat /tmp/socialbird-chat-upload-check.json >&2 || true
  false
fi
if [[ "$STICKERS_HTTP" != "401" ]]; then
  echo "Unexpected /stickers/packs status: $STICKERS_HTTP" >&2
  cat /tmp/socialbird-stickers-check.json >&2 || true
  false
fi

curl -fsS http://127.0.0.1:5000/register/status -o /tmp/socialbird-register-status.json
curl -fsS http://127.0.0.1:5000/admin/desktop/status -o /tmp/socialbird-admin-status.json
curl -fsS https://api.socialbird.ru/push/public-key -o /tmp/socialbird-public-key.json
require_text /tmp/socialbird-native-status.json '"configured":true' "FCM remains configured"
require_text /tmp/socialbird-register-status.json '"emailVerification":true' "verified registration remains enabled"
require_text /tmp/socialbird-admin-status.json '"enabled":true' "Admin Desktop API remains enabled"
require_text /tmp/socialbird-public-key.json '"publicKey"' "public API reachable"
echo "  OK: resumable upload route requires authentication"
echo "  OK: sticker route requires authentication"

if grep -Fq '"smtpConfigured":false' /tmp/socialbird-register-status.json; then
  echo "WARNING: SMTP is not configured; registration/admin email codes cannot be delivered until SMTP is configured." >&2
fi

echo "[9/10] Checking disk and upload directories"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR/backend/uploads/chat_chunks"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR/backend/uploads/chat_files"
df -h "$APP_DIR/backend/uploads"

echo "[10/10] Saving stable PM2 state"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
sleep 2
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
curl -fsS http://127.0.0.1:5000/native-push/status >/dev/null
curl -fsS http://127.0.0.1:5000/register/status >/dev/null
curl -fsS http://127.0.0.1:5000/admin/desktop/status >/dev/null

rm -f /tmp/socialbird-native-status.json /tmp/socialbird-register-status.json /tmp/socialbird-admin-status.json /tmp/socialbird-public-key.json /tmp/socialbird-chat-upload-check.json /tmp/socialbird-stickers-check.json
trap - ERR
chown -R "$APP_USER:$APP_USER" "$APP_DIR/backend" "$APP_DIR/src" "$APP_DIR/dist" "$APP_DIR/public/stickers" 2>/dev/null || true

echo
echo "Chat Platform v2 deployed successfully."
echo "Included: responsive chat fixes, per-chat drafts, fullscreen photos, drag/drop, multi-file queue, resumable large uploads without recompression, and native sticker messages."
echo "Backup: $BACKUP_DIR"
echo "Next phase: global call session + fullscreen screen sharing, then strict profile blocking/friends/folders/email/group-owner clear."

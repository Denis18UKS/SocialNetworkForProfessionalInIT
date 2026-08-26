#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BRANCH="deploy/socialbird-vps-production"
BACKUP_ROOT="/var/backups/socialbird"
BACKUP_DIR="$BACKUP_ROOT/v8-chat-$(date +%Y%m%d-%H%M%S)"
RESTARTED=0

[[ ${EUID} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"

FILES=(
  backend/server.js
  backend/server.production.js
  backend/stickers.js
  backend/offline-call-queue.js
  backend/strict-privacy-gate.js
  backend/stable-news-time.js
  backend/socialbird-final-platform.js
  backend/cinema-qr.js
  backend/cinema-stream.js
  backend/admin-cinema-library.js
  src/components/call/CallProvider.tsx
  src/components/call/NativeCallAudioBridge.tsx
  src/components/call/PushCallDeepLinkBridge.tsx
  src/components/GlobalCallOverlay.tsx
  src/pages/Chats.tsx
  src/pages/GroupChats.tsx
  src/components/ChatExpressionPicker.tsx
  src/components/StickerBubble.tsx
  src/lib/stickers.ts
)

for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp -a "$f" "$BACKUP_DIR/$f"
    printf '%s\n' "$f" >> "$BACKUP_DIR/present-files.txt"
  fi
done
if [[ -d public/stickers ]]; then
  mkdir -p "$BACKUP_DIR/public"
  cp -a public/stickers "$BACKUP_DIR/public/stickers"
  touch "$BACKUP_DIR/stickers-dir-present"
fi
if [[ -d dist ]]; then
  cp -al dist "$BACKUP_DIR/dist"
fi

rollback() {
  echo "V8/chat deploy failed; restoring previous production state..." >&2
  cd "$APP_DIR"
  for f in "${FILES[@]}"; do
    rm -f "$f"
    if [[ -f "$BACKUP_DIR/$f" ]]; then
      mkdir -p "$(dirname "$f")"
      cp -a "$BACKUP_DIR/$f" "$f"
    fi
  done
  rm -rf public/stickers
  if [[ -f "$BACKUP_DIR/stickers-dir-present" && -d "$BACKUP_DIR/public/stickers" ]]; then
    mkdir -p public
    cp -a "$BACKUP_DIR/public/stickers" public/stickers
  fi
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -al "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" backend src public dist 2>/dev/null || true
  if [[ "$RESTARTED" -eq 1 ]]; then
    cd "$APP_HOME"
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 restart socialbird-api >/dev/null 2>&1 || true
  fi
  echo "Rollback source: $BACKUP_DIR" >&2
}
trap rollback ERR

require_text() {
  grep -Fq -- "$2" "$1" || { echo "Verification failed: $3" >&2; return 1; }
  echo "  OK: $3"
}

echo "[1/8] Fetching verified V8/chat source"
sudo -u "$APP_USER" git fetch origin +"$BRANCH:refs/remotes/origin/$BRANCH"
echo "Remote HEAD: $(sudo -u "$APP_USER" git rev-parse "refs/remotes/origin/$BRANCH")"

# Checkout generated application source directly. Do not re-run superseded V5/V6/V7
# migration patchers over an already generated V8 CallProvider.
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  backend/server.js backend/stickers.js backend/offline-call-queue.js \
  backend/strict-privacy-gate.js backend/stable-news-time.js \
  backend/socialbird-final-platform.js backend/cinema-qr.js backend/cinema-stream.js \
  backend/admin-cinema-library.js \
  src/components/call/CallProvider.tsx \
  src/components/call/NativeCallAudioBridge.tsx \
  src/components/call/PushCallDeepLinkBridge.tsx \
  src/components/GlobalCallOverlay.tsx \
  src/pages/Chats.tsx src/pages/GroupChats.tsx \
  src/components/ChatExpressionPicker.tsx src/components/StickerBubble.tsx \
  src/lib/stickers.ts public/stickers \
  deploy/apply-final-backend-wiring-v1.mjs \
  deploy/harden-source.mjs deploy/enable-sandbox-compiler.mjs

# Canonical server.js does not permanently contain the historical final-platform routes;
# restore only the backend wiring before hardening. This keeps C-Party/Admin Cinema intact
# without running old V5/V6/V7 call mutators over Call V8.
node --check deploy/apply-final-backend-wiring-v1.mjs
sudo -u "$APP_USER" node deploy/apply-final-backend-wiring-v1.mjs

echo "[2/8] Verifying Call V8, chat picker and preserved platform wiring"
node --check backend/server.js
node --check backend/stickers.js
node --check backend/offline-call-queue.js
require_text src/components/call/CallProvider.tsx "SOCIALBIRD_CALL_SYSTEM_V8: dedicated-camera-transport" "dedicated camera transport"
require_text src/components/call/CallProvider.tsx "CALL_VIDEO_OFFER" "camera video offer signaling"
require_text src/components/call/CallProvider.tsx "CALL_VIDEO_ANSWER" "camera video answer signaling"
require_text src/components/call/CallProvider.tsx "CALL_VIDEO_ICE" "camera ICE signaling"
require_text src/components/call/CallProvider.tsx "CALL_VIDEO_STOP" "camera stop signaling"
require_text src/components/call/CallProvider.tsx "setParticipantVolume" "per-participant volume preserved"
require_text src/components/call/CallProvider.tsx "SOCIALBIRD_CALL_SYSTEM_V5: defer-answer-until-ready" "reliable push-answer preserved"
require_text src/components/ChatExpressionPicker.tsx "createPortal" "emoji/sticker portal"
require_text src/components/ChatExpressionPicker.tsx "data-chat-expression-picker=\"true\"" "portal picker marker"
require_text src/pages/Chats.tsx "SOCIALBIRD_CHAT_EXPRESSION_V1: portal-trigger" "personal chat picker wired"
require_text src/pages/GroupChats.tsx "SOCIALBIRD_CHAT_EXPRESSION_V1: portal-trigger" "group chat picker wired"
require_text backend/server.js "SOCIALBIRD_CHAT_EXPRESSION_V1: sticker-routes" "sticker routes wired"
require_text backend/server.js "SOCIALBIRD_FINAL_PLATFORM_V1: final-routes" "final platform routes preserved"
require_text backend/server.js "SOCIALBIRD_ADMIN_CINEMA_V1: routes" "Admin Cinema preserved"
require_text backend/server.js "NATIVE_FCM_PUSH" "native push preserved"

echo "[3/8] Rebuilding hardened backend"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
require_text backend/server.production.js "SOCIALBIRD_CHAT_EXPRESSION_V1: sticker-routes" "sticker routes in production backend"
require_text backend/server.production.js "SOCIALBIRD_FINAL_PLATFORM_V1: final-routes" "final routes in production backend"
require_text backend/server.production.js "SOCIALBIRD_ADMIN_CINEMA_V1: routes" "Admin Cinema in production backend"
require_text backend/server.production.js "NATIVE_FCM_PUSH" "FCM in production backend"
require_text backend/server.production.js "PRODUCTION_HARDENING: sandboxed-compiler-route" "compiler sandbox preserved"

echo "[4/8] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[5/8] Pre-restart checks"
nginx -t
df -h "$APP_DIR"

echo "[6/8] Restarting SocialBIRD API"
RESTARTED=1
cd "$APP_HOME"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 restart socialbird-api
for n in {1..30}; do
  if curl -fsS http://127.0.0.1:5000/native-push/status >/tmp/socialbird-v8-native.json 2>/dev/null; then break; fi
  [[ "$n" -lt 30 ]] || {
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 logs socialbird-api --lines 120 --nostream >&2 || true
    false
  }
  sleep 1
done

cd "$APP_DIR"
echo "[7/8] Smoke testing"
curl -fsS http://127.0.0.1:5000/socialbird-final/status >/tmp/socialbird-v8-final.json
require_text /tmp/socialbird-v8-final.json '"enabled":true' "final platform enabled"
require_text /tmp/socialbird-v8-final.json '"cinemaParty":true' "C-Party remains enabled"
require_text /tmp/socialbird-v8-native.json '"configured":true' "FCM remains configured"
STICKER_CODE="$(curl -sS -o /tmp/socialbird-v8-stickers.json -w '%{http_code}' http://127.0.0.1:5000/stickers/packs || true)"
[[ "$STICKER_CODE" == "401" ]] || { echo "Unexpected /stickers/packs status without auth: $STICKER_CODE" >&2; false; }
echo "  OK: sticker API is mounted and requires authentication"

PUBLIC_CODE="$(curl -sS -o /dev/null -w '%{http_code}' https://socialbird.ru || true)"
[[ "$PUBLIC_CODE" =~ ^(200|301|302)$ ]] || { echo "Unexpected public site status: $PUBLIC_CODE" >&2; false; }
echo "  OK: public site responds ($PUBLIC_CODE)"

echo "[8/8] Saving PM2 state"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
chown -R "$APP_USER:$APP_USER" backend src public dist 2>/dev/null || true
trap - ERR

echo
echo "SocialBIRD V8 camera + chat expression fixes deployed successfully."
echo "Included: independent WebRTC camera transport, remote camera rendering, emoji/sticker body portal, sticker sending/rendering."
echo "Preserved: final platform routes, C-Party, Admin Cinema, FCM and compiler sandbox."
echo "Backup: $BACKUP_DIR"

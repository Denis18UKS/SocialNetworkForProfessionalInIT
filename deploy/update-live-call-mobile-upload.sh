#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BACKEND_ENV="/etc/socialbird/backend.env"
SITE_DOMAIN="socialbird.31.207.74.138.nip.io"
API_DOMAIN="api.31.207.74.138.nip.io"
BACKUP_DIR="/var/backups/socialbird/live-call-mobile-upload-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

backup_file() {
  local source="$1"
  local name="$2"
  if [[ -e "$source" ]]; then
    cp -a "$source" "$BACKUP_DIR/$name"
  fi
}

backup_file "$APP_DIR/src/App.tsx" App.tsx
backup_file "$APP_DIR/src/index.css" index.css
backup_file "$APP_DIR/src/pages/Chats.tsx" Chats.tsx
backup_file "$APP_DIR/src/components/VoiceMessageBubble.tsx" VoiceMessageBubble.tsx
backup_file "$APP_DIR/src/components/VoiceCallControls.tsx" VoiceCallControls.tsx
backup_file "$APP_DIR/src/components/RealtimeNotifications.tsx" RealtimeNotifications.tsx
backup_file "$APP_DIR/backend/server.js" server.js
backup_file "$APP_DIR/backend/server.production.js" server.production.js
backup_file "$BACKEND_ENV" backend.env
backup_file /etc/nginx/sites-available/socialbird nginx-socialbird
if [[ -d "$APP_DIR/dist" ]]; then cp -a "$APP_DIR/dist" "$BACKUP_DIR/dist"; fi

rollback() {
  echo "Update failed; restoring previous live version..." >&2
  [[ -f "$BACKUP_DIR/App.tsx" ]] && cp -a "$BACKUP_DIR/App.tsx" "$APP_DIR/src/App.tsx"
  [[ -f "$BACKUP_DIR/index.css" ]] && cp -a "$BACKUP_DIR/index.css" "$APP_DIR/src/index.css"
  [[ -f "$BACKUP_DIR/Chats.tsx" ]] && cp -a "$BACKUP_DIR/Chats.tsx" "$APP_DIR/src/pages/Chats.tsx"
  [[ -f "$BACKUP_DIR/VoiceMessageBubble.tsx" ]] && cp -a "$BACKUP_DIR/VoiceMessageBubble.tsx" "$APP_DIR/src/components/VoiceMessageBubble.tsx"
  [[ -f "$BACKUP_DIR/VoiceCallControls.tsx" ]] && cp -a "$BACKUP_DIR/VoiceCallControls.tsx" "$APP_DIR/src/components/VoiceCallControls.tsx"
  [[ -f "$BACKUP_DIR/RealtimeNotifications.tsx" ]] && cp -a "$BACKUP_DIR/RealtimeNotifications.tsx" "$APP_DIR/src/components/RealtimeNotifications.tsx"
  [[ -f "$BACKUP_DIR/server.js" ]] && cp -a "$BACKUP_DIR/server.js" "$APP_DIR/backend/server.js"
  [[ -f "$BACKUP_DIR/server.production.js" ]] && cp -a "$BACKUP_DIR/server.production.js" "$APP_DIR/backend/server.production.js"
  [[ -f "$BACKUP_DIR/backend.env" ]] && cp -a "$BACKUP_DIR/backend.env" "$BACKEND_ENV"
  [[ -f "$BACKUP_DIR/nginx-socialbird" ]] && cp -a "$BACKUP_DIR/nginx-socialbird" /etc/nginx/sites-available/socialbird
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf "$APP_DIR/dist"
    cp -a "$BACKUP_DIR/dist" "$APP_DIR/dist"
  fi
  chown -R socialbird:socialbird "$APP_DIR/src" "$APP_DIR/dist" 2>/dev/null || true
  chown socialbird:socialbird "$APP_DIR/backend/server.js" "$APP_DIR/backend/server.production.js" 2>/dev/null || true
  chown root:socialbird "$BACKEND_ENV" 2>/dev/null || true
  chmod 0640 "$BACKEND_ENV" 2>/dev/null || true
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  (
    cd /var/lib/socialbird
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs" >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save >/dev/null 2>&1 || true
  )
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/10] Fetching production branch"
sudo -u "$APP_USER" git fetch origin "$BRANCH"

echo "[2/10] Loading source and update scripts"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  src/App.tsx \
  src/index.css \
  src/pages/Chats.tsx \
  src/components/VoiceMessageBubble.tsx \
  src/components/VoiceCallControls.tsx \
  src/components/RealtimeNotifications.tsx \
  src/lib/webrtc.ts \
  src/lib/call-audio-reliability.ts \
  backend/server.js \
  deploy/apply-mobile-call-audio-fixes.mjs \
  deploy/apply-call-reliability-fixes.mjs \
  deploy/apply-call-mobile-upload-fixes.mjs \
  deploy/apply-call-video-mount-fix.mjs \
  deploy/harden-source.mjs \
  deploy/enable-sandbox-compiler.mjs \
  deploy/nginx-socialbird.conf.template \
  deploy/install.sh

echo "[3/10] Applying call, camera, hangup, mobile and upload fixes"
node --check deploy/apply-call-mobile-upload-fixes.mjs
node --check deploy/apply-call-video-mount-fix.mjs
if ! grep -q "CALL_RELIABILITY: persistent-audio-and-health" src/components/VoiceCallControls.tsx; then
  sudo -u "$APP_USER" node deploy/apply-mobile-call-audio-fixes.mjs
  sudo -u "$APP_USER" node deploy/apply-call-reliability-fixes.mjs
fi
sudo -u "$APP_USER" node deploy/apply-call-mobile-upload-fixes.mjs
sudo -u "$APP_USER" node deploy/apply-call-video-mount-fix.mjs

grep -q "itbird-call-remote-video" src/components/VoiceCallControls.tsx
grep -q "remoteVideoRef" src/components/RealtimeNotifications.tsx
grep -q "CALL_VIDEO_FIX: mount-panel-before-remote-description" src/components/RealtimeNotifications.tsx
grep -q "MAX_CHAT_UPLOAD_BYTES" src/pages/Chats.tsx
grep -q "uploadChatMedia" backend/server.js

echo "[4/10] Raising chat upload limit to 100 MiB"
if grep -q '^MAX_UPLOAD_BYTES=' "$BACKEND_ENV"; then
  sed -i 's/^MAX_UPLOAD_BYTES=.*/MAX_UPLOAD_BYTES=104857600/' "$BACKEND_ENV"
else
  printf '\nMAX_UPLOAD_BYTES=104857600\n' >> "$BACKEND_ENV"
fi
chown root:socialbird "$BACKEND_ENV"
chmod 0640 "$BACKEND_ENV"

echo "[5/10] Rebuilding hardened backend"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js

echo "[6/10] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html

echo "[7/10] Installing Nginx upload/mobile configuration"
export SITE_DOMAIN API_DOMAIN
envsubst '${SITE_DOMAIN} ${API_DOMAIN}' \
  < "$APP_DIR/deploy/nginx-socialbird.conf.template" \
  > /etc/nginx/sites-available/socialbird
ln -sfn /etc/nginx/sites-available/socialbird /etc/nginx/sites-enabled/socialbird
nginx -t
systemctl reload nginx

echo "[8/10] Restarting API"
(
  cd /var/lib/socialbird
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
)

for attempt in {1..20}; do
  if ss -lnt | grep -q '127.0.0.1:5000'; then
    break
  fi
  if [[ "$attempt" -eq 20 ]]; then
    echo "API did not come back on port 5000." >&2
    tail -n 120 /var/log/socialbird/api-error.log 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

echo "[9/10] Verifying API/CORS and upload limits"
PREFLIGHT_HEADERS="$(mktemp)"
curl -fsS -D "$PREFLIGHT_HEADERS" -o /dev/null -X OPTIONS \
  "https://${API_DOMAIN}/messages/upload" \
  -H "Origin: https://${SITE_DOMAIN}" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
grep -qi "access-control-allow-origin: https://${SITE_DOMAIN}" "$PREFLIGHT_HEADERS"
rm -f "$PREFLIGHT_HEADERS"
grep -q '^MAX_UPLOAD_BYTES=104857600$' "$BACKEND_ENV"
grep -q 'client_max_body_size 100m;' /etc/nginx/sites-available/socialbird

echo "[10/10] Final status"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
ss -lntp | grep ':5000'
nginx -t

trap - ERR
echo
echo "Live call/mobile/upload update completed."
echo "Backup: $BACKUP_DIR"
echo "Chat upload limit: 100 MiB"
echo "Site: https://${SITE_DOMAIN}"

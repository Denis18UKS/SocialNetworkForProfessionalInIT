#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BACKEND_ENV="/etc/socialbird/backend.env"
BACKUP_DIR="/var/backups/socialbird/social-next-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"
cp -a "$APP_DIR/src" "$BACKUP_DIR/src"
cp -a "$APP_DIR/public" "$BACKUP_DIR/public"
cp -a "$APP_DIR/index.html" "$BACKUP_DIR/index.html"
cp -a "$APP_DIR/backend/server.js" "$BACKUP_DIR/server.js"
[[ -f "$APP_DIR/backend/server.production.js" ]] && cp -a "$APP_DIR/backend/server.production.js" "$BACKUP_DIR/server.production.js"
[[ -f "$APP_DIR/deploy/install.sh" ]] && cp -a "$APP_DIR/deploy/install.sh" "$BACKUP_DIR/install.sh"
cp -a "$BACKEND_ENV" "$BACKUP_DIR/backend.env"
[[ -d "$APP_DIR/dist" ]] && cp -a "$APP_DIR/dist" "$BACKUP_DIR/dist"

rollback() {
  echo "Social-next update failed; restoring previous live version..." >&2
  rm -rf "$APP_DIR/src" "$APP_DIR/public"
  cp -a "$BACKUP_DIR/src" "$APP_DIR/src"
  cp -a "$BACKUP_DIR/public" "$APP_DIR/public"
  cp -a "$BACKUP_DIR/index.html" "$APP_DIR/index.html"
  cp -a "$BACKUP_DIR/server.js" "$APP_DIR/backend/server.js"
  [[ -f "$BACKUP_DIR/server.production.js" ]] && cp -a "$BACKUP_DIR/server.production.js" "$APP_DIR/backend/server.production.js"
  [[ -f "$BACKUP_DIR/install.sh" ]] && cp -a "$BACKUP_DIR/install.sh" "$APP_DIR/deploy/install.sh"
  cp -a "$BACKUP_DIR/backend.env" "$BACKEND_ENV"
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf "$APP_DIR/dist"
    cp -a "$BACKUP_DIR/dist" "$APP_DIR/dist"
  fi
  chown -R "$APP_USER:$APP_USER" "$APP_DIR/src" "$APP_DIR/public" "$APP_DIR/index.html" "$APP_DIR/dist" 2>/dev/null || true
  chown "$APP_USER:$APP_USER" "$APP_DIR/backend/server.js" "$APP_DIR/backend/server.production.js" 2>/dev/null || true
  chown root:socialbird "$BACKEND_ENV" 2>/dev/null || true
  chmod 0640 "$BACKEND_ENV" 2>/dev/null || true
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
sudo -u "$APP_USER" git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"

echo "[2/10] Loading SocialBIRD feature files"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  index.html \
  public/sw.js \
  public/manifest.webmanifest \
  src/App.tsx \
  src/main.tsx \
  src/index.css \
  src/lib/settings.ts \
  src/lib/i18n.ts \
  src/lib/webrtc.ts \
  src/lib/call-media-bus.ts \
  src/components/CallTrackVideo.tsx \
  src/components/PushCallRegistration.tsx \
  src/components/FriendQrTools.tsx \
  src/components/VoiceCallControls.tsx \
  src/components/RealtimeNotifications.tsx \
  src/pages/FriendRequests.tsx \
  src/pages/FriendQrLanding.tsx \
  src/pages/MyProfile.tsx \
  src/pages/Settings.tsx \
  backend/social-next-features.js \
  backend/offline-call-queue.js \
  backend/web-push-native.js \
  backend/compiler-client.js \
  deploy/apply-social-next-fixes.mjs \
  deploy/apply-social-next-v2.mjs \
  deploy/ensure-vapid.mjs \
  deploy/harden-source.mjs \
  deploy/enable-sandbox-compiler.mjs \
  deploy/install.sh \
  ecosystem.config.cjs

echo "[3/10] Installing local QR tools"
apt-get install -y qrencode zbar-tools >/dev/null
command -v qrencode >/dev/null
command -v zbarimg >/dev/null

echo "[4/10] Preparing Web Push keys"
node deploy/ensure-vapid.mjs
chown root:socialbird "$BACKEND_ENV"
chmod 0640 "$BACKEND_ENV"

echo "[5/10] Applying call, language, mobile and QR fixes"
node --check deploy/apply-social-next-fixes.mjs
node --check deploy/apply-social-next-v2.mjs
node --check backend/social-next-features.js
node --check backend/offline-call-queue.js
node --check backend/web-push-native.js
sudo -u "$APP_USER" node deploy/apply-social-next-v2.mjs

grep -q 'SOCIAL_NEXT: register-features' backend/server.js
grep -q 'relayGroupVideoTrack' src/components/VoiceCallControls.tsx
grep -q 'requestNextCameraTrack' src/lib/webrtc.ts
grep -q 'FriendQrTools' src/pages/MyProfile.tsx
grep -q 'value="auto"' src/pages/Settings.tsx
grep -q 'PushCallRegistration' src/App.tsx

echo "[6/10] Rebuilding hardened API"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js

echo "[7/10] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
test -s dist/sw.js
test -s dist/manifest.webmanifest

echo "[8/10] Restarting SocialBIRD API"
(
  cd /var/lib/socialbird
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
)

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

echo "[9/10] Verifying new production features"
PUSH_STATUS="$(curl -fsS http://127.0.0.1:5000/push/public-key)"
printf '%s\n' "$PUSH_STATUS" | grep -q 'publicKey'
MAIL_STATUS="$(curl -fsS http://127.0.0.1:5000/password-reset/mail-status || true)"
printf 'Mail recovery: %s\n' "$MAIL_STATUS"
command -v qrencode >/dev/null
command -v zbarimg >/dev/null

echo "[10/10] Final status"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
ss -lntp | grep ':5000'
nginx -t

trap - ERR
echo
echo "SocialBIRD social-next update completed."
echo "Backup: $BACKUP_DIR"
echo "Added: mobile friend requests, persistent/fullscreen/PiP calls, group video relay, camera switch, Web Push incoming calls, browser-language auto mode and friend QR."

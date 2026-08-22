#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BACKUP_DIR="/var/backups/socialbird/mobile-call-delivery-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"
cp -a src/lib/reconnecting-websocket.ts "$BACKUP_DIR/reconnecting-websocket.ts"
cp -a src/components/RealtimeNotifications.tsx "$BACKUP_DIR/RealtimeNotifications.tsx"
cp -a backend/social-next-features.js "$BACKUP_DIR/social-next-features.js"
cp -a backend/offline-call-queue.js "$BACKUP_DIR/offline-call-queue.js"
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

rollback() {
  echo "Mobile-call update failed; restoring previous version..." >&2
  cp -a "$BACKUP_DIR/reconnecting-websocket.ts" src/lib/reconnecting-websocket.ts
  cp -a "$BACKUP_DIR/RealtimeNotifications.tsx" src/components/RealtimeNotifications.tsx
  cp -a "$BACKUP_DIR/social-next-features.js" backend/social-next-features.js
  cp -a "$BACKUP_DIR/offline-call-queue.js" backend/offline-call-queue.js
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -a "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" src dist backend/social-next-features.js backend/offline-call-queue.js 2>/dev/null || true
  (
    cd /var/lib/socialbird
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs" >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save >/dev/null 2>&1 || true
  )
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/7] Fetching production fix"
sudo -u "$APP_USER" git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  src/lib/reconnecting-websocket.ts \
  backend/social-next-features.js \
  backend/offline-call-queue.js \
  deploy/apply-mobile-call-delivery-fix.mjs

echo "[2/7] Verifying current call backend"
test -f backend/server.production.js
grep -q 'registerSocialNextFeatures' backend/server.production.js
grep -q 'registerOfflineCallQueue' backend/server.production.js

echo "[3/7] Applying mobile call delivery fixes"
node --check deploy/apply-mobile-call-delivery-fix.mjs
sudo -u "$APP_USER" node deploy/apply-mobile-call-delivery-fix.mjs
node --check backend/social-next-features.js
node --check backend/offline-call-queue.js
grep -q 'MOBILE_CALL_DELIVERY_FIX: authenticate first' src/lib/reconnecting-websocket.ts
grep -q 'MOBILE_CALL_DELIVERY_FIX: push-even-if-presence-is-stale' backend/social-next-features.js
grep -q 'MOBILE_CALL_DELIVERY_FIX: durable-signals' backend/offline-call-queue.js
grep -q 'MOBILE_CALL_DELIVERY_FIX: answer-without-dialog-decline' src/components/RealtimeNotifications.tsx

echo "[4/7] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[5/7] Restarting SocialBIRD API"
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

echo "[6/7] Verifying push/call support"
curl -fsS http://127.0.0.1:5000/push/public-key | grep -q 'publicKey'
ss -lnt | grep -q '127.0.0.1:5000'

echo "[7/7] Final status"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status

trap - ERR
chown -R "$APP_USER:$APP_USER" src dist backend/social-next-features.js backend/offline-call-queue.js 2>/dev/null || true

echo
echo "PC-to-mobile call delivery update completed."
echo "Backup: $BACKUP_DIR"
echo "Fixed: AUTH-before-queued-signals, stale-mobile-presence push, durable INVITE/OFFER/ICE replay, and accidental dialog decline while answering."

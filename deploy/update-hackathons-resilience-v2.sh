#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/hackathons-v2-$(date +%Y%m%d-%H%M%S)"
RESTARTED=0

[[ ${EUID} -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

for file in backend/server.js backend/server.production.js; do
  if [[ -f "$file" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$file")"
    cp -a "$file" "$BACKUP_DIR/$file"
  fi
done

rollback() {
  echo "Hackathons v2 deploy failed; restoring previous backend..." >&2
  cd "$APP_DIR"
  for file in backend/server.js backend/server.production.js; do
    if [[ -f "$BACKUP_DIR/$file" ]]; then
      cp -a "$BACKUP_DIR/$file" "$file"
    fi
  done
  chown -R "$APP_USER:$APP_USER" backend 2>/dev/null || true
  if [[ "$RESTARTED" -eq 1 ]]; then
    cd "$APP_HOME"
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 restart socialbird-api >/dev/null 2>&1 || true
  fi
  echo "Rollback restored from: $BACKUP_DIR" >&2
}
trap rollback ERR

require_text() {
  grep -Fq -- "$2" "$1" || { echo "Verification failed: $3" >&2; return 1; }
  echo "  OK: $3"
}

echo "[1/6] Fetching hackathons resilience patch"
sudo -u "$APP_USER" git fetch origin +"$BRANCH:refs/remotes/origin/$BRANCH"
REMOTE_HEAD="$(sudo -u "$APP_USER" git rev-parse "refs/remotes/origin/$BRANCH")"
echo "Remote HEAD: $REMOTE_HEAD"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  deploy/apply-hackathons-resilience-v2.mjs \
  deploy/harden-source.mjs \
  deploy/enable-sandbox-compiler.mjs

node --check deploy/apply-hackathons-resilience-v2.mjs

echo "[2/6] Applying idempotent hackathons fix to current production source"
sudo -u "$APP_USER" node deploy/apply-hackathons-resilience-v2.mjs
sudo -u "$APP_USER" node deploy/apply-hackathons-resilience-v2.mjs
node --check backend/server.js
require_text backend/server.js "APP_FIX: hackathons-resilient-v2" "resilient hackathons parser"
require_text backend/server.js "waitUntil: 'domcontentloaded'" "hackathons DOM-content navigation"
require_text backend/server.js "waitForSelector('.js-feed-post'" "hackathons feed selector wait"
require_text backend/server.js "maxScrollSteps" "bounded hackathons lazy-load scroll"
require_text backend/server.js "HACKATHON_UPSTREAM_UNAVAILABLE" "controlled hackathons upstream failure"
! grep -Fq "waitUntil: 'networkidle2'" backend/server.js || { echo "Old hackathons networkidle2 dependency remains" >&2; false; }
! grep -Fq "Promise.all(images.map" backend/server.js || { echo "Old indefinite image wait remains" >&2; false; }

# These are guardrails against replacing the current live backend with a stripped source.
require_text backend/server.js "NATIVE_FCM_PUSH" "FCM wiring preserved"
require_text backend/server.js "SOCIALBIRD_FINAL_PLATFORM_V1: final-routes" "Final Platform wiring preserved"
require_text backend/server.js "registerAdminDesktop({ app, db, transporter, getOnlineUserIds });" "Admin Desktop wiring preserved"
require_text backend/server.js "SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: notification-preference-api" "email preference API preserved"
require_text backend/server.js "SOCIALBIRD_CHAT_MULTI_UPLOAD_V1: unlimited-video-backend" "unrestricted chat video backend preserved"

echo "[3/6] Rebuilding hardened production backend"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
require_text backend/server.production.js "APP_FIX: hackathons-resilient-v2" "hackathons fix in production backend"
require_text backend/server.production.js "HACKATHON_UPSTREAM_UNAVAILABLE" "controlled upstream response in production backend"
require_text backend/server.production.js "NATIVE_FCM_PUSH" "production FCM preserved"
require_text backend/server.production.js "SOCIALBIRD_FINAL_PLATFORM_V1: final-routes" "production Final Platform preserved"
require_text backend/server.production.js "registerAdminDesktop({ app, db, transporter, getOnlineUserIds });" "production Admin Desktop preserved"
require_text backend/server.production.js "SOCIALBIRD_CHAT_MULTI_UPLOAD_V1: unlimited-video-backend" "production unrestricted chat video preserved"
require_text backend/server.production.js "PRODUCTION_HARDENING: sandboxed-compiler-route" "compiler sandbox preserved"

echo "[4/6] Restarting SocialBIRD API"
RESTARTED=1
cd "$APP_HOME"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 restart socialbird-api
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:5000/native-push/status >/tmp/socialbird-hackathons-native.json 2>/dev/null; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 logs socialbird-api --lines 120 --nostream >&2 || true
    false
  fi
  sleep 1
done

cd "$APP_DIR"
echo "[5/6] Smoke testing /hackathons"
LOCAL_CODE="$(curl --max-time 45 -sS -o /tmp/socialbird-hackathons-local.json -w '%{http_code}' http://127.0.0.1:5000/hackathons || true)"
PUBLIC_CODE="$(curl --max-time 45 -sS -o /tmp/socialbird-hackathons-public.json -w '%{http_code}' https://api.socialbird.ru/hackathons || true)"

[[ "$LOCAL_CODE" == "200" || "$LOCAL_CODE" == "503" ]] || {
  echo "Unexpected local /hackathons HTTP $LOCAL_CODE" >&2
  cat /tmp/socialbird-hackathons-local.json >&2 || true
  false
}
[[ "$PUBLIC_CODE" == "200" || "$PUBLIC_CODE" == "503" ]] || {
  echo "Unexpected public /hackathons HTTP $PUBLIC_CODE" >&2
  cat /tmp/socialbird-hackathons-public.json >&2 || true
  false
}

if [[ "$LOCAL_CODE" == "200" ]]; then
  require_text /tmp/socialbird-hackathons-local.json '"items"' "local hackathons JSON contains items"
  echo "  OK: local /hackathons responds 200"
else
  require_text /tmp/socialbird-hackathons-local.json '"code":"HACKATHON_UPSTREAM_UNAVAILABLE"' "local upstream failure is controlled"
  echo "  WARNING: hackathons.pro is currently unavailable to the VPS; API correctly returns 503 instead of 500." >&2
fi

if [[ "$PUBLIC_CODE" == "200" ]]; then
  require_text /tmp/socialbird-hackathons-public.json '"items"' "public hackathons JSON contains items"
  echo "  OK: public /hackathons responds 200"
else
  require_text /tmp/socialbird-hackathons-public.json '"code":"HACKATHON_UPSTREAM_UNAVAILABLE"' "public upstream failure is controlled"
  echo "  WARNING: public API returns controlled 503 because the upstream feed is unavailable." >&2
fi

echo "[6/6] Saving stable PM2 state"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
rm -f /tmp/socialbird-hackathons-native.json /tmp/socialbird-hackathons-local.json /tmp/socialbird-hackathons-public.json
trap - ERR
chown -R "$APP_USER:$APP_USER" "$APP_DIR/backend" 2>/dev/null || true

echo
echo "Hackathons resilience v2 deployed successfully."
echo "The parser no longer depends on global network-idle, unbounded scrolling, or all images loading."
echo "Transient hackathons.pro failures now return controlled 503 instead of generic 500; stale cache is still served when available."
echo "No upload/video limits were changed."
echo "Backup: $BACKUP_DIR"

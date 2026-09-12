#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/support-chat-email-$(date +%Y%m%d-%H%M%S)"
RESTARTED=0

[[ ${EUID} -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

BACKUP_FILES=(
  backend/server.js
  backend/server.production.js
  backend/notification-preferences.js
  public/support-tbank-qr.png
  src/App.tsx
  src/components/AppSidebar.tsx
  src/components/ChatMessageText.tsx
  src/components/EmailNotificationPreference.tsx
  src/lib/chat-text.mjs
  src/lib/chat-text.d.ts
  src/pages/Chats.tsx
  src/pages/GroupChats.tsx
  src/pages/Settings.tsx
  src/pages/SupportProject.tsx
)

for file in "${BACKUP_FILES[@]}"; do
  if [[ -f "$file" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$file")"
    cp -a "$file" "$BACKUP_DIR/$file"
    printf '%s\n' "$file" >> "$BACKUP_DIR/present-files.txt"
  fi
done
[[ -d dist ]] && cp -al dist "$BACKUP_DIR/dist"

rollback() {
  echo "Support/chat/email deploy failed; restoring previous SocialBIRD state..." >&2
  cd "$APP_DIR"
  for file in "${BACKUP_FILES[@]}"; do
    rm -f "$file"
    if [[ -f "$BACKUP_DIR/$file" ]]; then
      mkdir -p "$(dirname "$file")"
      cp -a "$BACKUP_DIR/$file" "$file"
    fi
  done
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -al "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" backend src public dist 2>/dev/null || true
  if [[ "$RESTARTED" -eq 1 ]]; then
    cd "$APP_HOME"
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs" >/dev/null 2>&1 || true
  fi
  echo "Rollback restored from: $BACKUP_DIR" >&2
}
trap rollback ERR

require_text() {
  grep -Fq -- "$2" "$1" || { echo "Verification failed: $3" >&2; return 1; }
  echo "  OK: $3"
}

echo "[1/8] Fetching support/chat/email feature files"
sudo -u "$APP_USER" git fetch origin +"$BRANCH:refs/remotes/origin/$BRANCH"
REMOTE_HEAD="$(sudo -u "$APP_USER" git rev-parse "refs/remotes/origin/$BRANCH")"
echo "Remote HEAD: $REMOTE_HEAD"

# Do not checkout the large/live source targets here. The idempotent patcher
# updates the current production source in place so Call V8, C-Party and other
# already deployed wiring remain intact.
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  backend/notification-preferences.js \
  public/support-tbank-qr.png \
  src/lib/chat-text.mjs src/lib/chat-text.d.ts \
  src/components/ChatMessageText.tsx src/components/EmailNotificationPreference.tsx \
  src/pages/SupportProject.tsx \
  tests/support-chat-email.test.mjs \
  deploy/apply-support-chat-email-v1.mjs \
  deploy/harden-source.mjs deploy/enable-sandbox-compiler.mjs

node --check backend/notification-preferences.js
node --check deploy/apply-support-chat-email-v1.mjs

echo "[2/8] Running focused behavior tests"
sudo -u "$APP_USER" node --test tests/support-chat-email.test.mjs

echo "[3/8] Applying idempotent feature wiring"
sudo -u "$APP_USER" node deploy/apply-support-chat-email-v1.mjs
sudo -u "$APP_USER" node deploy/apply-support-chat-email-v1.mjs

require_text src/pages/Chats.tsx "SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: personal-chat" "personal chat multiline/link behavior"
require_text src/pages/GroupChats.tsx "SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: group-chat" "group chat multiline/link behavior"
require_text src/pages/Settings.tsx "SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: settings" "email preference settings"
require_text src/App.tsx "SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: support-route" "support page route"
require_text src/components/AppSidebar.tsx "SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: support-nav" "support navigation entry"
require_text backend/server.js "SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: notification-preference-api" "notification preference API"
require_text backend/server.js "email_notifications_enabled" "email notification preference schema"
require_text backend/server.js "NATIVE_FCM_PUSH" "FCM wiring preserved"
require_text backend/server.js "SOCIALBIRD_FINAL_PLATFORM_V1: final-routes" "final platform wiring preserved"

test -s public/support-tbank-qr.png || { echo "T-Bank support QR image is missing after checkout." >&2; false; }
echo "  OK: T-Bank support QR image is installed"

echo "[4/8] Rebuilding hardened production API"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
require_text backend/server.production.js "SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: notification-preference-api" "production notification preference API"
require_text backend/server.production.js "email_notifications_enabled" "production email preference gate"
require_text backend/server.production.js "NATIVE_FCM_PUSH" "production FCM preserved"
require_text backend/server.production.js "PRODUCTION_HARDENING: sandboxed-compiler-route" "compiler sandbox preserved"

echo "[5/8] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .
test -s dist/support-tbank-qr.png

echo "[6/8] Restarting SocialBIRD API"
RESTARTED=1
cd "$APP_HOME"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"

for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:5000/native-push/status >/tmp/socialbird-support-native.json 2>/dev/null; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "SocialBIRD API did not become healthy." >&2
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 logs socialbird-api --lines 120 --nostream >&2 || true
    false
  fi
  sleep 1
done

cd "$APP_DIR"
echo "[7/8] Smoke testing protected preference API and public site"
PREF_CODE="$(curl -sS -o /tmp/socialbird-support-pref.json -w '%{http_code}' http://127.0.0.1:5000/notification-preferences || true)"
[[ "$PREF_CODE" == "401" || "$PREF_CODE" == "403" ]] || {
  echo "Unexpected unauthenticated notification preferences status: $PREF_CODE" >&2
  cat /tmp/socialbird-support-pref.json >&2 || true
  false
}
echo "  OK: notification preferences API is mounted and protected ($PREF_CODE)"

require_text /tmp/socialbird-support-native.json '"configured":true' "FCM remains configured"
PUBLIC_CODE="$(curl -sS -o /dev/null -w '%{http_code}' https://socialbird.ru/support || true)"
[[ "$PUBLIC_CODE" =~ ^(200|301|302)$ ]] || { echo "Unexpected /support public status: $PUBLIC_CODE" >&2; false; }
echo "  OK: /support responds through socialbird.ru ($PUBLIC_CODE)"
QR_CODE="$(curl -sS -o /dev/null -w '%{http_code}' https://socialbird.ru/support-tbank-qr.png || true)"
[[ "$QR_CODE" == "200" ]] || { echo "Unexpected support QR public status: $QR_CODE" >&2; false; }
echo "  OK: support QR responds through socialbird.ru ($QR_CODE)"

echo "[8/8] Saving stable PM2 state"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
sleep 2
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
rm -f /tmp/socialbird-support-native.json /tmp/socialbird-support-pref.json
trap - ERR
chown -R "$APP_USER:$APP_USER" "$APP_DIR/backend" "$APP_DIR/src" "$APP_DIR/public" "$APP_DIR/dist" 2>/dev/null || true

echo
echo "SocialBIRD support page + T-Bank QR + multiline/clickable chat + email notification preferences deployed successfully."
echo "No chat/C-Party video size limit was introduced or changed."
echo "Backup: $BACKUP_DIR"

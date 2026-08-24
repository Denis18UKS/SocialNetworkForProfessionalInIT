#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/registration-admin-android-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

BACKUP_FILES=(
  backend/server.js
  backend/server.production.js
  src/pages/Register.tsx
  src/pages/AndroidApp.tsx
  src/components/AppSidebar.tsx
)

for file in "${BACKUP_FILES[@]}"; do
  if [[ -e "$file" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$file")"
    cp -a "$file" "$BACKUP_DIR/$file"
  fi
done
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

rollback() {
  echo "Deployment failed; restoring previous SocialBIRD source/build..." >&2
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
  cd "$APP_HOME"
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs" >/dev/null 2>&1 || true
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

echo "[1/9] Fetching production feature files"
sudo -u "$APP_USER" git fetch origin +"$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  backend/registration-verification.js \
  backend/admin-desktop.js \
  backend/android-version.js \
  deploy/apply-security-admin-update.mjs \
  deploy/apply-chat-media-backend-fix.mjs \
  deploy/apply-native-android-integration.mjs \
  deploy/apply-native-fcm-push.mjs \
  deploy/harden-source.mjs \
  deploy/enable-sandbox-compiler.mjs \
  src/pages/Register.tsx \
  src/pages/AndroidApp.tsx \
  src/components/AppSidebar.tsx

echo "[2/9] Checking new backend modules"
node --check backend/registration-verification.js
node --check backend/admin-desktop.js
node --check backend/android-version.js
node --check deploy/apply-security-admin-update.mjs

require_text backend/registration-verification.js "app.post('/register/verify'" "email verification endpoint"
require_text backend/registration-verification.js "auth_rate_limits" "registration anti-bot rate limits"
require_text backend/admin-desktop.js "scope !== 'admin-desktop'" "separate admin desktop session scope"
require_text backend/admin-desktop.js "admin_desktop_audit" "admin audit log"
require_text backend/android-version.js "SocialBIRD-Android-version.json" "Android release metadata source"

echo "[3/9] Applying idempotent backend wiring"
sudo -u "$APP_USER" node deploy/apply-chat-media-backend-fix.mjs
sudo -u "$APP_USER" node deploy/apply-native-android-integration.mjs
sudo -u "$APP_USER" node deploy/apply-native-fcm-push.mjs
sudo -u "$APP_USER" node deploy/apply-security-admin-update.mjs

require_text backend/server.js "registerEmailVerifiedRegistration({" "verified registration wired"
require_text backend/server.js "registerAdminDesktop({ app, db, transporter, getOnlineUserIds });" "Admin Desktop API wired"
require_text backend/server.js "registerAndroidVersion({ app });" "Android version API wired"
require_text backend/server.js "const uploadChatMedia" "chat upload middleware preserved"
require_text backend/server.js "NATIVE_FCM_PUSH: register-routes" "native FCM wiring preserved"

echo "[4/9] Rebuilding hardened production API"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
require_text backend/server.production.js "registerEmailVerifiedRegistration({" "production verified registration"
require_text backend/server.production.js "registerAdminDesktop({ app, db, transporter, getOnlineUserIds });" "production Admin Desktop API"
require_text backend/server.production.js "NATIVE_FCM_PUSH: register-routes" "production FCM remains enabled"
require_text backend/server.production.js "PRODUCTION_HARDENING: sandboxed-compiler-route" "compiler sandbox remains enabled"

echo "[5/9] Building production frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[6/9] Restarting only SocialBIRD API"
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

echo "[7/9] Verifying new production endpoints"
curl -fsS http://127.0.0.1:5000/register/status -o /tmp/socialbird-register-status.json
curl -fsS http://127.0.0.1:5000/admin/desktop/status -o /tmp/socialbird-admin-status.json
curl -fsS https://api.socialbird.ru/push/public-key -o /tmp/socialbird-public-key.json

require_text /tmp/socialbird-native-status.json '"configured":true' "FCM backend still configured"
require_text /tmp/socialbird-register-status.json '"emailVerification":true' "email verification enabled"
require_text /tmp/socialbird-admin-status.json '"enabled":true' "Admin Desktop API enabled"
require_text /tmp/socialbird-admin-status.json '"twoFactorRequired":true' "Admin Desktop email 2FA required"
require_text /tmp/socialbird-public-key.json '"publicKey"' "public API reachable through api.socialbird.ru"

cat /tmp/socialbird-register-status.json
echo
cat /tmp/socialbird-admin-status.json
echo

if grep -Fq '"smtpConfigured":false' /tmp/socialbird-register-status.json; then
  echo "WARNING: SMTP is not configured. Existing users can still log in, but new verified registrations and Admin Desktop email 2FA cannot send codes until SMTP is configured." >&2
fi

echo "[8/9] Checking Android update metadata endpoint"
if curl -fsS http://127.0.0.1:5000/android/version -o /tmp/socialbird-android-version.json 2>/dev/null; then
  cat /tmp/socialbird-android-version.json
  echo
else
  echo "Android version metadata is not published yet. This is non-fatal; run the updated Android workflow after deployment."
fi

echo "[9/9] Saving stable PM2 state"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
sleep 2
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
curl -fsS http://127.0.0.1:5000/register/status >/dev/null
curl -fsS http://127.0.0.1:5000/admin/desktop/status >/dev/null
curl -fsS http://127.0.0.1:5000/native-push/status >/dev/null

rm -f /tmp/socialbird-native-status.json /tmp/socialbird-register-status.json /tmp/socialbird-admin-status.json /tmp/socialbird-public-key.json /tmp/socialbird-android-version.json
trap - ERR
chown -R "$APP_USER:$APP_USER" "$APP_DIR/backend" "$APP_DIR/src" "$APP_DIR/dist" 2>/dev/null || true

echo
echo "Verified registration + Admin Desktop API + Android update-awareness deployed successfully."
echo "Backup: $BACKUP_DIR"
echo "Next: build/publish the updated Android APK and Admin Desktop installer."

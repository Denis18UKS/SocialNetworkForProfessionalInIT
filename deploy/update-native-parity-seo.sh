#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BACKUP_DIR="/var/backups/socialbird/native-parity-seo-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

backup_file() {
  local source="$1"
  local target="$BACKUP_DIR/$1"
  if [[ -e "$source" ]]; then
    mkdir -p "$(dirname "$target")"
    cp -a "$source" "$target"
  fi
  return 0
}

for file in \
  package.json \
  index.html \
  public/robots.txt \
  public/sitemap.xml \
  src/App.tsx \
  src/pages/Index.tsx \
  src/pages/AndroidApp.tsx \
  src/components/AppSidebar.tsx \
  src/components/SeoManager.tsx \
  src/components/NativeAppBridge.tsx \
  src/components/PushCallRegistration.tsx \
  src/components/RealtimeNotifications.tsx \
  src/components/VoiceCallControls.tsx \
  src/lib/i18n.ts \
  src/lib/screen-share.ts \
  backend/server.js \
  backend/server.production.js \
  deploy/install.sh; do
  backup_file "$file"
done
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

rollback() {
  echo "Native parity/SEO update failed; restoring previous live version..." >&2
  for file in \
    package.json \
    index.html \
    public/robots.txt \
    public/sitemap.xml \
    src/App.tsx \
    src/pages/Index.tsx \
    src/pages/AndroidApp.tsx \
    src/components/AppSidebar.tsx \
    src/components/SeoManager.tsx \
    src/components/NativeAppBridge.tsx \
    src/components/PushCallRegistration.tsx \
    src/components/RealtimeNotifications.tsx \
    src/components/VoiceCallControls.tsx \
    src/lib/i18n.ts \
    src/lib/screen-share.ts \
    backend/server.js \
    backend/server.production.js \
    deploy/install.sh; do
    if [[ -e "$BACKUP_DIR/$file" ]]; then
      mkdir -p "$(dirname "$file")"
      cp -a "$BACKUP_DIR/$file" "$file"
    fi
  done
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -a "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" src public dist backend 2>/dev/null || true
  (
    cd /var/lib/socialbird
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs" >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save >/dev/null 2>&1 || true
  )
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/8] Fetching Android parity and SEO files"
sudo -u "$APP_USER" git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  package.json \
  index.html \
  public/robots.txt \
  public/sitemap.xml \
  scripts/generate-seo.mjs \
  src/App.tsx \
  src/pages/AndroidApp.tsx \
  src/components/AppSidebar.tsx \
  src/components/SeoManager.tsx \
  src/components/NativeAppBridge.tsx \
  src/lib/i18n.ts \
  src/lib/screen-share.ts \
  deploy/apply-seo-fixes.mjs \
  deploy/apply-native-android-integration.mjs \
  deploy/harden-source.mjs \
  deploy/enable-sandbox-compiler.mjs

echo "[2/8] Applying one shared website/Android architecture"
node --check deploy/apply-native-android-integration.mjs
sudo -u "$APP_USER" node deploy/apply-native-android-integration.mjs
grep -q 'clientRole: "call-host"' src/components/RealtimeNotifications.tsx
grep -q 'clientRole: "call-control"' src/components/VoiceCallControls.tsx
grep -q 'AUTH_NATIVE' backend/server.js
grep -q 'durable-call-replay-owner' backend/server.js
grep -q 'native-notifications-own-background' src/components/PushCallRegistration.tsx
grep -q 'url: "/android-app"' src/components/AppSidebar.tsx
grep -q 'path="/android-app"' src/App.tsx
grep -q 'ITBirdAndroid' src/lib/screen-share.ts
grep -q 'SocialBIRD-Android.apk' src/pages/AndroidApp.tsx

echo "[3/8] Applying SEO content and metadata"
node --check deploy/apply-seo-fixes.mjs
node --check scripts/generate-seo.mjs
sudo -u "$APP_USER" node deploy/apply-seo-fixes.mjs
grep -q 'SEO_HOME_INTRO' src/pages/Index.tsx
grep -q 'SeoManager' src/App.tsx
grep -q 'socialbird.31.207.74.138.nip.io' public/sitemap.xml

echo "[4/8] Rebuilding hardened API"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
grep -q 'AUTH_NATIVE' backend/server.production.js
grep -q 'durable-call-replay-owner' backend/server.production.js

echo "[5/8] Building frontend and static SEO routes"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
test -s dist/robots.txt
test -s dist/sitemap.xml
test -s dist/android-app/index.html
test -s dist/compiler/index.html
test -s dist/xakatons/index.html
test -s dist/forum/index.html
grep -q 'SocialBIRD — социальная сеть для IT-специалистов' dist/index.html
grep -q 'rel="canonical"' dist/index.html

echo "[6/8] Restarting SocialBIRD API"
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

echo "[7/8] Verifying API, Android route and SEO artifacts"
curl -fsS http://127.0.0.1:5000/push/public-key | grep -q 'publicKey'
grep -q 'Sitemap: https://socialbird.31.207.74.138.nip.io/sitemap.xml' dist/robots.txt
grep -q '<loc>https://socialbird.31.207.74.138.nip.io/' dist/sitemap.xml
grep -q 'SocialBIRD-Android.apk' src/pages/AndroidApp.tsx

echo "[8/8] Final status"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
ss -lntp | grep ':5000'

trap - ERR
chown -R "$APP_USER:$APP_USER" src public dist backend 2>/dev/null || true

echo
echo "Native Android parity + SEO update completed."
echo "Backup: $BACKUP_DIR"
echo "Website and APK use the same React/auth/WebRTC core; Android owns only OS-level integrations."
echo "SEO: canonical/meta/schema, robots.txt, sitemap.xml, public route HTML and visible landing copy are enabled."
echo "Android download page: /android-app"

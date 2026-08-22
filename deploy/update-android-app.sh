#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/android-app-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

for file in \
  src/App.tsx \
  src/components/AppSidebar.tsx \
  src/lib/i18n.ts \
  src/lib/screen-share.ts; do
  mkdir -p "$BACKUP_DIR/$(dirname "$file")"
  cp -a "$file" "$BACKUP_DIR/$file"
done

if [[ -f src/pages/AndroidApp.tsx ]]; then
  mkdir -p "$BACKUP_DIR/src/pages"
  cp -a src/pages/AndroidApp.tsx "$BACKUP_DIR/src/pages/AndroidApp.tsx"
  touch "$BACKUP_DIR/android-page-existed"
fi
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

rollback() {
  echo "Android app website update failed; restoring previous frontend..." >&2
  cp -a "$BACKUP_DIR/src/App.tsx" src/App.tsx
  cp -a "$BACKUP_DIR/src/components/AppSidebar.tsx" src/components/AppSidebar.tsx
  cp -a "$BACKUP_DIR/src/lib/i18n.ts" src/lib/i18n.ts
  cp -a "$BACKUP_DIR/src/lib/screen-share.ts" src/lib/screen-share.ts
  if [[ -f "$BACKUP_DIR/android-page-existed" ]]; then
    cp -a "$BACKUP_DIR/src/pages/AndroidApp.tsx" src/pages/AndroidApp.tsx
  else
    rm -f src/pages/AndroidApp.tsx
  fi
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -a "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/5] Fetching Android app website files"
sudo -u "$APP_USER" git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  src/App.tsx \
  src/components/AppSidebar.tsx \
  src/lib/i18n.ts \
  src/lib/screen-share.ts \
  src/pages/AndroidApp.tsx

echo "[2/5] Verifying Android route and native bridge"
grep -q 'path="/android-app"' src/App.tsx
grep -q 'url: "/android-app"' src/components/AppSidebar.tsx
grep -q 'ITBirdAndroid' src/lib/screen-share.ts
grep -q 'MediaProjection' src/pages/AndroidApp.tsx

echo "[3/5] Building production frontend"
sudo -u "$APP_USER" npm run build

echo "[4/5] Verifying generated frontend"
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[5/5] Final status"
trap - ERR
chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true

echo
echo "Android app website update completed."
echo "Backup: $BACKUP_DIR"
echo "Sidebar: /android-app"
echo "APK: https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android.apk"

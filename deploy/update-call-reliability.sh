#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/call-reliability-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"
cp -a src/components/VoiceCallControls.tsx "$BACKUP_DIR/VoiceCallControls.tsx"
cp -a src/components/RealtimeNotifications.tsx "$BACKUP_DIR/RealtimeNotifications.tsx"
if [[ -d dist ]]; then cp -a dist "$BACKUP_DIR/dist"; fi

rollback() {
  echo "Call update failed; restoring previous frontend." >&2
  cp -a "$BACKUP_DIR/VoiceCallControls.tsx" "$APP_DIR/src/components/VoiceCallControls.tsx"
  cp -a "$BACKUP_DIR/RealtimeNotifications.tsx" "$APP_DIR/src/components/RealtimeNotifications.tsx"
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf "$APP_DIR/dist"
    cp -a "$BACKUP_DIR/dist" "$APP_DIR/dist"
  fi
  chown socialbird:socialbird "$APP_DIR/src/components/VoiceCallControls.tsx" "$APP_DIR/src/components/RealtimeNotifications.tsx"
}
trap rollback ERR

echo "[1/7] Fetching production branch"
sudo -u "$APP_USER" git fetch origin "$BRANCH"

echo "[2/7] Loading call source and reliability patch"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  src/components/VoiceCallControls.tsx \
  src/components/RealtimeNotifications.tsx \
  src/lib/webrtc.ts \
  src/lib/call-audio-reliability.ts \
  deploy/apply-call-reliability-fixes.mjs

echo "[3/7] Checking patch syntax"
node --check deploy/apply-call-reliability-fixes.mjs

echo "[4/7] Applying speaking indicators and audio recovery"
sudo -u "$APP_USER" node deploy/apply-call-reliability-fixes.mjs

grep -q "CALL_RELIABILITY: persistent-audio-and-health" src/components/VoiceCallControls.tsx
grep -q "CALL_RELIABILITY: incoming audio health" src/components/RealtimeNotifications.tsx
grep -q "Говорит" src/components/VoiceCallControls.tsx
grep -q "Говорит" src/components/RealtimeNotifications.tsx

echo "[5/7] Building production frontend"
sudo -u "$APP_USER" npm run build

echo "[6/7] Reloading nginx"
nginx -t
systemctl reload nginx

echo "[7/7] Verifying deployed frontend"
test -s dist/index.html
BUNDLE="$(find dist/assets -maxdepth 1 -type f -name 'index-*.js' | sort | tail -n1)"
if [[ -z "$BUNDLE" || ! -s "$BUNDLE" ]]; then
  echo "Production JS bundle was not created." >&2
  exit 1
fi

trap - ERR

echo
echo "Call reliability update completed."
echo "Backup: $BACKUP_DIR"
if ss -lnt | grep -q '127.0.0.1:5000'; then
  echo "API: listening on 127.0.0.1:5000"
else
  echo "WARNING: API is not listening on 127.0.0.1:5000. Calls cannot work until the API is recovered." >&2
fi

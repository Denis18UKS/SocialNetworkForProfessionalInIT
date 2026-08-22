#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
BACKUP_DIR="/var/backups/socialbird/call-hangup-lifecycle-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"
cp -a src/components/VoiceCallControls.tsx "$BACKUP_DIR/VoiceCallControls.tsx"
[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

rollback() {
  echo "Call hangup lifecycle update failed; restoring previous frontend..." >&2
  cp -a "$BACKUP_DIR/VoiceCallControls.tsx" src/components/VoiceCallControls.tsx
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -a "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/5] Fetching production fix"
sudo -u "$APP_USER" git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- deploy/apply-call-hangup-lifecycle-fix.mjs

echo "[2/5] Checking patch"
node --check deploy/apply-call-hangup-lifecycle-fix.mjs

echo "[3/5] Applying hangup lifecycle guard"
sudo -u "$APP_USER" node deploy/apply-call-hangup-lifecycle-fix.mjs
grep -q 'CALL_HANGUP_LIFECYCLE_FIX: active-call-guard' src/components/VoiceCallControls.tsx
grep -q 'notifyRemote && hadActiveCall' src/components/VoiceCallControls.tsx

echo "[4/5] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[5/5] Final verification"
if grep -n 'socket.close();' src/components/VoiceCallControls.tsx | tail -n 1 >/dev/null; then :; fi

trap - ERR
chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true

echo
echo "Call hangup lifecycle update completed."
echo "Backup: $BACKUP_DIR"
echo "Fixed: component unmount no longer sends CALL_HANGUP; remote hangup is not echoed back; explicit hangup still notifies the peer."

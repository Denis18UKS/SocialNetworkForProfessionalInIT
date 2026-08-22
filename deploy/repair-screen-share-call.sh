#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
REPAIR_BACKUP="/var/backups/socialbird/screen-repair-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"

SOURCE_BACKUP=""
while IFS= read -r candidate; do
  if [[ -f "$candidate/VoiceCallControls.tsx" && -f "$candidate/RealtimeNotifications.tsx" ]]; then
    SOURCE_BACKUP="$candidate"
    break
  fi
done < <(find /var/backups/socialbird -maxdepth 1 -type d -name 'screen-share-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2-)

if [[ -z "$SOURCE_BACKUP" ]]; then
  echo "No pre-screen-share backup was found under /var/backups/socialbird/screen-share-*." >&2
  echo "Do not continue with an in-place patch. Send this output back so the call stack can be rebuilt from the production generators." >&2
  exit 2
fi

install -d -o root -g root -m 0750 "$REPAIR_BACKUP"
cp -a src/components/VoiceCallControls.tsx "$REPAIR_BACKUP/VoiceCallControls.tsx"
cp -a src/components/RealtimeNotifications.tsx "$REPAIR_BACKUP/RealtimeNotifications.tsx"
[[ -f src/lib/screen-share.ts ]] && cp -a src/lib/screen-share.ts "$REPAIR_BACKUP/screen-share.ts"
[[ -d dist ]] && cp -a dist "$REPAIR_BACKUP/dist"

rollback() {
  echo "Screen/call repair failed; restoring the state from before this repair..." >&2
  cp -a "$REPAIR_BACKUP/VoiceCallControls.tsx" src/components/VoiceCallControls.tsx
  cp -a "$REPAIR_BACKUP/RealtimeNotifications.tsx" src/components/RealtimeNotifications.tsx
  if [[ -f "$REPAIR_BACKUP/screen-share.ts" ]]; then
    cp -a "$REPAIR_BACKUP/screen-share.ts" src/lib/screen-share.ts
  fi
  if [[ -d "$REPAIR_BACKUP/dist" ]]; then
    rm -rf dist
    cp -a "$REPAIR_BACKUP/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true
  echo "Rollback completed. Backup: $REPAIR_BACKUP" >&2
}
trap rollback ERR

echo "[1/7] Fetching fixed screen-share patch"
sudo -u "$APP_USER" git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- src/lib/screen-share.ts deploy/apply-screen-share-audio-fixes.mjs

echo "[2/7] Restoring the last known-good call components"
echo "Source backup: $SOURCE_BACKUP"
cp -a "$SOURCE_BACKUP/VoiceCallControls.tsx" src/components/VoiceCallControls.tsx
cp -a "$SOURCE_BACKUP/RealtimeNotifications.tsx" src/components/RealtimeNotifications.tsx
chown "$APP_USER:$APP_USER" src/components/VoiceCallControls.tsx src/components/RealtimeNotifications.tsx

echo "[3/7] Checking the v2 patch"
node --check deploy/apply-screen-share-audio-fixes.mjs
grep -q 'SCREEN_SHARE_AUDIO_V2' deploy/apply-screen-share-audio-fixes.mjs

echo "[4/7] Applying non-invasive screen audio fix"
sudo -u "$APP_USER" node deploy/apply-screen-share-audio-fixes.mjs
grep -q 'SCREEN_SHARE_AUDIO_V2: outgoing' src/components/VoiceCallControls.tsx
grep -q 'SCREEN_SHARE_AUDIO_V2: incoming' src/components/RealtimeNotifications.tsx
if grep -q 'SCREEN_SHARE_AUDIO_FIX: outgoing' src/components/VoiceCallControls.tsx; then
  echo "Old screen-share patch is still present; refusing deployment." >&2
  exit 1
fi

# The previous regression changed the primary microphone relay storage type. V2 must
# keep the known-good numeric peer-id map and use separate maps only for extra audio.
grep -q 'remoteAudioTracksRef = useRef<Record<number, MediaStreamTrack>>' src/components/VoiceCallControls.tsx
grep -q 'extraRemoteAudioTracksRef' src/components/VoiceCallControls.tsx

echo "[5/7] Building frontend"
sudo -u "$APP_USER" npm run build

echo "[6/7] Verifying generated assets"
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[7/7] Keeping backend and services untouched"
# This repair is frontend-only on purpose. No PM2/Nginx/Coturn/compiler restart.

trap - ERR
chown -R "$APP_USER:$APP_USER" src dist 2>/dev/null || true

echo
echo "Screen-share/call repair completed."
echo "Restored call base from: $SOURCE_BACKUP"
echo "Repair backup: $REPAIR_BACKUP"
echo "Fixed: duplicate screen-share starts, separated display video/audio streams, screen audio sender cleanup, and isolated extra group audio relay."

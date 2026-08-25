#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BRANCH="deploy/socialbird-vps-production"
BACKUP_ROOT="/var/backups/socialbird"
BACKUP_DIR="$BACKUP_ROOT/final-platform-$(date +%Y%m%d-%H%M%S)"
RESTARTED=0
MIN_FREE_KB=$((1024 * 1024))

[[ ${EUID} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
cd "$APP_DIR"

FREE_KB="$(df -Pk "$APP_DIR" | awk 'NR==2 {print $4}')"
if [[ -z "$FREE_KB" || "$FREE_KB" -lt "$MIN_FREE_KB" ]]; then
  echo "Not enough free disk space for a safe SocialBIRD deploy." >&2
  echo "Required before deploy: at least 1 GiB free; current: $(( ${FREE_KB:-0} / 1024 )) MiB." >&2
  echo "Inspect /var/backups/socialbird and old deployment backups first." >&2
  exit 28
fi

mkdir -p "$BACKUP_ROOT" "$BACKUP_DIR"

BACKUP_FILES=(
  backend/server.js backend/server.production.js
  backend/socialbird-final-platform.js backend/strict-privacy-gate.js backend/stable-news-time.js
  backend/cinema-qr.js backend/cinema-stream.js backend/admin-cinema-library.js backend/cinema-transcode-worker.js
  src/App.tsx src/components/VoiceCallControls.tsx src/components/GlobalCallOverlay.tsx src/components/AppSidebar.tsx
  src/components/call/CallProvider.tsx src/components/CinemaQrScanner.tsx src/components/RealtimeNotifications.tsx
  src/lib/call-audio-reliability.ts src/lib/webrtc.ts src/lib/screen-share.ts src/lib/cinema-upload.ts
  src/main.tsx src/lib/offline.ts public/sw.js public/manifest.webmanifest
  src/pages/GroupChats.tsx src/pages/Users.tsx src/pages/Settings.tsx src/pages/Login.tsx
  src/pages/AndroidApp.tsx src/pages/CinemaParty.tsx src/pages/CinemaPartyRoom.tsx src/styles/chat-platform-v1.css
)
for f in "${BACKUP_FILES[@]}"; do
  if [[ -f "$f" ]]; then mkdir -p "$BACKUP_DIR/$(dirname "$f")"; cp -a "$f" "$BACKUP_DIR/$f"; fi
done
if [[ -d dist ]]; then cp -al dist "$BACKUP_DIR/dist"; fi

rollback() {
  echo "Final deploy failed; restoring backed-up production files..." >&2
  cd "$APP_DIR"
  for f in "${BACKUP_FILES[@]}"; do
    if [[ -f "$BACKUP_DIR/$f" ]]; then mkdir -p "$(dirname "$f")"; cp -a "$BACKUP_DIR/$f" "$f"; fi
  done
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -al "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" backend src public dist 2>/dev/null || true
  if [[ "$RESTARTED" -eq 1 ]]; then
    cd "$APP_HOME"
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 restart socialbird-api >/dev/null 2>&1 || true
  fi
  echo "Rollback source: $BACKUP_DIR" >&2
}
trap rollback ERR

require_text() {
  grep -Fq -- "$2" "$1" || { echo "Verification failed: $3" >&2; return 1; }
  echo "  OK: $3"
}

echo "[1/10] Fetching final platform"
sudo -u "$APP_USER" git fetch origin +"$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  backend/socialbird-final-platform.js backend/strict-privacy-gate.js backend/stable-news-time.js \
  backend/cinema-qr.js backend/cinema-stream.js backend/admin-cinema-library.js backend/cinema-transcode-worker.js \
  admin-desktop/main.cjs admin-desktop/preload.cjs admin-desktop/renderer/cinema.js \
  src/App.tsx src/components/VoiceCallControls.tsx src/components/GlobalCallOverlay.tsx src/components/call/CallProvider.tsx \
  src/components/RealtimeNotifications.tsx src/components/StrictUserProfileRoute.tsx src/components/AppSidebar.tsx src/components/CinemaQrScanner.tsx \
  src/lib/call-audio-reliability.ts src/lib/webrtc.ts src/lib/screen-share.ts src/lib/cinema-upload.ts \
  src/main.tsx src/lib/offline.ts public/sw.js public/manifest.webmanifest \
  src/pages/Login.tsx src/pages/EmailChange.tsx src/pages/ChatFolders.tsx src/pages/AndroidApp.tsx src/pages/CinemaParty.tsx src/pages/CinemaPartyRoom.tsx \
  src/pages/CinemaTitle.tsx src/pages/CinemaPerson.tsx \
  deploy/apply-call-system-v4.mjs deploy/apply-socialbird-final-runtime-v1.mjs \
  deploy/apply-cparty-realtime-end-v1.mjs \
  deploy/apply-cinema-format-normalization-v1.mjs deploy/apply-cinema-existing-normalize-v1.mjs deploy/apply-cinema-upload-compat-v1.mjs \
  deploy/harden-source.mjs deploy/enable-sandbox-compiler.mjs

echo "[2/10] Checking modules"
for f in \
  backend/socialbird-final-platform.js backend/strict-privacy-gate.js backend/stable-news-time.js \
  backend/cinema-qr.js backend/cinema-stream.js backend/admin-cinema-library.js backend/cinema-transcode-worker.js \
  deploy/apply-call-system-v4.mjs deploy/apply-socialbird-final-runtime-v1.mjs deploy/apply-cparty-realtime-end-v1.mjs \
  deploy/apply-cinema-format-normalization-v1.mjs deploy/apply-cinema-existing-normalize-v1.mjs deploy/apply-cinema-upload-compat-v1.mjs public/sw.js; do
  node --check "$f"
done
require_text backend/socialbird-final-platform.js "cinemaResumableUpload: true" "C-Party resumable upload"
require_text backend/socialbird-final-platform.js "videoRecompression: false" "original video quality for compatible media"
require_text backend/strict-privacy-gate.js "profile_restricted: true" "strict profile privacy"
require_text backend/admin-cinema-library.js "registerAdminCinemaLibrary" "Admin C-Party library API"
require_text backend/admin-cinema-library.js "DISK_RESERVE_BYTES" "safe cinema disk guard"
require_text backend/cinema-transcode-worker.js "libx264" "FFmpeg H.264 normalization worker"
require_text src/lib/cinema-upload.ts "MAX_PARALLEL_CHUNKS = 4" "parallel C-Party uploads"
require_text src/components/CinemaQrScanner.tsx "BarcodeDetector" "in-app C-Party QR scanner"
require_text src/components/call/CallProvider.tsx "export const CallProvider" "unified CallProvider"
require_text src/components/call/CallProvider.tsx "CALL_SCREEN_START" "call screen-share signalling"
require_text src/components/call/CallProvider.tsx "switchCamera" "live camera switching"
require_text src/lib/webrtc.ts "CameraFacingMode" "front/back mobile camera support"
require_text src/components/GlobalCallOverlay.tsx "Перевернуть камеру" "camera flip control"
require_text src/components/GlobalCallOverlay.tsx "Говорит" "speaking indicator UI"
require_text src/App.tsx "<CallProvider>" "global unified call manager mounted"
require_text src/lib/offline.ts "SOCIALBIRD_OFFLINE_V1: client-bootstrap" "offline client bootstrap"
require_text public/sw.js "ITBIRD_PUSH_CALL_OPEN" "push-call action bridge"
require_text src/pages/AndroidApp.tsx "SocialBIRD-Android.apk" "Android stable download page"

echo "[3/10] Applying final wiring"
sudo -u "$APP_USER" node deploy/apply-call-system-v4.mjs
sudo -u "$APP_USER" node deploy/apply-socialbird-final-runtime-v1.mjs
sudo -u "$APP_USER" node deploy/apply-cparty-realtime-end-v1.mjs
sudo -u "$APP_USER" node deploy/apply-cinema-format-normalization-v1.mjs
sudo -u "$APP_USER" node deploy/apply-cinema-existing-normalize-v1.mjs
sudo -u "$APP_USER" node deploy/apply-cinema-upload-compat-v1.mjs

echo "  Verifying patched backend/frontend before build/restart"
node --check backend/socialbird-final-platform.js
node --check backend/admin-cinema-library.js
node --check backend/cinema-transcode-worker.js
node --check backend/server.js
require_text backend/server.js "SOCIALBIRD_FINAL_PLATFORM_V1: early-middleware" "privacy/news middleware"
require_text backend/server.js "SOCIALBIRD_FINAL_PLATFORM_V1: final-routes" "final backend routes"
require_text backend/server.js "SOCIALBIRD_ADMIN_CINEMA_V1: routes" "Admin Cinema routes wired"
require_text backend/socialbird-final-platform.js "SOCIALBIRD_CPARTY_REALTIME_END_V1: server-broadcast" "C-Party realtime room-end broadcast"
require_text backend/admin-cinema-library.js "CPARTY_FORMAT_NORMALIZATION_V1" "C-Party automatic video normalization"
require_text backend/admin-cinema-library.js "CPARTY_EXISTING_NORMALIZE_V1" "existing-library video normalization"
require_text backend/admin-cinema-library.js "CPARTY_UPLOAD_COMPAT_V1" "old Admin Desktop conversion compatibility"
require_text src/components/RealtimeNotifications.tsx "SOCIALBIRD_CALL_SYSTEM_V4: CallProvider owns CALL_* signalling" "legacy call signalling disabled"
require_text src/components/RealtimeNotifications.tsx "SOCIALBIRD_CPARTY_REALTIME_END_V1: websocket-bridge" "C-Party realtime websocket bridge"
require_text src/pages/CinemaPartyRoom.tsx "SOCIALBIRD_CPARTY_REALTIME_END_V1: force-eject" "C-Party force eject on room end"
require_text src/components/call/CallProvider.tsx "itbird-native-call-action" "Android/PWA push answer reaches call manager"
require_text src/App.tsx "<GlobalCallOverlay />" "global call overlay"
require_text src/pages/GroupChats.tsx "messages/all-v2" "creator clear-all UI"
require_text src/pages/Users.tsx "disabled={Boolean(user.restricted || user.profile_restricted)}" "restricted card actions disabled"
require_text src/pages/Settings.tsx "Сменить email с подтверждением" "email change in settings"
require_text src/pages/CinemaParty.tsx "Сканировать QR" "C-Party QR scanner wired"
require_text src/pages/CinemaPartyRoom.tsx "SOCIALBIRD_CPARTY_INVITE_V1: reauth-return" "C-Party invite reauthentication"
require_text src/pages/Login.tsx "navigate(safeReturnTo" "login returns to C-Party invite"

echo "[4/10] Preparing C-Party storage"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 \
  backend/uploads/cinema_chunks backend/uploads/cinema_media \
  backend/uploads/cinema_media/.incoming backend/uploads/cinema_media/.jobs
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y ffmpeg
fi
ffmpeg -version | head -n 1
ffprobe -version | head -n 1
if command -v qrencode >/dev/null 2>&1; then echo "  OK: qrencode available"; else echo "  WARNING: qrencode is not installed; only QR invitation rendering will return 503 until it is installed."; fi

echo "[5/10] Rebuilding hardened backend"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
node --check backend/socialbird-final-platform.js
node --check backend/admin-cinema-library.js
node --check backend/cinema-transcode-worker.js
require_text backend/server.production.js "SOCIALBIRD_FINAL_PLATFORM_V1: final-routes" "final routes in production backend"
require_text backend/server.production.js "SOCIALBIRD_ADMIN_CINEMA_V1: routes" "Admin Cinema routes in production backend"
require_text backend/server.production.js "SOCIALBIRD_CHAT_PLATFORM_V1: resumable-upload-stickers" "Chat Platform v4 preserved"
require_text backend/server.production.js "NATIVE_FCM_PUSH: register-routes" "FCM preserved"
require_text backend/server.production.js "PRODUCTION_HARDENING: sandboxed-compiler-route" "compiler sandbox preserved"

echo "[6/10] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[7/10] Pre-restart checks"
nginx -t
df -h "$APP_DIR"

echo "[8/10] Restarting SocialBIRD API"
RESTARTED=1
cd "$APP_HOME"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 restart socialbird-api
for n in {1..30}; do
  if curl -fsS http://127.0.0.1:5000/native-push/status >/tmp/socialbird-native.json 2>/dev/null; then break; fi
  [[ "$n" -lt 30 ]] || { sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 logs socialbird-api --lines 120 --nostream >&2 || true; false; }
  sleep 1
done

cd "$APP_DIR"
echo "[9/10] Smoke testing final platform"
curl -fsS http://127.0.0.1:5000/socialbird-final/status >/tmp/socialbird-final.json
curl -fsS http://127.0.0.1:5000/register/status >/tmp/socialbird-register.json
curl -fsS http://127.0.0.1:5000/admin/desktop/status >/tmp/socialbird-admin.json
require_text /tmp/socialbird-final.json '"enabled":true' "final platform enabled"
require_text /tmp/socialbird-final.json '"strictPrivacy":true' "strict privacy enabled"
require_text /tmp/socialbird-final.json '"emailChangeVerification":true' "verified email change enabled"
require_text /tmp/socialbird-final.json '"chatFolders":true' "chat folders enabled"
require_text /tmp/socialbird-final.json '"groupOwnerClear":true' "creator clear enabled"
require_text /tmp/socialbird-final.json '"cinemaParty":true' "C-Party enabled"
require_text /tmp/socialbird-native.json '"configured":true' "FCM remains configured"
require_text /tmp/socialbird-register.json '"emailVerification":true' "registration verification remains enabled"
require_text /tmp/socialbird-admin.json '"enabled":true' "Admin Desktop remains enabled"

FOLDERS_CODE="$(curl -sS -o /tmp/folders-auth.json -w '%{http_code}' http://127.0.0.1:5000/chat-folders || true)"
CINEMA_CODE="$(curl -sS -o /tmp/cinema-auth.json -w '%{http_code}' http://127.0.0.1:5000/cinema/rooms || true)"
ADMIN_CINEMA_CODE="$(curl -sS -o /tmp/admin-cinema-auth.json -w '%{http_code}' http://127.0.0.1:5000/admin/desktop/cinema/titles || true)"
[[ "$FOLDERS_CODE" == "401" ]] || { echo "Unexpected /chat-folders status: $FOLDERS_CODE" >&2; false; }
[[ "$CINEMA_CODE" == "401" ]] || { echo "Unexpected /cinema/rooms status: $CINEMA_CODE" >&2; false; }
[[ "$ADMIN_CINEMA_CODE" == "401" ]] || { echo "Unexpected Admin Cinema status: $ADMIN_CINEMA_CODE" >&2; false; }
echo "  OK: Admin Cinema API requires desktop admin session"

echo "[10/10] Saving stable PM2 state"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
df -h "$APP_DIR"
trap - ERR
chown -R "$APP_USER:$APP_USER" backend src public dist 2>/dev/null || true

echo
echo "SocialBIRD final platform deployed successfully."
echo "Included: unified Call System V4 (voice/video, persistent overlay, speaking indicator, camera flip, mobile screen share and push-answer bridge), strict profiles, chat folders, verified email change, creator-only group clear, C-Party QR/invite, realtime room end, faster uploads, browser-compatible video normalization, offline cache and Android download page."
echo "Backup: $BACKUP_DIR"

#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
SOURCE="$APP_DIR/deploy/update-socialbird-final-platform.sh"
TMP="$(mktemp /tmp/socialbird-final-no-disk-guard.XXXXXX.sh)"
TMP2="$(mktemp /tmp/socialbird-final-unrestricted.XXXXXX.sh)"
trap 'rm -f "$TMP" "$TMP2"' EXIT

[[ ${EUID} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
cd "$APP_DIR"
[[ -f "$SOURCE" ]] || { echo "Missing $SOURCE" >&2; exit 1; }

# Refresh only optional patchers before the generated deploy. Application files are
# deliberately fetched AFTER the regular updater has created its rollback backup.
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  deploy/apply-call-system-v5.mjs \
  deploy/apply-call-system-v5-push-state-fix.mjs \
  deploy/apply-call-system-v6-video-track.mjs \
  deploy/apply-call-system-v7-remote-video.mjs \
  deploy/apply-call-system-v8-camera-transport.mjs \
  deploy/apply-chat-expression-picker-v1.mjs \
  deploy/apply-cinema-unrestricted-storage.mjs \
  deploy/apply-cinema-format-normalization-v1.mjs \
  deploy/apply-cinema-existing-normalize-v1.mjs \
  deploy/apply-cinema-upload-compat-v1.mjs \
  deploy/apply-cparty-session-media-change-v1.mjs \
  deploy/apply-cparty-participant-media-reload-v2.mjs \
  backend/cinema-transcode-worker.js
node --check deploy/apply-call-system-v5.mjs
node --check deploy/apply-call-system-v5-push-state-fix.mjs
node --check deploy/apply-call-system-v6-video-track.mjs
node --check deploy/apply-call-system-v7-remote-video.mjs
node --check deploy/apply-call-system-v8-camera-transport.mjs
node --check deploy/apply-chat-expression-picker-v1.mjs
node --check deploy/apply-cinema-unrestricted-storage.mjs
node --check deploy/apply-cinema-format-normalization-v1.mjs
node --check deploy/apply-cinema-existing-normalize-v1.mjs
node --check deploy/apply-cinema-upload-compat-v1.mjs
node --check deploy/apply-cparty-session-media-change-v1.mjs
node --check deploy/apply-cparty-participant-media-reload-v2.mjs
node --check backend/cinema-transcode-worker.js

# SOCIALBIRD_UNRESTRICTED_DEPLOY_V15
# Remove only the artificial pre-deploy free-space gate. Backup, rollback, syntax
# checks, frontend build, nginx, PM2 and smoke tests remain enabled.
awk '
BEGIN { skipping=0 }
/^MIN_FREE_KB=/ { next }
/^FREE_KB="\$\(df -Pk / { skipping=1; next }
skipping && /^fi$/ { skipping=0; next }
skipping { next }
{ print }
' "$SOURCE" > "$TMP"

# Extend the regular rollback set with files introduced after the original final updater.
# They are fetched only after backup creation so a failed build can restore the live source.
awk '
/^BACKUP_FILES=\(/ {
  print
  print "  backend/offline-call-queue.js backend/stickers.js"
  print "  src/components/call/NativeCallAudioBridge.tsx src/components/call/PushCallDeepLinkBridge.tsx"
  print "  src/components/ChatExpressionPicker.tsx src/components/StickerBubble.tsx src/lib/stickers.ts src/pages/Chats.tsx"
  next
}
/^echo "\[2\/10\] Checking modules"/ {
  print "sudo -u \"$APP_USER\" git checkout \"origin/$BRANCH\" -- backend/server.js backend/offline-call-queue.js backend/stickers.js src/components/call/NativeCallAudioBridge.tsx src/components/call/PushCallDeepLinkBridge.tsx src/components/ChatExpressionPicker.tsx src/components/StickerBubble.tsx src/lib/stickers.ts src/pages/Chats.tsx src/pages/GroupChats.tsx public/stickers"
  print "test -s backend/offline-call-queue.js"
  print "test -s backend/stickers.js"
  print "test -s src/components/call/NativeCallAudioBridge.tsx"
  print "test -s src/components/call/PushCallDeepLinkBridge.tsx"
  print "test -s src/components/ChatExpressionPicker.tsx"
  print "test -s src/components/StickerBubble.tsx"
  print "test -s src/lib/stickers.ts"
  print "node --check backend/offline-call-queue.js"
  print "node --check backend/stickers.js"
  print "if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then"
  print "  export DEBIAN_FRONTEND=noninteractive"
  print "  apt-get update -qq"
  print "  apt-get install -y ffmpeg"
  print "fi"
  print "ffmpeg -version | head -n 1"
  print "ffprobe -version | head -n 1"
  print "sudo -u \"$APP_USER\" node deploy/apply-cinema-format-normalization-v1.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-cinema-existing-normalize-v1.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-cinema-upload-compat-v1.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-cinema-unrestricted-storage.mjs"
  print "node --check backend/admin-cinema-library.js"
  print "node --check backend/cinema-transcode-worker.js"
}
/sudo -u "\$APP_USER" node deploy\/apply-call-system-v4\.mjs/ {
  print
  print "sudo -u \"$APP_USER\" node deploy/apply-call-system-v5.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-call-system-v5-push-state-fix.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-call-system-v6-video-track.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-call-system-v7-remote-video.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-call-system-v8-camera-transport.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-chat-expression-picker-v1.mjs"
  print "grep -q \"SOCIALBIRD_CALL_SYSTEM_V5: defer-answer-until-ready\" src/components/call/CallProvider.tsx"
  print "grep -q \"SOCIALBIRD_CALL_SYSTEM_V5: real-webrtc-connected-state\" src/components/call/CallProvider.tsx"
  print "grep -q \"SOCIALBIRD_CALL_SYSTEM_V5: camera-renegotiation\" src/components/call/CallProvider.tsx"
  print "grep -q \"SOCIALBIRD_CALL_SYSTEM_V5: participant-volume-slider\" src/components/GlobalCallOverlay.tsx"
  print "grep -q \"SOCIALBIRD_CALL_SYSTEM_V6: real-camera-sender\" src/components/call/CallProvider.tsx"
  print "grep -q \"SOCIALBIRD_CALL_SYSTEM_V7: receiver-reconciliation\" src/components/call/CallProvider.tsx"
  print "grep -q \"SOCIALBIRD_CALL_SYSTEM_V8: dedicated-camera-transport\" src/components/call/CallProvider.tsx"
  print "grep -q \"CALL_VIDEO_OFFER\" src/components/call/CallProvider.tsx"
  print "grep -q \"SOCIALBIRD_CHAT_EXPRESSION_V1: portal-trigger\" src/pages/Chats.tsx"
  print "grep -q \"SOCIALBIRD_CHAT_EXPRESSION_V1: portal-trigger\" src/pages/GroupChats.tsx"
  print "grep -q \"data-chat-expression-picker=\\\"true\\\"\" src/components/ChatExpressionPicker.tsx"
  print "grep -q \"SOCIALBIRD_CHAT_EXPRESSION_V1: sticker-routes\" backend/server.js"
  next
}
/sudo -u "\$APP_USER" node deploy\/apply-cparty-realtime-end-v1\.mjs/ {
  print
  print "sudo -u \"$APP_USER\" node deploy/apply-cparty-session-media-change-v1.mjs"
  print "sudo -u \"$APP_USER\" node deploy/apply-cparty-participant-media-reload-v2.mjs"
  next
}
{ print }
' "$TMP" > "$TMP2"

chmod 700 "$TMP2"
bash -n "$TMP2"

echo "Artificial disk preflight limit disabled."
echo "C-Party upload size/reserve limits disabled by default."
echo "C-Party browser video normalization enabled (FFmpeg/FFprobe)."
echo "Existing incompatible C-Party media can be normalized without re-upload."
echo "Older Admin Desktop clients remain upload-compatible during background conversion."
echo "C-Party custom-upload rooms can switch video during an active session."
echo "C-Party participants force-reload the new media source in realtime and via polling fallback."
echo "Unified Call System V5 enabled: reliable push-answer, real connected-state, video inside voice calls, camera resync and per-user volume."
echo "Call System V6 enabled: real camera addTrack/removeTrack negotiation and remote video unmute recovery."
echo "Call System V7 enabled: desktop receiver reconciliation, dedicated remote camera streams and automatic camera resync watchdog."
echo "Call System V8 enabled: camera uses an independent one-way WebRTC transport per participant."
echo "Chat expression picker enabled: emoji and stickers render through a body portal on desktop and mobile."
echo "Call/chat migration files are included in backup/rollback."
echo "SocialBIRD offline shell/static/private-API cache support enabled."
df -h "$APP_DIR" || true
exec bash "$TMP2"

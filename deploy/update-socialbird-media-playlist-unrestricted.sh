#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BRANCH="deploy/socialbird-vps-production"
BACKUP_ROOT="/var/backups/socialbird"
BACKUP_DIR="$BACKUP_ROOT/media-playlist-$(date +%Y%m%d-%H%M%S)"
NGINX_LINK="/etc/nginx/sites-enabled/socialbird"
NGINX_TARGET=""
RESTARTED=0
NGINX_CHANGED=0

[[ ${EUID} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"

FILES=(
  backend/server.js
  backend/server.production.js
  backend/socialbird-final-platform.js
  backend/cinema-stream.js
  backend/admin-cinema-library.js
  backend/strict-privacy-gate.js
  backend/stable-news-time.js
  src/pages/Chats.tsx
  src/pages/GroupChats.tsx
  src/pages/CinemaPartyRoom.tsx
  src/components/CinemaPlaylistPanel.tsx
  deploy/nginx-socialbird.conf.template
)

for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp -a "$f" "$BACKUP_DIR/$f"
    printf '%s\n' "$f" >> "$BACKUP_DIR/present-files.txt"
  fi
done
if [[ -d dist ]]; then
  cp -al dist "$BACKUP_DIR/dist"
fi

if [[ -e "$NGINX_LINK" ]]; then
  NGINX_TARGET="$(readlink -f "$NGINX_LINK")"
  [[ -n "$NGINX_TARGET" && -f "$NGINX_TARGET" ]] || { echo "Cannot resolve active SocialBIRD nginx config" >&2; exit 1; }
  cp -a "$NGINX_TARGET" "$BACKUP_DIR/nginx-socialbird.active.conf"
fi

rollback() {
  echo "Media/playlist deploy failed; restoring previous production state..." >&2
  cd "$APP_DIR"
  for f in "${FILES[@]}"; do
    rm -f "$f"
    if [[ -f "$BACKUP_DIR/$f" ]]; then
      mkdir -p "$(dirname "$f")"
      cp -a "$BACKUP_DIR/$f" "$f"
    fi
  done
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -al "$BACKUP_DIR/dist" dist
  fi
  if [[ "$NGINX_CHANGED" -eq 1 && -n "$NGINX_TARGET" && -f "$BACKUP_DIR/nginx-socialbird.active.conf" ]]; then
    cp -a "$BACKUP_DIR/nginx-socialbird.active.conf" "$NGINX_TARGET"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
  fi
  chown -R "$APP_USER:$APP_USER" backend src dist 2>/dev/null || true
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

echo "[1/9] Fetching verified media/playlist source"
sudo -u "$APP_USER" git fetch origin +"$BRANCH:refs/remotes/origin/$BRANCH"
REMOTE_HEAD="$(sudo -u "$APP_USER" git rev-parse "refs/remotes/origin/$BRANCH")"
echo "Remote HEAD: $REMOTE_HEAD"

# Restore the current canonical production source first, then apply only the new
# media/playlist transformations. This avoids stacking old call migrations over V8.
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  backend/server.js backend/socialbird-final-platform.js backend/cinema-stream.js \
  backend/admin-cinema-library.js backend/strict-privacy-gate.js backend/stable-news-time.js \
  src/pages/Chats.tsx src/pages/GroupChats.tsx src/pages/CinemaPartyRoom.tsx \
  src/components/CinemaPlaylistPanel.tsx \
  deploy/nginx-socialbird.conf.template \
  deploy/apply-chat-media-mobile-fix.mjs deploy/apply-chat-media-backend-fix.mjs \
  deploy/apply-chat-multi-upload-unlimited-video-v1.mjs \
  deploy/apply-cinema-unrestricted-storage.mjs \
  deploy/apply-cparty-playlist-v1.mjs deploy/apply-cparty-playlist-autoplay-v1.mjs \
  deploy/apply-final-backend-wiring-v1.mjs \
  deploy/harden-source.mjs deploy/enable-sandbox-compiler.mjs

node --check deploy/apply-chat-multi-upload-unlimited-video-v1.mjs
node --check deploy/apply-cparty-playlist-v1.mjs
node --check deploy/apply-cparty-playlist-autoplay-v1.mjs

sudo -u "$APP_USER" node deploy/apply-chat-media-mobile-fix.mjs
sudo -u "$APP_USER" node deploy/apply-chat-media-backend-fix.mjs
sudo -u "$APP_USER" node deploy/apply-chat-multi-upload-unlimited-video-v1.mjs
sudo -u "$APP_USER" node deploy/apply-cinema-unrestricted-storage.mjs
sudo -u "$APP_USER" node deploy/apply-cparty-playlist-v1.mjs
sudo -u "$APP_USER" node deploy/apply-cparty-playlist-autoplay-v1.mjs
sudo -u "$APP_USER" node deploy/apply-final-backend-wiring-v1.mjs

echo "[2/9] Verifying chat multi-upload and unrestricted video"
node --check backend/server.js
require_text src/pages/Chats.tsx "SOCIALBIRD_CHAT_MULTI_UPLOAD_V1: personal" "personal chat multi-file queue"
require_text src/pages/GroupChats.tsx "SOCIALBIRD_CHAT_MULTI_UPLOAD_V1: group" "group chat multi-file queue"
require_text src/pages/Chats.tsx "CHAT_UPLOAD_PARALLELISM = 3" "personal parallel upload workers"
require_text src/pages/GroupChats.tsx "CHAT_UPLOAD_PARALLELISM = 3" "group parallel upload workers"
require_text src/pages/Chats.tsx "multiple" "personal multiple file selector"
require_text src/pages/GroupChats.tsx "multiple" "group multiple file selector"
require_text backend/server.js "SOCIALBIRD_CHAT_MULTI_UPLOAD_V1: unlimited-video-backend" "chat video backend has no Multer size cap"
require_text backend/server.js "chatUpload.single('media')" "dedicated chat upload middleware"
require_text deploy/nginx-socialbird.conf.template "SOCIALBIRD_CHAT_MULTI_UPLOAD_V1: unlimited-video-api-body" "nginx API template has unrestricted request body"

echo "[3/9] Verifying C-Party playlist queue"
node --check backend/socialbird-final-platform.js
require_text backend/socialbird-final-platform.js "CPARTY_UNRESTRICTED_STORAGE_V1" "C-Party unrestricted storage preserved"
require_text backend/socialbird-final-platform.js "SOCIALBIRD_CPARTY_PLAYLIST_V1: persistent-queue" "persistent playlist schema and routes"
require_text backend/socialbird-final-platform.js "SOCIALBIRD_CPARTY_PLAYLIST_AUTOPLAY_V1: backend" "automatic next-video backend state"
require_text backend/socialbird-final-platform.js "/cinema/rooms/:id/playlist/next" "playlist next endpoint"
require_text src/pages/CinemaPartyRoom.tsx "SOCIALBIRD_CPARTY_PLAYLIST_V1: room-player" "room playlist player wiring"
require_text src/pages/CinemaPartyRoom.tsx "SOCIALBIRD_CPARTY_PLAYLIST_AUTOPLAY_V1: frontend" "room auto-play next item wiring"
require_text src/components/CinemaPlaylistPanel.tsx "Создать плейлист" "create playlist button"
require_text src/components/CinemaPlaylistPanel.tsx "Добавить видео" "add video inside existing room"
require_text src/components/CinemaPlaylistPanel.tsx "multiple" "multiple C-Party video selection"
require_text backend/server.js "SOCIALBIRD_FINAL_PLATFORM_V1: final-routes" "final platform wiring preserved"
require_text backend/server.js "SOCIALBIRD_ADMIN_CINEMA_V1: routes" "Admin Cinema wiring preserved"
require_text backend/server.js "NATIVE_FCM_PUSH" "FCM wiring preserved"

echo "[4/9] Removing active Nginx API upload body cap"
[[ -n "$NGINX_TARGET" ]] || { echo "Active SocialBIRD nginx config not found at $NGINX_LINK" >&2; false; }
python3 - "$NGINX_TARGET" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
needle = "server_name api.socialbird.ru;"
pos = text.find(needle)
if pos < 0:
    raise SystemExit("api.socialbird.ru server block not found in active nginx config")

start = text.rfind("server {", 0, pos)
if start < 0:
    raise SystemExit("start of api.socialbird.ru server block not found")

depth = 0
end = None
for i in range(start, len(text)):
    ch = text[i]
    if ch == "{":
        depth += 1
    elif ch == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break
if end is None:
    raise SystemExit("end of api.socialbird.ru server block not found")

block = text[start:end]
limit_re = re.compile(r"(?m)^(\s*)client_max_body_size\s+[^;]+;\s*$")
if limit_re.search(block):
    block = limit_re.sub(lambda m: f"{m.group(1)}client_max_body_size 0;", block, count=1)
else:
    block = block.replace(needle, needle + "\n    client_max_body_size 0;", 1)

updated = text[:start] + block + text[end:]
path.write_text(updated)
PY
NGINX_CHANGED=1
require_text "$NGINX_TARGET" "server_name api.socialbird.ru;" "API nginx server found"
# Validate that the api server block specifically contains client_max_body_size 0.
python3 - "$NGINX_TARGET" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text()
pos = text.find('server_name api.socialbird.ru;')
start = text.rfind('server {', 0, pos)
depth = 0
end = None
for i in range(start, len(text)):
    if text[i] == '{': depth += 1
    elif text[i] == '}':
        depth -= 1
        if depth == 0:
            end = i + 1
            break
block = text[start:end]
if 'client_max_body_size 0;' not in block:
    raise SystemExit('api.socialbird.ru still has a request body limit')
print('  OK: active API nginx body size is unrestricted')
PY
nginx -t
systemctl reload nginx

echo "[5/9] Rebuilding hardened backend"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js
require_text backend/server.production.js "SOCIALBIRD_CHAT_MULTI_UPLOAD_V1: unlimited-video-backend" "unrestricted chat video transport in production backend"
require_text backend/server.production.js "SOCIALBIRD_FINAL_PLATFORM_V1: final-routes" "final platform routes in production backend"
require_text backend/server.production.js "SOCIALBIRD_ADMIN_CINEMA_V1: routes" "Admin Cinema in production backend"
require_text backend/server.production.js "NATIVE_FCM_PUSH" "FCM in production backend"
require_text backend/server.production.js "PRODUCTION_HARDENING: sandboxed-compiler-route" "compiler sandbox preserved"

echo "[6/9] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .

echo "[7/9] Restarting SocialBIRD API"
RESTARTED=1
cd "$APP_HOME"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 restart socialbird-api
for n in {1..30}; do
  if curl -fsS http://127.0.0.1:5000/native-push/status >/tmp/socialbird-media-native.json 2>/dev/null; then break; fi
  [[ "$n" -lt 30 ]] || {
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 logs socialbird-api --lines 120 --nostream >&2 || true
    false
  }
  sleep 1
done

cd "$APP_DIR"
echo "[8/9] Smoke testing platform and playlist schema"
curl -fsS http://127.0.0.1:5000/socialbird-final/status >/tmp/socialbird-media-final.json
require_text /tmp/socialbird-media-final.json '"enabled":true' "final platform enabled"
require_text /tmp/socialbird-media-final.json '"cinemaParty":true' "C-Party remains enabled"
require_text /tmp/socialbird-media-final.json '"cinemaPlaylistQueue":true' "C-Party playlist capability enabled and schema initialized"
require_text /tmp/socialbird-media-native.json '"configured":true' "FCM remains configured"

CHAT_CODE="$(curl -sS -o /tmp/socialbird-media-chat.json -w '%{http_code}' -X POST http://127.0.0.1:5000/messages/upload || true)"
[[ "$CHAT_CODE" == "401" || "$CHAT_CODE" == "403" ]] || { echo "Unexpected unauthenticated chat upload status: $CHAT_CODE" >&2; false; }
echo "  OK: personal chat upload route mounted and protected"
GROUP_CODE="$(curl -sS -o /tmp/socialbird-media-group.json -w '%{http_code}' -X POST http://127.0.0.1:5000/group-chats/0/upload || true)"
[[ "$GROUP_CODE" == "401" || "$GROUP_CODE" == "403" ]] || { echo "Unexpected unauthenticated group upload status: $GROUP_CODE" >&2; false; }
echo "  OK: group chat upload route mounted and protected"
PUBLIC_CODE="$(curl -sS -o /dev/null -w '%{http_code}' https://socialbird.ru || true)"
[[ "$PUBLIC_CODE" =~ ^(200|301|302)$ ]] || { echo "Unexpected public site status: $PUBLIC_CODE" >&2; false; }
echo "  OK: public site responds ($PUBLIC_CODE)"

echo "[9/9] Saving PM2 state"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
chown -R "$APP_USER:$APP_USER" backend src dist 2>/dev/null || true
trap - ERR

echo
echo "SocialBIRD chat multi-upload + unrestricted video + C-Party playlist deployed successfully."
echo "Included: multi-file chat selection, three concurrent upload workers, unlimited video upload size, persistent C-Party playlist and automatic next-video playback."
echo "Preserved: Call V8, emoji/stickers, final platform routes, C-Party unrestricted storage, Admin Cinema, FCM and compiler sandbox."
echo "Backup: $BACKUP_DIR"

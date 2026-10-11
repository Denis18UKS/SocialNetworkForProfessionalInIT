#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BRANCH="fix/cparty-own-video-normalization-installer-20261011"
BACKUP_DIR="/var/backups/socialbird/cparty-own-video-$(date +%Y%m%d-%H%M%S)"
RESTARTED=0
FILES="backend/socialbird-final-platform.js backend/cinema-transcode-worker.js backend/cinema-media-codecs.js src/lib/cinema-upload.ts src/pages/CinemaParty.tsx tests/cparty-own-video-normalization.test.mjs"

[[ $EUID -eq 0 ]] || { echo "Запусти установщик от root." >&2; exit 1; }
cd "$APP_DIR"

AVAILABLE_BYTES="$(df -PB1 "$APP_DIR" | awk 'NR == 2 { print $4 }')"
if [[ ! "$AVAILABLE_BYTES" =~ ^[0-9]+$ ]] || (( AVAILABLE_BYTES < 2147483648 )); then
  echo "Недостаточно свободного места. Нужно минимум 2 GiB; сначала освободи место на диске." >&2
  df -h /
  exit 1
fi

install -d -o root -g root -m 0750 "$BACKUP_DIR"
for file in $FILES; do
  if [[ -f "$file" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$file")"
    cp -a "$file" "$BACKUP_DIR/$file"
    printf '%s\n' "$file" >> "$BACKUP_DIR/present-files.txt"
  fi
done
if [[ -d dist ]]; then cp -al dist "$BACKUP_DIR/dist"; fi

rollback() {
  echo "Установка не прошла; возвращаю исходные файлы..." >&2
  cd "$APP_DIR"
  for file in $FILES; do
    rm -f "$file"
    if grep -Fxq "$file" "$BACKUP_DIR/present-files.txt" 2>/dev/null; then
      mkdir -p "$(dirname "$file")"
      cp -a "$BACKUP_DIR/$file" "$file"
    fi
  done
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -al "$BACKUP_DIR/dist" dist
  fi
  chown -R "$APP_USER:$APP_USER" backend src dist tests 2>/dev/null || true
  if [[ "$RESTARTED" -eq 1 ]]; then
    cd "$APP_HOME"
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 restart socialbird-api >/dev/null 2>&1 || true
  fi
  echo "Rollback-резервная копия: $BACKUP_DIR" >&2
}
trap rollback ERR

require_text() {
  grep -Fq -- "$2" "$1" || { echo "Проверка не пройдена: $3" >&2; return 1; }
  echo "  OK: $3"
}

echo "[1/7] Проверка FFmpeg и свободного места"
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo "FFmpeg не найден; устанавливаю системный пакет ffmpeg..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg
fi
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
ffmpeg -version 2>&1 | sed -n '1p'
df -h /

echo "[2/7] Получение проверенной версии исходников"
sudo -u "$APP_USER" git fetch origin +"$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  backend/socialbird-final-platform.js \
  backend/cinema-transcode-worker.js \
  backend/cinema-media-codecs.js \
  src/lib/cinema-upload.ts \
  src/pages/CinemaParty.tsx \
  tests/cparty-own-video-normalization.test.mjs

echo "[3/7] Проверка backend и регрессионные тесты"
node --check backend/socialbird-final-platform.js
node --check backend/cinema-transcode-worker.js
node --check backend/cinema-media-codecs.js
sudo -u "$APP_USER" node --test tests/cparty-own-video-normalization.test.mjs
require_text backend/socialbird-final-platform.js "SOCIALBIRD_CPARTY_OWN_VIDEO_NORMALIZATION_V1: async-codec-normalization" "async C-Party transcode status route"
require_text backend/cinema-transcode-worker.js "planCinemaMediaConversion" "browser codec compatibility plan"
require_text src/lib/cinema-upload.ts "statusUrl" "frontend waits for server-side media preparation"

echo "[4/7] Сборка frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
find dist/assets -maxdepth 1 -type f -name '*.js' -size +1k | grep -q .
echo "  OK: frontend build completed"

echo "[5/7] Перезапуск backend"
RESTARTED=1
cd "$APP_HOME"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 restart socialbird-api
for n in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:5000/native-push/status >/tmp/socialbird-cparty-native.json 2>/dev/null; then break; fi
  if [[ "$n" -eq 30 ]]; then
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 logs socialbird-api --lines 100 --nostream >&2 || true
    false
  fi
  sleep 1
done

cd "$APP_DIR"
echo "[6/7] Проверка production endpoints"
curl -fsS http://127.0.0.1:5000/socialbird-final/status >/tmp/socialbird-cparty-final.json
require_text /tmp/socialbird-cparty-native.json '"configured":true' "FCM remains configured"
require_text /tmp/socialbird-cparty-final.json '"cinemaParty":true' "C-Party remains enabled"
STATUS_CODE="$(curl --max-time 5 -sS -o /tmp/socialbird-cparty-transcode-status.json -w '%{http_code}' http://127.0.0.1:5000/cinema/uploads/transcode/not-a-uuid || true)"
[[ "$STATUS_CODE" == "401" || "$STATUS_CODE" == "403" ]] || {
  echo "Unexpected unauthenticated transcode status endpoint: HTTP $STATUS_CODE" >&2
  cat /tmp/socialbird-cparty-transcode-status.json >&2 || true
  false
}
echo "  OK: transcode status endpoint is mounted and requires login ($STATUS_CODE)"

echo "[7/7] Saving PM2 state"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
rm -f /tmp/socialbird-cparty-native.json /tmp/socialbird-cparty-final.json /tmp/socialbird-cparty-transcode-status.json
chown -R "$APP_USER:$APP_USER" backend src dist tests 2>/dev/null || true
trap - ERR

echo
echo "SocialBIRD C-Party own-video playback patch deployed successfully."
echo "Compatible MP4 remains untouched; compatible H.264/AAC videos in other containers are remuxed; incompatible codecs are converted to browser-compatible MP4 H.264/AAC."
echo "No new upload-size cap was introduced. User uploads, database and C-Party media library were not deleted."
echo "Backup: $BACKUP_DIR"

#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_GROUP="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
ENV_FILE="/etc/socialbird/backend.env"
TARGET="/etc/socialbird/firebase-service-account.json"
SOURCE="${1:-}"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

if [[ -z "$SOURCE" || ! -f "$SOURCE" ]]; then
  echo "Usage: bash deploy/configure-fcm-server.sh /path/to/firebase-service-account.json" >&2
  echo "Do not paste the service-account JSON into chat or a shell command." >&2
  exit 2
fi

PROJECT_ID="$(node -e 'const fs=require("fs"); const p=process.argv[1]; const j=JSON.parse(fs.readFileSync(p,"utf8")); if(!j.project_id||!j.client_email||!j.private_key){process.exit(3)}; process.stdout.write(j.project_id)' "$SOURCE")" || {
  echo "The JSON is not a Firebase/Google service account with project_id, client_email and private_key." >&2
  exit 3
}

install -d -o root -g "$APP_GROUP" -m 0750 /etc/socialbird
if [[ -f "$TARGET" ]]; then
  cp -a "$TARGET" "${TARGET}.backup-$(date +%Y%m%d-%H%M%S)"
fi
install -o root -g "$APP_GROUP" -m 0640 "$SOURCE" "$TARGET"

if grep -q '^FCM_SERVICE_ACCOUNT_FILE=' "$ENV_FILE"; then
  sed -i "s|^FCM_SERVICE_ACCOUNT_FILE=.*|FCM_SERVICE_ACCOUNT_FILE=${TARGET}|" "$ENV_FILE"
else
  printf '\nFCM_SERVICE_ACCOUNT_FILE=%s\n' "$TARGET" >> "$ENV_FILE"
fi
chmod 0640 "$ENV_FILE"
chown root:"$APP_GROUP" "$ENV_FILE"

cd "$APP_HOME"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save

for attempt in {1..25}; do
  if ss -lnt | grep -q '127.0.0.1:5000'; then break; fi
  if [[ "$attempt" -eq 25 ]]; then
    echo "SocialBIRD API did not return on port 5000." >&2
    exit 4
  fi
  sleep 1
done

STATUS="$(curl -fsS http://127.0.0.1:5000/native-push/status)"
if ! grep -q '"configured":true' <<<"$STATUS"; then
  echo "FCM backend did not report configured=true." >&2
  echo "$STATUS" >&2
  exit 5
fi

echo "Firebase Cloud Messaging server transport is configured."
echo "Project: $PROJECT_ID"
echo "Service-account private key was stored only at $TARGET and was not printed."

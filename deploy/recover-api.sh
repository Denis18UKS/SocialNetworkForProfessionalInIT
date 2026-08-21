#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
ENV_DIR="/etc/socialbird"
ENV_FILE="${ENV_DIR}/backend.env"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

cd "$APP_DIR"

install -d -o root -g socialbird -m 0750 "$ENV_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
chown root:socialbird "$ENV_FILE"
chmod 0640 "$ENV_FILE"

if ! sudo -u "$APP_USER" test -r "$ENV_FILE"; then
  echo "User $APP_USER cannot read $ENV_FILE" >&2
  exit 1
fi

echo "[1/6] Checking source syntax"
node --check backend/server.js
node --check ecosystem.config.cjs

echo "[2/6] Rebuilding production backend"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js

echo "[3/6] Restarting PM2 app"
cd /var/lib/socialbird
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save

echo "[4/6] Waiting for 127.0.0.1:5000"
for attempt in {1..20}; do
  if curl -fsS --max-time 2 http://127.0.0.1:5000/ >/dev/null 2>&1 || ss -lnt | grep -q '127.0.0.1:5000'; then
    break
  fi
  if [[ "$attempt" -eq 20 ]]; then
    echo "API did not start. Recent PM2/error logs:" >&2
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status || true
    tail -n 150 /var/log/socialbird/api-error.log 2>/dev/null || true
    tail -n 80 /var/log/socialbird/api-output.log 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

echo "[5/6] Checking CORS preflight locally"
FRONTEND_ORIGIN="$(grep -E '^FRONTEND_URL=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r' | sed 's/^\"//;s/\"$//')"
if [[ -z "$FRONTEND_ORIGIN" ]]; then
  FRONTEND_ORIGIN="https://socialbird.31.207.74.138.nip.io"
fi
curl -i -sS -X OPTIONS http://127.0.0.1:5000/login \
  -H "Origin: $FRONTEND_ORIGIN" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' | sed -n '1,25p'

echo "[6/6] Reloading nginx"
nginx -t
systemctl reload nginx

echo
echo "API recovery completed."
ss -lntp | grep ':5000' || true
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status

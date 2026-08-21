#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
BRANCH="deploy/socialbird-vps-production"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BACKUP_DIR="/var/backups/socialbird/mail-recovery-$(date +%Y%m%d-%H%M%S)"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

backup_file() {
  local source="$1"
  local name="$2"
  [[ -e "$source" ]] && cp -a "$source" "$BACKUP_DIR/$name"
}

backup_file "$APP_DIR/backend/server.js" server.js
backup_file "$APP_DIR/backend/server.production.js" server.production.js
backup_file "$APP_DIR/backend/password-recovery.js" password-recovery.js
backup_file "$APP_DIR/src/pages/Login.tsx" Login.tsx
backup_file "$APP_DIR/src/components/PasswordRecovery.tsx" PasswordRecovery.tsx
backup_file "$APP_DIR/deploy/install.sh" install.sh
backup_file /etc/socialbird/backend.env backend.env
if [[ -d "$APP_DIR/dist" ]]; then cp -a "$APP_DIR/dist" "$BACKUP_DIR/dist"; fi

rollback() {
  echo "Mail recovery update failed; restoring previous live version..." >&2
  [[ -f "$BACKUP_DIR/server.js" ]] && cp -a "$BACKUP_DIR/server.js" "$APP_DIR/backend/server.js"
  [[ -f "$BACKUP_DIR/server.production.js" ]] && cp -a "$BACKUP_DIR/server.production.js" "$APP_DIR/backend/server.production.js"
  [[ -f "$BACKUP_DIR/password-recovery.js" ]] && cp -a "$BACKUP_DIR/password-recovery.js" "$APP_DIR/backend/password-recovery.js"
  [[ -f "$BACKUP_DIR/Login.tsx" ]] && cp -a "$BACKUP_DIR/Login.tsx" "$APP_DIR/src/pages/Login.tsx"
  [[ -f "$BACKUP_DIR/PasswordRecovery.tsx" ]] && cp -a "$BACKUP_DIR/PasswordRecovery.tsx" "$APP_DIR/src/components/PasswordRecovery.tsx"
  [[ -f "$BACKUP_DIR/install.sh" ]] && cp -a "$BACKUP_DIR/install.sh" "$APP_DIR/deploy/install.sh"
  [[ -f "$BACKUP_DIR/backend.env" ]] && cp -a "$BACKUP_DIR/backend.env" /etc/socialbird/backend.env
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf "$APP_DIR/dist"
    cp -a "$BACKUP_DIR/dist" "$APP_DIR/dist"
  fi
  chown -R socialbird:socialbird "$APP_DIR/src" 2>/dev/null || true
  chown socialbird:socialbird "$APP_DIR/backend/server.js" "$APP_DIR/backend/server.production.js" "$APP_DIR/backend/password-recovery.js" 2>/dev/null || true
  chown root:socialbird /etc/socialbird/backend.env 2>/dev/null || true
  chmod 0640 /etc/socialbird/backend.env 2>/dev/null || true
  (
    cd /var/lib/socialbird
    sudo -u socialbird env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
    sudo -u socialbird env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs" >/dev/null 2>&1 || true
    sudo -u socialbird env PM2_HOME="$PM2_HOME_DIR" pm2 save >/dev/null 2>&1 || true
  )
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

echo "[1/8] Fetching production branch"
sudo -u "$APP_USER" git fetch origin "$BRANCH"

echo "[2/8] Loading mail recovery files"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  backend/password-recovery.js \
  src/components/PasswordRecovery.tsx \
  deploy/apply-mail-recovery-fixes.mjs \
  deploy/configure-mail.sh \
  deploy/generate-owner-recovery-codes.mjs \
  deploy/update-mail-recovery.sh

echo "[3/8] Applying source fixes"
node --check deploy/apply-mail-recovery-fixes.mjs
node --check backend/password-recovery.js
node --check deploy/generate-owner-recovery-codes.mjs
bash -n deploy/configure-mail.sh
sudo -u "$APP_USER" node deploy/apply-mail-recovery-fixes.mjs

grep -q "MAIL_RECOVERY: secure-reset-routes" backend/server.js
grep -q "PasswordRecovery" src/pages/Login.tsx

echo "[4/8] Rebuilding hardened backend"
sudo -u "$APP_USER" node deploy/harden-source.mjs
sudo -u "$APP_USER" node deploy/enable-sandbox-compiler.mjs
node --check backend/server.production.js

echo "[5/8] Building frontend"
sudo -u "$APP_USER" npm run build
test -s dist/index.html

echo "[6/8] Restarting API"
(
  cd /var/lib/socialbird
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
)

for attempt in {1..20}; do
  if ss -lnt | grep -q '127.0.0.1:5000'; then
    break
  fi
  if [[ "$attempt" -eq 20 ]]; then
    echo "API did not return on port 5000." >&2
    tail -n 120 /var/log/socialbird/api-error.log 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

echo "[7/8] Checking recovery API"
STATUS="$(curl -fsS http://127.0.0.1:5000/password-reset/mail-status)"
printf '%s\n' "$STATUS"
printf '%s' "$STATUS" | grep -q 'configured'

echo "[8/8] Final status"
sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 status
ss -lntp | grep ':5000'

trap - ERR
echo
echo "Mail recovery update completed."
echo "Backup: $BACKUP_DIR"
echo "Next: run 'bash $APP_DIR/deploy/configure-mail.sh' to configure SMTP."
echo "Then generate owner backup codes with: node $APP_DIR/deploy/generate-owner-recovery-codes.mjs OWNER_EMAIL"

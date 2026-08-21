#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
ENV_FILE="/etc/socialbird/backend.env"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE not found." >&2
  exit 1
fi

read -r -p "SMTP host: " SMTP_HOST
read -r -p "SMTP port [465]: " SMTP_PORT
SMTP_PORT="${SMTP_PORT:-465}"
read -r -p "TLS immediately (secure=true)? [Y/n]: " SMTP_TLS_ANSWER
case "${SMTP_TLS_ANSWER:-Y}" in
  n|N|no|NO) SMTP_SECURE=false ;;
  *) SMTP_SECURE=true ;;
esac
read -r -p "SMTP user / mailbox: " SMTP_USER
read -r -s -p "SMTP app password (input hidden): " SMTP_PASSWORD
echo
read -r -p "From address [$SMTP_USER]: " SMTP_FROM
SMTP_FROM="${SMTP_FROM:-$SMTP_USER}"
read -r -p "Send test email to [$SMTP_USER]: " TEST_TO
TEST_TO="${TEST_TO:-$SMTP_USER}"

if [[ -z "$SMTP_HOST" || -z "$SMTP_USER" || -z "$SMTP_PASSWORD" ]]; then
  echo "SMTP host, user and app password are required." >&2
  exit 1
fi

BACKUP="${ENV_FILE}.before-mail-$(date +%Y%m%d-%H%M%S)"
cp -a "$ENV_FILE" "$BACKUP"

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  grep -v -E "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

set_env_value SMTP_HOST "$SMTP_HOST"
set_env_value SMTP_PORT "$SMTP_PORT"
set_env_value SMTP_SECURE "$SMTP_SECURE"
set_env_value SMTP_USER "$SMTP_USER"
set_env_value SMTP_PASSWORD "$SMTP_PASSWORD"
set_env_value SMTP_FROM "$SMTP_FROM"
chown root:socialbird "$ENV_FILE"
chmod 0640 "$ENV_FILE"

export NODE_PATH="$APP_DIR/backend/node_modules"
export SOCIALBIRD_ENV_FILE="$ENV_FILE"
export SOCIALBIRD_TEST_TO="$TEST_TO"

if ! node <<'NODE'
const fs = require('fs');
const nodemailer = require('nodemailer');
const envPath = process.env.SOCIALBIRD_ENV_FILE;
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
  const index = line.indexOf('=');
  env[line.slice(0, index).trim()] = line.slice(index + 1);
}
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT || 465),
  secure: String(env.SMTP_SECURE || 'true').toLowerCase() === 'true',
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
});
(async () => {
  await transporter.verify();
  const info = await transporter.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to: process.env.SOCIALBIRD_TEST_TO,
    subject: 'IT-BIRD: проверка почты',
    text: 'SMTP для IT-BIRD настроен. Это тестовое письмо.',
  });
  console.log('SMTP verified. Test message accepted by server:', info.messageId || 'ok');
})().catch((error) => {
  console.error('SMTP test failed:', error.message);
  process.exit(1);
});
NODE
then
  echo "SMTP test failed. Restoring previous mail configuration." >&2
  cp -a "$BACKUP" "$ENV_FILE"
  chown root:socialbird "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  exit 1
fi

(
  cd /var/lib/socialbird
  sudo -u socialbird env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
  sudo -u socialbird env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"
  sudo -u socialbird env PM2_HOME="$PM2_HOME_DIR" pm2 save
)

echo
printf 'Mail configuration completed. Backup: %s\n' "$BACKUP"
printf 'Test email target: %s\n' "$TEST_TO"

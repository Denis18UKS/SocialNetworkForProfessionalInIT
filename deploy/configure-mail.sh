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

read -r -p "SMTP host [smtp.mail.ru]: " SMTP_HOST
SMTP_HOST="${SMTP_HOST:-smtp.mail.ru}"
if [[ "${SMTP_HOST,,}" == "smpt.mail.ru" ]]; then
  echo "Detected typo 'smpt.mail.ru'; using 'smtp.mail.ru'."
  SMTP_HOST="smtp.mail.ru"
fi

read -r -p "SMTP port [465]: " SMTP_PORT
SMTP_PORT="${SMTP_PORT:-465}"

if [[ "${SMTP_HOST,,}" == "smtp.mail.ru" ]]; then
  if [[ "$SMTP_PORT" != "465" ]]; then
    echo "Mail.ru officially uses SMTP 465 with SSL/TLS; switching port to 465."
  fi
  SMTP_PORT=465
  SMTP_SECURE=true
else
  case "$SMTP_PORT" in
    465) SMTP_SECURE=true ;;
    587) SMTP_SECURE=false ;;
    *)
      read -r -p "TLS immediately (secure=true)? [Y/n]: " SMTP_TLS_ANSWER
      case "${SMTP_TLS_ANSWER:-Y}" in
        n|N|no|NO) SMTP_SECURE=false ;;
        *) SMTP_SECURE=true ;;
      esac
      ;;
  esac
fi

echo "Using SMTP: ${SMTP_HOST}:${SMTP_PORT}, secure=${SMTP_SECURE}"
read -r -p "SMTP user / mailbox: " SMTP_USER
SMTP_USER="$(printf '%s' "$SMTP_USER" | tr -d '\r\n' | xargs)"
read -r -s -p "SMTP app password (input hidden; paste and press Enter): " SMTP_PASSWORD
echo

if [[ "${SMTP_HOST,,}" == "smtp.mail.ru" ]]; then
  RAW_PASSWORD_LENGTH=${#SMTP_PASSWORD}
  SMTP_PASSWORD="$(printf '%s' "$SMTP_PASSWORD" | tr -d '[:space:]')"
  CLEAN_PASSWORD_LENGTH=${#SMTP_PASSWORD}
  if [[ "$RAW_PASSWORD_LENGTH" -ne "$CLEAN_PASSWORD_LENGTH" ]]; then
    echo "Removed whitespace from copied Mail.ru app password (${RAW_PASSWORD_LENGTH} -> ${CLEAN_PASSWORD_LENGTH} characters)."
  else
    echo "App password received: ${CLEAN_PASSWORD_LENGTH} characters (value hidden)."
  fi
fi

read -r -p "From address [$SMTP_USER]: " SMTP_FROM
SMTP_FROM="${SMTP_FROM:-$SMTP_USER}"
read -r -p "Send test email to [$SMTP_USER]: " TEST_TO
TEST_TO="${TEST_TO:-$SMTP_USER}"

if [[ -z "$SMTP_HOST" || -z "$SMTP_USER" ]]; then
  echo "SMTP host and user are required." >&2
  exit 1
fi
if [[ -z "$SMTP_PASSWORD" ]]; then
  echo "The script received an EMPTY app password. Hidden input shows no characters; paste the app password and press Enter." >&2
  exit 1
fi
if [[ ! "$SMTP_USER" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "SMTP user must be a full email address." >&2
  exit 1
fi
if [[ ! "$TEST_TO" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Test recipient must be a valid email address (for example user@example.com)." >&2
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
const port = Number(env.SMTP_PORT || 465);
const secure = String(env.SMTP_SECURE || 'true').toLowerCase() === 'true';
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port,
  secure,
  requireTLS: !secure && port === 587,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  tls: { servername: env.SMTP_HOST },
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
  const message = String(error?.message || error);
  if (/application password|parol prilozheniya|535 5\.7\.0/i.test(message)) {
    console.error('SMTP authentication failed at Mail.ru AUTH stage. Connection/TLS are OK, but Mail.ru rejected the credential.');
    console.error('Check Mail.ru -> Settings -> All settings -> Security:');
    console.error('  1) External services: IMAP/POP/SMTP access must be enabled.');
    console.error('  2) Create a NEW password in "Passwords for external applications" for mail access.');
    console.error('  3) Paste that generated app password here, not the normal mailbox password or a 2FA/backup code.');
  } else if (/wrong version number/i.test(message)) {
    console.error('SMTP TLS mode/port mismatch. Mail.ru should use smtp.mail.ru:465 with secure=true.');
  } else if (/ENOTFOUND|getaddrinfo/i.test(message)) {
    console.error('SMTP host not found. For Mail.ru use exactly: smtp.mail.ru');
  } else {
    console.error('SMTP test failed:', message);
  }
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

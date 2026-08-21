#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

PUBLIC_IP="${PUBLIC_IP:-31.207.74.138}"
SITE_DOMAIN="${SITE_DOMAIN:-socialbird.${PUBLIC_IP}.nip.io}"
API_DOMAIN="${API_DOMAIN:-api.${PUBLIC_IP}.nip.io}"
REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT.git}"
REPOSITORY_BRANCH="${REPOSITORY_BRANCH:-deploy/socialbird-vps-production}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
DB_DUMP="${DB_DUMP:-}"

APP_USER="socialbird"
APP_GROUP="socialbird"
APP_HOME="/var/lib/socialbird"
APP_ROOT="/opt/socialbird"
APP_DIRECTORY="${APP_ROOT}/current"
CONFIG_DIRECTORY="/etc/socialbird"
LOG_DIRECTORY="/var/log/socialbird"
BACKUP_DIRECTORY="/var/backups/socialbird"

random_secret() {
  openssl rand -hex "${1:-32}"
}

read_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  ca-certificates curl gnupg git openssl gettext-base \
  nginx certbot python3-certbot-nginx \
  mysql-server coturn \
  ufw fail2ban \
  build-essential python3 make g++

# COMPILER_SANDBOX: docker-engine
. /etc/os-release
DOCKER_DISTRO="${ID}"
DOCKER_SUITE="${UBUNTU_CODENAME:-${VERSION_CODENAME}}"
if [[ "${DOCKER_DISTRO}" != "ubuntu" && "${DOCKER_DISTRO}" != "debian" ]]; then
  echo "The compiler sandbox installer supports Ubuntu or Debian." >&2
  exit 1
fi
apt-get remove -y docker.io docker-compose docker-doc podman-docker containerd runc >/dev/null 2>&1 || true
install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${DOCKER_DISTRO}/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<DOCKER_REPOSITORY
Types: deb
URIs: https://download.docker.com/linux/${DOCKER_DISTRO}
Suites: ${DOCKER_SUITE}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
DOCKER_REPOSITORY
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker info --format '{{json .SecurityOptions}}' | grep -q 'seccomp' || { echo "Docker seccomp is required." >&2; exit 1; }

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

npm install --global pm2

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"
fi

# COMPILER_SANDBOX: service-user
COMPILER_USER="socialbird-compiler"
COMPILER_HOME="/var/lib/socialbird-compiler"
if ! id "$COMPILER_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$COMPILER_HOME" --shell /usr/sbin/nologin --gid "$APP_GROUP" "$COMPILER_USER"
fi
usermod -aG docker "$COMPILER_USER"
install -d -o "$COMPILER_USER" -g "$APP_GROUP" "$COMPILER_HOME"

install -d -o "$APP_USER" -g "$APP_GROUP" "$APP_ROOT" "$APP_HOME" "$LOG_DIRECTORY" "$BACKUP_DIRECTORY"
install -d -o root -g "$APP_GROUP" -m 0750 "$CONFIG_DIRECTORY"
install -d -m 0755 /var/www/letsencrypt

if [[ -d "${APP_DIRECTORY}/.git" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIRECTORY" fetch --prune origin
  sudo -u "$APP_USER" git -C "$APP_DIRECTORY" checkout "$REPOSITORY_BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIRECTORY" reset --hard "origin/${REPOSITORY_BRANCH}"
else
  rm -rf "$APP_DIRECTORY"
  sudo -u "$APP_USER" git clone --branch "$REPOSITORY_BRANCH" --single-branch "$REPOSITORY_URL" "$APP_DIRECTORY"
fi

BACKEND_ENV="${CONFIG_DIRECTORY}/backend.env"
DB_PASSWORD="$(read_env_value DB_PASSWORD "$BACKEND_ENV")"
JWT_SECRET="$(read_env_value JWT_SECRET "$BACKEND_ENV")"
TURN_PASSWORD="$(read_env_value VITE_TURN_CREDENTIAL "${APP_DIRECTORY}/.env.production")"

DB_PASSWORD="${DB_PASSWORD:-$(random_secret 24)}"
JWT_SECRET="${JWT_SECRET:-$(random_secret 48)}"
TURN_PASSWORD="${TURN_PASSWORD:-$(random_secret 24)}"
TURN_USERNAME="${TURN_USERNAME:-socialbird}"

systemctl enable --now mysql
mysql --protocol=socket <<SQL
CREATE DATABASE IF NOT EXISTS socialbird CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'socialbird'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER 'socialbird'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON socialbird.* TO 'socialbird'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

if [[ -n "$DB_DUMP" && -f "$DB_DUMP" && ! -f "${APP_HOME}/database-dump-imported" ]]; then
  mysql --protocol=socket socialbird < "$DB_DUMP"
  touch "${APP_HOME}/database-dump-imported"
  chown "$APP_USER:$APP_GROUP" "${APP_HOME}/database-dump-imported"
fi

mysql --protocol=socket socialbird < "${APP_DIRECTORY}/deploy/schema.sql"

cat > "$BACKEND_ENV" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=5000
FRONTEND_URL=https://${SITE_DOMAIN}
FRONTEND_URLS=https://${SITE_DOMAIN}
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=socialbird
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=socialbird
DB_CONNECTION_LIMIT=10
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES=7d
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
GITHUB_PERSONAL_ACCESS_TOKEN=
GITLAB_PERSONAL_ACCESS_TOKEN=
MAX_UPLOAD_BYTES=26214400
JSON_BODY_LIMIT=2mb
WS_MAX_PAYLOAD_BYTES=1048576
WS_HEARTBEAT_MS=30000
ENABLE_COMPILER=true
COMPILER_SOCKET=/run/socialbird-compiler/runner.sock
COMPILER_REQUEST_TIMEOUT_MS=12000
COMPILER_MAX_CODE_BYTES=200000
COMPILER_RUNS_PER_MINUTE=10
COMPILER_MAX_ACTIVE_PER_USER=1
ENV
chmod 0640 "$BACKEND_ENV"
chown root:"$APP_GROUP" "$BACKEND_ENV"

cat > "${APP_DIRECTORY}/.env.production" <<ENV
VITE_API_URL=https://${API_DOMAIN}
VITE_STUN_URLS=stun:stun.l.google.com:19302
VITE_TURN_URLS=turn:${API_DOMAIN}:3478?transport=udp,turn:${API_DOMAIN}:3478?transport=tcp,turns:${API_DOMAIN}:5349?transport=tcp
VITE_TURN_USERNAME=${TURN_USERNAME}
VITE_TURN_CREDENTIAL=${TURN_PASSWORD}
ENV
chown "$APP_USER:$APP_GROUP" "${APP_DIRECTORY}/.env.production"
chmod 0600 "${APP_DIRECTORY}/.env.production"

sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-app-fixes.mjs"
sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-mobile-layout-fixes.mjs"
sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/harden-source.mjs"
sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/enable-sandbox-compiler.mjs"

sudo -u "$APP_USER" bash -lc "cd '${APP_DIRECTORY}' && npm ci && npm run build"
sudo -u "$APP_USER" bash -lc "cd '${APP_DIRECTORY}/backend' && npm ci --omit=dev"

# APP_FIX: puppeteer-browser-install
install -d -o "$APP_USER" -g "$APP_GROUP" "${APP_HOME}/.cache" "${APP_HOME}/.cache/puppeteer"
HOME="$APP_HOME" PUPPETEER_CACHE_DIR="${APP_HOME}/.cache/puppeteer" bash -lc "cd '${APP_DIRECTORY}/backend' && npx puppeteer browsers install chrome --install-deps"
chown -R "$APP_USER:$APP_GROUP" "${APP_HOME}/.cache"

# COMPILER_SANDBOX: build-and-service
docker build --pull --tag socialbird/compiler-sandbox:latest "${APP_DIRECTORY}/deploy/compiler-sandbox"
install -d -o root -g root -m 0755 /usr/local/lib/socialbird-compiler-runner
install -o root -g root -m 0644 "${APP_DIRECTORY}/deploy/compiler-runner/server.mjs" /usr/local/lib/socialbird-compiler-runner/server.mjs
install -o root -g root -m 0644 "${APP_DIRECTORY}/deploy/systemd/socialbird-compiler-runner.service" /etc/systemd/system/socialbird-compiler-runner.service
systemctl daemon-reload
systemctl enable --now socialbird-compiler-runner
for attempt in {1..20}; do
  if curl --silent --fail --unix-socket /run/socialbird-compiler/runner.sock http://localhost/health >/dev/null; then
    break
  fi
  if [[ "$attempt" -eq 20 ]]; then
    journalctl -u socialbird-compiler-runner --no-pager -n 100
    exit 1
  fi
  sleep 1
done
COMPILER_SANDBOX_IMAGE=socialbird/compiler-sandbox:latest node "${APP_DIRECTORY}/deploy/compiler-sandbox/smoke-test.mjs"

install -d -o "$APP_USER" -g "$APP_GROUP" \
  "${APP_DIRECTORY}/backend/uploads" \
  "${APP_DIRECTORY}/backend/uploads/avatars" \
  "${APP_DIRECTORY}/backend/uploads/news" \
  "${APP_DIRECTORY}/backend/uploads/posts" \
  "${APP_DIRECTORY}/backend/uploads/chat_files"

cat > /etc/nginx/sites-available/socialbird-bootstrap <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${SITE_DOMAIN} ${API_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    location / {
        return 200 'SocialBIRD TLS bootstrap';
        add_header Content-Type text/plain;
    }
}
NGINX
ln -sfn /etc/nginx/sites-available/socialbird-bootstrap /etc/nginx/sites-enabled/socialbird
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

CERTBOT_ARGS=(--non-interactive --agree-tos --webroot -w /var/www/letsencrypt)
if [[ -n "$LETSENCRYPT_EMAIL" ]]; then
  CERTBOT_ARGS+=(--email "$LETSENCRYPT_EMAIL")
else
  CERTBOT_ARGS+=(--register-unsafely-without-email)
fi

if [[ ! -d "/etc/letsencrypt/live/${SITE_DOMAIN}" ]]; then
  certbot certonly "${CERTBOT_ARGS[@]}" -d "$SITE_DOMAIN"
fi
if [[ ! -d "/etc/letsencrypt/live/${API_DOMAIN}" ]]; then
  certbot certonly "${CERTBOT_ARGS[@]}" -d "$API_DOMAIN"
fi

export SITE_DOMAIN API_DOMAIN PUBLIC_IP TURN_USERNAME TURN_PASSWORD
envsubst '${SITE_DOMAIN} ${API_DOMAIN}' \
  < "${APP_DIRECTORY}/deploy/nginx-socialbird.conf.template" \
  > /etc/nginx/sites-available/socialbird
ln -sfn /etc/nginx/sites-available/socialbird /etc/nginx/sites-enabled/socialbird
rm -f /etc/nginx/sites-enabled/socialbird-bootstrap
nginx -t
systemctl reload nginx

install -d -o turnserver -g turnserver /var/log/turnserver
envsubst '${PUBLIC_IP} ${API_DOMAIN} ${TURN_USERNAME} ${TURN_PASSWORD}' \
  < "${APP_DIRECTORY}/deploy/turnserver.conf.template" \
  > /etc/turnserver.conf
chmod 0600 /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf
if [[ -f /etc/default/coturn ]]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
fi
systemctl enable --now coturn
systemctl restart coturn

(
  cd "$APP_HOME"
  sudo -u "$APP_USER" env PM2_HOME="${APP_HOME}/.pm2" pm2 delete socialbird-api >/dev/null 2>&1 || true
  sudo -u "$APP_USER" env PM2_HOME="${APP_HOME}/.pm2" pm2 start "${APP_DIRECTORY}/ecosystem.config.cjs"
  sudo -u "$APP_USER" env PM2_HOME="${APP_HOME}/.pm2" pm2 save
)
pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" | tail -n 1 | bash || true
systemctl daemon-reload
systemctl enable --now "pm2-${APP_USER}" || true

cat > /usr/local/sbin/socialbird-backup <<'BACKUP'
#!/usr/bin/env bash
set -Eeuo pipefail
source /etc/socialbird/backend.env
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="/var/backups/socialbird/${STAMP}"
mkdir -p "$DEST"
mysqldump --single-transaction --routines --triggers \
  -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" \
  | gzip -9 > "$DEST/database.sql.gz"
tar -C /opt/socialbird/current/backend -czf "$DEST/uploads.tar.gz" uploads
find /var/backups/socialbird -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
BACKUP
chmod 0750 /usr/local/sbin/socialbird-backup

cat > /etc/cron.d/socialbird-backup <<CRON
17 3 * * * root /usr/local/sbin/socialbird-backup >> /var/log/socialbird/backup.log 2>&1
CRON
chmod 0644 /etc/cron.d/socialbird-backup

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 49160:49200/udp
ufw --force enable

systemctl enable --now fail2ban

sleep 3
(
  cd "$APP_HOME"
  sudo -u "$APP_USER" env PM2_HOME="${APP_HOME}/.pm2" pm2 status
)
curl --fail --silent --show-error "https://${SITE_DOMAIN}/" >/dev/null

cat <<RESULT

SocialBIRD installation completed.
Site: https://${SITE_DOMAIN}
API/WebSocket: https://${API_DOMAIN}
TURN: ${API_DOMAIN}:3478 and ${API_DOMAIN}:5349

Secrets were written to:
  ${BACKEND_ENV}
  ${APP_DIRECTORY}/.env.production

The online compiler is enabled through disposable, network-isolated Docker sandboxes.
RESULT

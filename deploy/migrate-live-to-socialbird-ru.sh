#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
APP_USER="socialbird"
APP_HOME="/var/lib/socialbird"
PM2_HOME_DIR="/var/lib/socialbird/.pm2"
BRANCH="deploy/socialbird-vps-production"
PUBLIC_IP="31.207.74.138"
OLD_SITE="socialbird.31.207.74.138.nip.io"
OLD_API="api.31.207.74.138.nip.io"
SITE_DOMAIN="socialbird.ru"
API_DOMAIN="api.socialbird.ru"
BACKUP_DIR="/var/backups/socialbird/domain-migration-$(date +%Y%m%d-%H%M%S)"
NEW_NGINX="/etc/nginx/sites-available/socialbird-custom-domain"
NEW_NGINX_LINK="/etc/nginx/sites-enabled/socialbird-custom-domain"
BOOTSTRAP="/etc/nginx/sites-available/socialbird-custom-domain-bootstrap"
BOOTSTRAP_LINK="/etc/nginx/sites-enabled/socialbird-custom-domain-bootstrap"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

cd "$APP_DIR"
install -d -o root -g root -m 0750 "$BACKUP_DIR"

resolve_ipv4() {
  getent ahostsv4 "$1" | awk 'NR==1{print $1}'
}

SITE_IP="$(resolve_ipv4 "$SITE_DOMAIN")"
API_IP="$(resolve_ipv4 "$API_DOMAIN")"
if [[ "$SITE_IP" != "$PUBLIC_IP" || "$API_IP" != "$PUBLIC_IP" ]]; then
  echo "DNS is not ready." >&2
  echo "$SITE_DOMAIN -> ${SITE_IP:-unresolved}" >&2
  echo "$API_DOMAIN -> ${API_IP:-unresolved}" >&2
  exit 2
fi

backup_if_exists() {
  local source="$1"
  local target="$BACKUP_DIR/rootfs${source}"
  if [[ -e "$source" ]]; then
    mkdir -p "$(dirname "$target")"
    cp -a "$source" "$target"
  fi
}

for item in \
  /etc/socialbird/backend.env \
  "$APP_DIR/.env.production" \
  /etc/turnserver.conf \
  "$NEW_NGINX" \
  "$BOOTSTRAP"; do
  backup_if_exists "$item"
done

[[ -d dist ]] && cp -a dist "$BACKUP_DIR/dist"

for file in \
  index.html \
  public/robots.txt \
  public/sitemap.xml \
  scripts/generate-seo.mjs \
  src/components/SeoManager.tsx \
  deploy/install.sh \
  deploy/update-native-parity-seo.sh; do
  if [[ -e "$file" ]]; then
    mkdir -p "$BACKUP_DIR/app/$(dirname "$file")"
    cp -a "$file" "$BACKUP_DIR/app/$file"
  fi
done

restore_file() {
  local source="$BACKUP_DIR/rootfs$1"
  if [[ -e "$source" ]]; then
    mkdir -p "$(dirname "$1")"
    cp -a "$source" "$1"
  else
    rm -f "$1"
  fi
}

rollback() {
  echo "Domain migration failed; rolling back..." >&2
  restore_file /etc/socialbird/backend.env
  restore_file "$APP_DIR/.env.production"
  restore_file /etc/turnserver.conf
  restore_file "$NEW_NGINX"
  restore_file "$BOOTSTRAP"
  rm -f "$NEW_NGINX_LINK" "$BOOTSTRAP_LINK"
  for file in \
    index.html \
    public/robots.txt \
    public/sitemap.xml \
    scripts/generate-seo.mjs \
    src/components/SeoManager.tsx \
    deploy/install.sh \
    deploy/update-native-parity-seo.sh; do
    [[ -e "$BACKUP_DIR/app/$file" ]] && cp -a "$BACKUP_DIR/app/$file" "$file"
  done
  if [[ -d "$BACKUP_DIR/dist" ]]; then
    rm -rf dist
    cp -a "$BACKUP_DIR/dist" dist
  fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  systemctl restart coturn >/dev/null 2>&1 || true
  (
    cd "$APP_HOME"
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs" >/dev/null 2>&1 || true
    sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save >/dev/null 2>&1 || true
  )
  echo "Rollback completed. Backup: $BACKUP_DIR" >&2
}
trap rollback ERR

set_env_value() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

echo "[1/10] DNS preflight OK"
echo "$SITE_DOMAIN -> $SITE_IP"
echo "$API_DOMAIN -> $API_IP"

echo "[2/10] Fetching custom-domain source migration"
sudo -u "$APP_USER" git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH"
sudo -u "$APP_USER" git checkout "origin/$BRANCH" -- \
  deploy/apply-socialbird-ru-domain.mjs \
  deploy/apply-seo-fixes.mjs \
  scripts/generate-seo.mjs \
  src/components/SeoManager.tsx \
  public/robots.txt \
  public/sitemap.xml
node --check deploy/apply-socialbird-ru-domain.mjs
sudo -u "$APP_USER" node deploy/apply-socialbird-ru-domain.mjs

echo "[3/10] Preparing HTTP challenge for the new domains"
cat > "$BOOTSTRAP" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${SITE_DOMAIN} ${API_DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 200 'SocialBIRD domain bootstrap'; add_header Content-Type text/plain; }
}
NGINX
ln -sfn "$BOOTSTRAP" "$BOOTSTRAP_LINK"
nginx -t
systemctl reload nginx

echo "[4/10] Requesting Let's Encrypt certificates"
CERTBOT_ARGS=(--non-interactive --agree-tos --register-unsafely-without-email --webroot -w /var/www/letsencrypt)
if [[ ! -d "/etc/letsencrypt/live/${SITE_DOMAIN}" ]]; then
  certbot certonly "${CERTBOT_ARGS[@]}" -d "$SITE_DOMAIN"
fi
if [[ ! -d "/etc/letsencrypt/live/${API_DOMAIN}" ]]; then
  certbot certonly "${CERTBOT_ARGS[@]}" -d "$API_DOMAIN"
fi

echo "[5/10] Updating SocialBIRD runtime domains"
set_env_value /etc/socialbird/backend.env FRONTEND_URL "https://${SITE_DOMAIN}"
set_env_value /etc/socialbird/backend.env FRONTEND_URLS "https://${SITE_DOMAIN},https://${OLD_SITE}"
chmod 0640 /etc/socialbird/backend.env
chown root:socialbird /etc/socialbird/backend.env

TURN_USERNAME="$(sed -n 's/^VITE_TURN_USERNAME=//p' .env.production | tail -n 1)"
TURN_CREDENTIAL="$(sed -n 's/^VITE_TURN_CREDENTIAL=//p' .env.production | tail -n 1)"
TURN_USERNAME="${TURN_USERNAME:-socialbird}"
if [[ -z "$TURN_CREDENTIAL" ]]; then
  echo "VITE_TURN_CREDENTIAL is missing; refusing to replace TURN configuration." >&2
  exit 3
fi
cat > .env.production <<ENV
VITE_API_URL=https://${API_DOMAIN}
VITE_STUN_URLS=stun:stun.l.google.com:19302
VITE_TURN_URLS=turn:${API_DOMAIN}:3478?transport=udp,turn:${API_DOMAIN}:3478?transport=tcp,turns:${API_DOMAIN}:5349?transport=tcp
VITE_TURN_USERNAME=${TURN_USERNAME}
VITE_TURN_CREDENTIAL=${TURN_CREDENTIAL}
ENV
chown "$APP_USER:socialbird" .env.production
chmod 0600 .env.production

echo "[6/10] Configuring the new HTTPS virtual hosts"
cat > "$NEW_NGINX" <<'NGINX'
map $http_upgrade $socialbird_custom_connection_upgrade {
    default upgrade;
    '' close;
}

limit_req_zone $binary_remote_addr zone=socialbird_api_custom:10m rate=20r/s;

map $http_origin $socialbird_custom_cors_origin {
    default "";
    "https://socialbird.ru" $http_origin;
}

server {
    listen 80;
    listen [::]:80;
    server_name socialbird.ru api.socialbird.ru;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name socialbird.ru;

    ssl_certificate /etc/letsencrypt/live/socialbird.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/socialbird.ru/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    root /opt/socialbird/current/dist;
    index index.html;
    client_max_body_size 100m;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(self), microphone=(self), display-capture=(self)" always;

    location /assets/ {
        try_files $uri =404;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.socialbird.ru;

    ssl_certificate /etc/letsencrypt/live/api.socialbird.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.socialbird.ru/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    client_max_body_size 100m;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;

    error_page 413 = @socialbird_custom_upload_too_large;
    location @socialbird_custom_upload_too_large {
        default_type application/json;
        add_header Access-Control-Allow-Origin $socialbird_custom_cors_origin always;
        add_header Vary Origin always;
        return 413 '{"message":"Файл слишком большой. Максимальный размер — 100 МБ.","code":"FILE_TOO_LARGE"}';
    }

    location / {
        limit_req zone=socialbird_api_custom burst=60 nodelay;
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $socialbird_custom_connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
NGINX
ln -sfn "$NEW_NGINX" "$NEW_NGINX_LINK"
rm -f "$BOOTSTRAP_LINK"
nginx -t
systemctl reload nginx

echo "[7/10] Switching Coturn TLS/realm to api.socialbird.ru"
cat > /etc/turnserver.conf <<TURN
listening-ip=0.0.0.0
relay-ip=0.0.0.0
external-ip=${PUBLIC_IP}
listening-port=3478
tls-listening-port=5349
min-port=49160
max-port=49200
fingerprint
lt-cred-mech
realm=${API_DOMAIN}
server-name=${API_DOMAIN}
user=${TURN_USERNAME}:${TURN_CREDENTIAL}
cert=/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem
pkey=/etc/letsencrypt/live/${API_DOMAIN}/privkey.pem
no-cli
no-tlsv1
no-tlsv1_1
no-loopback-peers
no-multicast-peers
stale-nonce=600
log-file=/var/log/turnserver/turnserver.log
simple-log
TURN
chmod 0600 /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf
systemctl restart coturn

echo "[8/10] Building frontend with the new API/SEO origin"
sudo -u "$APP_USER" npm run build
test -s dist/index.html
test -s dist/robots.txt
test -s dist/sitemap.xml
grep -q 'https://socialbird.ru/' dist/sitemap.xml
grep -q 'https://socialbird.ru' dist/index.html

echo "[9/10] Restarting only SocialBIRD API"
(
  cd "$APP_HOME"
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 delete socialbird-api >/dev/null 2>&1 || true
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 start "$APP_DIR/ecosystem.config.cjs"
  sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" pm2 save
)
for attempt in {1..25}; do
  if ss -lnt | grep -q '127.0.0.1:5000'; then break; fi
  if [[ "$attempt" -eq 25 ]]; then
    tail -n 160 /var/log/socialbird/api-error.log 2>/dev/null || true
    exit 4
  fi
  sleep 1
done

echo "[10/10] Verifying the new domain"
curl -fsS "https://${SITE_DOMAIN}/" | grep -q 'SocialBIRD'
curl -fsS "https://${SITE_DOMAIN}/robots.txt" | grep -q "Sitemap: https://${SITE_DOMAIN}/sitemap.xml"
curl -fsS "https://${SITE_DOMAIN}/sitemap.xml" | grep -q "https://${SITE_DOMAIN}/"
curl -fsS "https://${API_DOMAIN}/push/public-key" | grep -q 'publicKey'

trap - ERR
chown -R "$APP_USER:socialbird" src public dist 2>/dev/null || true

echo
echo "SocialBIRD custom-domain migration completed."
echo "Site: https://${SITE_DOMAIN}"
echo "API: https://${API_DOMAIN}"
echo "Old nip.io site remains enabled as a transition fallback."
echo "Backup: ${BACKUP_DIR}"

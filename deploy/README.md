# SocialBIRD production deployment

The production layout uses:

- Nginx for the React build and HTTPS termination;
- Node.js + PM2 for the Express/WebSocket backend;
- MySQL on localhost only;
- Coturn for WebRTC relay;
- Certbot for TLS certificates;
- UFW, Fail2ban and daily database/upload backups.

## Default temporary domains

The installer can launch without a purchased domain by using DNS names derived from the VPS IP:

- `https://socialbird.31.207.74.138.nip.io`
- `https://api.31.207.74.138.nip.io`

A custom domain can be supplied through `SITE_DOMAIN` and `API_DOMAIN`.

## Clean installation

```bash
git clone --branch deploy/socialbird-vps-production \
  https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT.git \
  /root/socialbird-installer

cd /root/socialbird-installer
sudo bash deploy/install.sh
```

## Installation with an existing database dump

```bash
sudo DB_DUMP=/root/socialbird.sql bash deploy/install.sh
```

## Custom domains

```bash
sudo \
  SITE_DOMAIN=socialbird.example.com \
  API_DOMAIN=api.socialbird.example.com \
  LETSENCRYPT_EMAIL=admin@example.com \
  bash deploy/install.sh
```

Both DNS records must already point to the VPS before Certbot runs.

## Important files on the VPS

- application: `/opt/socialbird/current`
- backend secrets: `/etc/socialbird/backend.env`
- frontend build variables: `/opt/socialbird/current/.env.production`
- Nginx: `/etc/nginx/sites-available/socialbird`
- Coturn: `/etc/turnserver.conf`
- logs: `/var/log/socialbird`
- backups: `/var/backups/socialbird`

## Operations

```bash
sudo -u socialbird PM2_HOME=/var/lib/socialbird/.pm2 pm2 status
sudo -u socialbird PM2_HOME=/var/lib/socialbird/.pm2 pm2 logs socialbird-api
sudo systemctl status nginx mysql coturn pm2-socialbird
sudo /usr/local/sbin/socialbird-backup
```

The online compiler remains disabled in production until it is moved into an isolated disposable container with network, CPU, memory, process and filesystem limits.

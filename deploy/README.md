# SocialBIRD production deployment

The production layout uses:

- Nginx for the React build and HTTPS termination;
- Node.js + PM2 for the Express/WebSocket backend;
- MySQL on localhost only;
- Coturn for WebRTC relay;
- Docker Engine and a private compiler runner for isolated code execution;
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

## Isolated online compiler

The public API never launches user code directly. It sends an authenticated request through the private Unix socket:

```text
Express API (socialbird user)
    -> /run/socialbird-compiler/runner.sock
    -> socialbird-compiler-runner systemd service
    -> one disposable Docker container per execution
```

The runner supports Java, C#, C++17, Lua, Python, PHP, JavaScript, Node.js and React/JSX. Each execution uses:

- `--network none`;
- a read-only root filesystem;
- temporary in-memory `/workspace` and `/tmp` filesystems;
- a non-root UID/GID;
- all Linux capabilities dropped;
- Docker's default seccomp profile and `no-new-privileges`;
- CPU, RAM, PID, file descriptor, file size, time and output limits;
- no host bind mounts and no Docker socket inside the code container;
- automatic container deletion after completion.

The runner itself is not exposed over TCP. Only the SocialBIRD backend group can access its Unix socket. The backend user is not added to the Docker group.

Default abuse controls are ten executions per account per minute, one active execution per account, two concurrent containers globally and a bounded queue. These values can be adjusted through `/etc/socialbird/backend.env` and the systemd runner unit.

## Important files on the VPS

- application: `/opt/socialbird/current`
- backend secrets: `/etc/socialbird/backend.env`
- frontend build variables: `/opt/socialbird/current/.env.production`
- Nginx: `/etc/nginx/sites-available/socialbird`
- Coturn: `/etc/turnserver.conf`
- compiler runner unit: `/etc/systemd/system/socialbird-compiler-runner.service`
- compiler socket: `/run/socialbird-compiler/runner.sock`
- compiler image: `socialbird/compiler-sandbox:latest`
- logs: `/var/log/socialbird`
- backups: `/var/backups/socialbird`

## Operations

```bash
sudo -u socialbird PM2_HOME=/var/lib/socialbird/.pm2 pm2 status
sudo -u socialbird PM2_HOME=/var/lib/socialbird/.pm2 pm2 logs socialbird-api
sudo systemctl status nginx mysql coturn docker socialbird-compiler-runner pm2-socialbird
sudo journalctl -u socialbird-compiler-runner -f
sudo curl --unix-socket /run/socialbird-compiler/runner.sock http://localhost/health
sudo node /opt/socialbird/current/deploy/compiler-sandbox/smoke-test.mjs
sudo /usr/local/sbin/socialbird-backup
```

The compiler stays functional in production, but all untrusted code is executed only inside disposable network-isolated containers.

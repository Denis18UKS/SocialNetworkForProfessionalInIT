import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDirectory = path.dirname(fileURLToPath(import.meta.url));
const installerPath = path.join(deployDirectory, 'install.sh');
let source = fs.readFileSync(installerPath, 'utf8');
const initialSource = source;

const replaceRequired = (label, pattern, replacement) => {
  const updated = source.replace(pattern, replacement);
  if (updated === source) throw new Error(`Installer patch failed: ${label}`);
  source = updated;
};

if (!source.includes('# COMPILER_SANDBOX: docker-engine')) {
  replaceRequired(
    'Docker Engine installation',
    /build-essential python3 make g\+\+\r?\n\r?\nif ! command -v node/,
    `build-essential python3 make g++\n\n# COMPILER_SANDBOX: docker-engine\n. /etc/os-release\nDOCKER_DISTRO=\"\${ID}\"\nDOCKER_SUITE=\"\${UBUNTU_CODENAME:-\${VERSION_CODENAME}}\"\nif [[ \"\${DOCKER_DISTRO}\" != \"ubuntu\" && \"\${DOCKER_DISTRO}\" != \"debian\" ]]; then\n  echo \"The compiler sandbox installer supports Ubuntu or Debian.\" >&2\n  exit 1\nfi\napt-get remove -y docker.io docker-compose docker-doc podman-docker containerd runc >/dev/null 2>&1 || true\ninstall -m 0755 -d /etc/apt/keyrings\ncurl -fsSL \"https://download.docker.com/linux/\${DOCKER_DISTRO}/gpg\" -o /etc/apt/keyrings/docker.asc\nchmod a+r /etc/apt/keyrings/docker.asc\ncat > /etc/apt/sources.list.d/docker.sources <<DOCKER_REPOSITORY\nTypes: deb\nURIs: https://download.docker.com/linux/\${DOCKER_DISTRO}\nSuites: \${DOCKER_SUITE}\nComponents: stable\nArchitectures: $(dpkg --print-architecture)\nSigned-By: /etc/apt/keyrings/docker.asc\nDOCKER_REPOSITORY\napt-get update\napt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin\nsystemctl enable --now docker\ndocker info --format '{{json .SecurityOptions}}' | grep -q 'seccomp' || { echo \"Docker seccomp is required.\" >&2; exit 1; }\n\nif ! command -v node`
  );
}

if (!source.includes('# COMPILER_SANDBOX: service-user')) {
  replaceRequired(
    'compiler service user',
    /if ! id \"\$APP_USER\" >\/dev\/null 2>&1; then\r?\n  useradd --system --create-home --home-dir \"\$APP_HOME\" --shell \/usr\/sbin\/nologin \"\$APP_USER\"\r?\nfi/,
    `if ! id \"$APP_USER\" >/dev/null 2>&1; then\n  useradd --system --create-home --home-dir \"$APP_HOME\" --shell /usr/sbin/nologin \"$APP_USER\"\nfi\n\n# COMPILER_SANDBOX: service-user\nCOMPILER_USER=\"socialbird-compiler\"\nCOMPILER_HOME=\"/var/lib/socialbird-compiler\"\nif ! id \"$COMPILER_USER\" >/dev/null 2>&1; then\n  useradd --system --create-home --home-dir \"$COMPILER_HOME\" --shell /usr/sbin/nologin --gid \"$APP_GROUP\" \"$COMPILER_USER\"\nfi\nusermod -aG docker \"$COMPILER_USER\"\ninstall -d -o \"$COMPILER_USER\" -g \"$APP_GROUP\" \"$COMPILER_HOME\"`
  );
}

if (!source.includes('COMPILER_SOCKET=/run/socialbird-compiler/runner.sock')) {
  replaceRequired(
    'compiler environment variables',
    /ENABLE_COMPILER=false/,
    `ENABLE_COMPILER=true\nCOMPILER_SOCKET=/run/socialbird-compiler/runner.sock\nCOMPILER_REQUEST_TIMEOUT_MS=12000\nCOMPILER_MAX_CODE_BYTES=200000\nCOMPILER_RUNS_PER_MINUTE=10\nCOMPILER_MAX_ACTIVE_PER_USER=1`
  );
}

source = source.replace(/MAX_UPLOAD_BYTES=26214400/g, 'MAX_UPLOAD_BYTES=104857600');

if (!source.includes('apply-app-fixes.mjs')) {
  replaceRequired(
    'application fixes before production hardening',
    /sudo -u \"\$APP_USER\" node \"\$\{APP_DIRECTORY\}\/deploy\/harden-source\.mjs\"/,
    `sudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/apply-app-fixes.mjs\"\nsudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/harden-source.mjs\"`
  );
}

if (!source.includes('apply-mobile-layout-fixes.mjs')) {
  replaceRequired(
    'mobile layout fixes before production hardening',
    /sudo -u \"\$APP_USER\" node \"\$\{APP_DIRECTORY\}\/deploy\/apply-app-fixes\.mjs\"/,
    `sudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/apply-app-fixes.mjs\"\nsudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/apply-mobile-layout-fixes.mjs\"`
  );
}

if (!source.includes('apply-mobile-call-audio-fixes.mjs')) {
  replaceRequired(
    'mobile call audio fixes before production hardening',
    /sudo -u \"\$APP_USER\" node \"\$\{APP_DIRECTORY\}\/deploy\/apply-mobile-layout-fixes\.mjs\"/,
    `sudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/apply-mobile-layout-fixes.mjs\"\nsudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/apply-mobile-call-audio-fixes.mjs\"`
  );
}

if (!source.includes('apply-call-reliability-fixes.mjs')) {
  replaceRequired(
    'call reliability fixes before production hardening',
    /sudo -u \"\$APP_USER\" node \"\$\{APP_DIRECTORY\}\/deploy\/apply-mobile-call-audio-fixes\.mjs\"/,
    `sudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/apply-mobile-call-audio-fixes.mjs\"\nsudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/apply-call-reliability-fixes.mjs\"`
  );
}

if (!source.includes('apply-call-mobile-upload-fixes.mjs')) {
  replaceRequired(
    'call mobile upload fixes before production hardening',
    /sudo -u \"\$APP_USER\" node \"\$\{APP_DIRECTORY\}\/deploy\/apply-call-reliability-fixes\.mjs\"/,
    `sudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/apply-call-reliability-fixes.mjs\"\nsudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/apply-call-mobile-upload-fixes.mjs\"`
  );
}

if (!source.includes('apply-call-video-mount-fix.mjs')) {
  replaceRequired(
    'remote video mount fix before production hardening',
    /sudo -u \"\$APP_USER\" node \"\$\{APP_DIRECTORY\}\/deploy\/apply-call-mobile-upload-fixes\.mjs\"/,
    `sudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/apply-call-mobile-upload-fixes.mjs\"\nsudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/apply-call-video-mount-fix.mjs\"`
  );
}

if (!source.includes('enable-sandbox-compiler.mjs')) {
  replaceRequired(
    'sandbox compiler source patch',
    /sudo -u \"\$APP_USER\" node \"\$\{APP_DIRECTORY\}\/deploy\/harden-source\.mjs\"/,
    `sudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/harden-source.mjs\"\nsudo -u \"$APP_USER\" node \"\${APP_DIRECTORY}/deploy/enable-sandbox-compiler.mjs\"`
  );
}

if (!source.includes('# APP_FIX: puppeteer-browser-install')) {
  replaceRequired(
    'Puppeteer browser installation',
    /sudo -u \"\$APP_USER\" bash -lc \"cd '\$\{APP_DIRECTORY\}\/backend' && npm ci --omit=dev\"/,
    `sudo -u \"$APP_USER\" bash -lc \"cd '\${APP_DIRECTORY}/backend' && npm ci --omit=dev\"\n\n# APP_FIX: puppeteer-browser-install\ninstall -d -o \"$APP_USER\" -g \"$APP_GROUP\" \"\${APP_HOME}/.cache\" \"\${APP_HOME}/.cache/puppeteer\"\nHOME=\"$APP_HOME\" PUPPETEER_CACHE_DIR=\"\${APP_HOME}/.cache/puppeteer\" bash -lc \"cd '\${APP_DIRECTORY}/backend' && npx puppeteer browsers install chrome --install-deps\"\nchown -R \"$APP_USER:$APP_GROUP\" \"\${APP_HOME}/.cache\"`
  );
}

if (!source.includes('# COMPILER_SANDBOX: build-and-service')) {
  replaceRequired(
    'sandbox image and service installation',
    /sudo -u \"\$APP_USER\" bash -lc \"cd '\$\{APP_DIRECTORY\}\/backend' && npm ci --omit=dev\"/,
    `sudo -u \"$APP_USER\" bash -lc \"cd '\${APP_DIRECTORY}/backend' && npm ci --omit=dev\"\n\n# COMPILER_SANDBOX: build-and-service\ndocker build --pull --tag socialbird/compiler-sandbox:latest \"\${APP_DIRECTORY}/deploy/compiler-sandbox\"\ninstall -d -o root -g root -m 0755 /usr/local/lib/socialbird-compiler-runner\ninstall -o root -g root -m 0644 \"\${APP_DIRECTORY}/deploy/compiler-runner/server.mjs\" /usr/local/lib/socialbird-compiler-runner/server.mjs\ninstall -o root -g root -m 0644 \"\${APP_DIRECTORY}/deploy/systemd/socialbird-compiler-runner.service\" /etc/systemd/system/socialbird-compiler-runner.service\nsystemctl daemon-reload\nsystemctl enable --now socialbird-compiler-runner\nfor attempt in {1..20}; do\n  if curl --silent --fail --unix-socket /run/socialbird-compiler/runner.sock http://localhost/health >/dev/null; then\n    break\n  fi\n  if [[ \"$attempt\" -eq 20 ]]; then\n    journalctl -u socialbird-compiler-runner --no-pager -n 100\n    exit 1\n  fi\n  sleep 1\ndone\nCOMPILER_SANDBOX_IMAGE=socialbird/compiler-sandbox:latest node \"\${APP_DIRECTORY}/deploy/compiler-sandbox/smoke-test.mjs\"`
  );
}

source = source.replace(
  /sudo systemctl status nginx mysql coturn pm2-socialbird/,
  'sudo systemctl status nginx mysql coturn docker socialbird-compiler-runner pm2-socialbird'
);
source = source.replace(
  /The online compiler remains disabled until it is moved into an isolated sandbox\./,
  'The online compiler is enabled through disposable, network-isolated Docker sandboxes.'
);

fs.writeFileSync(installerPath, source, 'utf8');
console.log(`Patched deploy/install.sh: ${source !== initialSource ? 'changed' : 'already current'}`);
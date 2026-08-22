import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const deployDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(deployDir, '..');
const originalPath = path.join(deployDir, 'apply-social-next-fixes.mjs');
const tempPath = path.join(deployDir, '.apply-social-next-runtime.generated.mjs');

let runtimeSource = fs.readFileSync(originalPath, 'utf8');
runtimeSource = runtimeSource.replace(
  "if (!source.includes('windowWithCall.__itbirdActiveCallSwitchCamera')) {",
  "if (!source.includes('windowWithCall.__itbirdActiveCallSwitchCamera = () =>')) {",
);

const installStart = runtimeSource.indexOf("\npatch('deploy/install.sh'");
const finalLog = runtimeSource.indexOf("\nconsole.log('Social-next fixes are current.');", installStart);
if (installStart < 0 || finalLog < 0) {
  throw new Error('Social-next v2 could not isolate installer patch');
}
runtimeSource = `${runtimeSource.slice(0, installStart)}\nconsole.log('Social-next runtime fixes are current.');\n`;
fs.writeFileSync(tempPath, runtimeSource, 'utf8');
try {
  await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`);
} finally {
  fs.rmSync(tempPath, { force: true });
}

const installerPath = path.join(root, 'deploy', 'install.sh');
let installer = fs.readFileSync(installerPath, 'utf8');
const before = installer;

if (!installer.includes('qrencode zbar-tools')) {
  installer = installer.replace(
    '  build-essential python3 make g++',
    '  build-essential python3 make g++ qrencode zbar-tools',
  );
}

if (!installer.includes('# SOCIAL_NEXT: preserve-vapid')) {
  const marker = 'BACKEND_ENV="${CONFIG_DIRECTORY}/backend.env"';
  if (installer.includes(marker)) {
    installer = installer.replace(
      marker,
      `${marker}\n# SOCIAL_NEXT: preserve-vapid\nVAPID_PUBLIC_KEY="$(read_env_value VAPID_PUBLIC_KEY "$BACKEND_ENV")"\nVAPID_PRIVATE_KEY="$(read_env_value VAPID_PRIVATE_KEY "$BACKEND_ENV")"\nVAPID_SUBJECT="$(read_env_value VAPID_SUBJECT "$BACKEND_ENV")"`,
    );
  }
}

if (!installer.includes('VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}')) {
  const marker = 'JSON_BODY_LIMIT=2mb';
  if (installer.includes(marker)) {
    installer = installer.replace(
      marker,
      `VAPID_PUBLIC_KEY=\${VAPID_PUBLIC_KEY}\nVAPID_PRIVATE_KEY=\${VAPID_PRIVATE_KEY}\nVAPID_SUBJECT=\${VAPID_SUBJECT}\n${marker}`,
    );
  }
}

if (!installer.includes('node "${APP_DIRECTORY}/deploy/ensure-vapid.mjs"')) {
  const marker = 'chown root:"$APP_GROUP" "$BACKEND_ENV"';
  if (installer.includes(marker)) {
    installer = installer.replace(marker, `${marker}\nnode "\${APP_DIRECTORY}/deploy/ensure-vapid.mjs"`);
  }
}

if (!installer.includes('apply-social-next-v2.mjs')) {
  const preferred = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-mail-recovery-fixes.mjs"';
  const fallback = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/harden-source.mjs"';
  const call = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-social-next-v2.mjs"';
  if (installer.includes(preferred)) installer = installer.replace(preferred, `${preferred}\n${call}`);
  else if (installer.includes(fallback)) installer = installer.replace(fallback, `${call}\n${fallback}`);
}

if (installer !== before) {
  fs.writeFileSync(installerPath, installer, 'utf8');
  console.log('Applied social-next installer fixes.');
}

console.log('Social-next v2 fixes are current.');

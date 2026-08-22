import crypto from 'node:crypto';
import fs from 'node:fs';

const ENV_PATH = '/etc/socialbird/backend.env';

if (typeof process.getuid === 'function' && process.getuid() !== 0) {
  console.error('Run as root so VAPID keys can be stored in /etc/socialbird/backend.env.');
  process.exit(1);
}
if (!fs.existsSync(ENV_PATH)) {
  console.error(`${ENV_PATH} not found.`);
  process.exit(1);
}

const parseEnv = (text) => Object.fromEntries(
  text.split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1)];
    }),
);

const setEnvValue = (text, key, value) => {
  const lines = text.split(/\r?\n/);
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) updated.push(`${key}=${value}`);
  return updated.join('\n').replace(/\n+$/, '') + '\n';
};

let envText = fs.readFileSync(ENV_PATH, 'utf8');
let env = parseEnv(envText);

if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
  const ecdh = crypto.createECDH('prime256v1');
  const publicKey = ecdh.generateKeys().toString('base64url');
  const privateKey = ecdh.getPrivateKey().toString('base64url');
  envText = setEnvValue(envText, 'VAPID_PUBLIC_KEY', publicKey);
  envText = setEnvValue(envText, 'VAPID_PRIVATE_KEY', privateKey);
  env = parseEnv(envText);
}

if (!env.VAPID_SUBJECT) {
  const subject = env.SMTP_USER && env.SMTP_USER.includes('@')
    ? `mailto:${env.SMTP_USER}`
    : 'mailto:admin@socialbird.local';
  envText = setEnvValue(envText, 'VAPID_SUBJECT', subject);
}

fs.writeFileSync(ENV_PATH, envText, { mode: 0o640 });
fs.chmodSync(ENV_PATH, 0o640);
console.log('VAPID keys ready (private key kept secret).');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD_SITE = 'socialbird.31.207.74.138.nip.io';
const OLD_API = 'api.31.207.74.138.nip.io';
const NEW_SITE = 'socialbird.ru';
const NEW_API = 'api.socialbird.ru';

const files = [
  'index.html',
  'public/robots.txt',
  'public/sitemap.xml',
  'scripts/generate-seo.mjs',
  'src/components/SeoManager.tsx',
  'android-app/app/src/main/java/io/itbird/socialbird/MainActivity.java',
  'android-app/app/src/main/java/io/itbird/socialbird/BackgroundMessagingService.java',
  'deploy/install.sh',
  'deploy/update-native-parity-seo.sh',
];

let changed = 0;
for (const relative of files) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  const after = before
    .split(`https://${OLD_SITE}`).join(`https://${NEW_SITE}`)
    .split(`wss://${OLD_API}`).join(`wss://${NEW_API}`)
    .split(`https://${OLD_API}`).join(`https://${NEW_API}`)
    .split(`turns:${OLD_API}`).join(`turns:${NEW_API}`)
    .split(`turn:${OLD_API}`).join(`turn:${NEW_API}`)
    .split(OLD_SITE).join(NEW_SITE)
    .split(OLD_API).join(NEW_API);
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`Migrated domain references: ${relative}`);
    changed += 1;
  }
}

const installPath = path.join(root, 'deploy/install.sh');
if (fs.existsSync(installPath)) {
  let install = fs.readFileSync(installPath, 'utf8');
  install = install
    .replace(/SITE_DOMAIN="\$\{SITE_DOMAIN:-socialbird\.\$\{PUBLIC_IP\}\.nip\.io\}"/, 'SITE_DOMAIN="${SITE_DOMAIN:-socialbird.ru}"')
    .replace(/API_DOMAIN="\$\{API_DOMAIN:-api\.\$\{PUBLIC_IP\}\.nip\.io\}"/, 'API_DOMAIN="${API_DOMAIN:-api.socialbird.ru}"');
  fs.writeFileSync(installPath, install, 'utf8');
}

console.log(`SocialBIRD custom-domain migration is current (${changed} files changed).`);

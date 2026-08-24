import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'backend/server.js');
let source = fs.readFileSync(serverPath, 'utf8');

const requireMarker = "const githubRoutes = require('./routes/github');";
const requires = `${requireMarker}\nconst { registerEmailVerifiedRegistration } = require('./registration-verification');\nconst { registerAdminDesktop } = require('./admin-desktop');\nconst { registerAndroidVersion } = require('./android-version');`;

if (!source.includes("require('./registration-verification')")) {
  if (!source.includes(requireMarker)) throw new Error('Security/admin patch failed: githubRoutes require marker not found');
  source = source.replace(requireMarker, requires);
}

const registrationMarker = '// Регистрация пользователя';
const wiringMarker = '// SOCIALBIRD_SECURITY_ADMIN: email-registration-admin-desktop-android-version';
if (!source.includes(wiringMarker)) {
  if (!source.includes(registrationMarker)) throw new Error('Security/admin patch failed: registration route marker not found');
  const wiring = `${wiringMarker}\nregisterEmailVerifiedRegistration({\n    app,\n    db,\n    transporter,\n    bcrypt,\n    normalizeUserTag,\n    isValidUserTag,\n});\nregisterAdminDesktop({ app, db, transporter, getOnlineUserIds });\nregisterAndroidVersion({ app });\n\n${registrationMarker}`;
  source = source.replace(registrationMarker, wiring);
}

for (const expected of [
  "require('./registration-verification')",
  "require('./admin-desktop')",
  "require('./android-version')",
  wiringMarker,
  'registerEmailVerifiedRegistration({',
  'registerAdminDesktop({ app, db, transporter, getOnlineUserIds });',
  'registerAndroidVersion({ app });',
]) {
  if (!source.includes(expected)) throw new Error(`Security/admin patch verification failed: ${expected}`);
}

fs.writeFileSync(serverPath, source, 'utf8');

const installPath = path.join(root, 'deploy/install.sh');
if (fs.existsSync(installPath)) {
  let install = fs.readFileSync(installPath, 'utf8');
  const applyCall = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-security-admin-update.mjs"';
  const hardenCall = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/harden-source.mjs"';
  if (!install.includes(applyCall)) {
    if (!install.includes(hardenCall)) throw new Error('Security/admin patch failed: installer harden marker not found');
    install = install.replace(hardenCall, `${applyCall}\n${hardenCall}`);
    fs.writeFileSync(installPath, install, 'utf8');
  }
}

console.log('SocialBIRD registration verification, Admin Desktop API and Android version API wiring is current.');

import fs from 'node:fs';

const file = 'backend/server.js';
let source = fs.readFileSync(file, 'utf8');

const replaceOnce = (label, from, to) => {
  if (!source.includes(from)) throw new Error(`Final backend wiring failed: ${label}`);
  source = source.replace(from, to);
};

const earlyMarker = '// SOCIALBIRD_FINAL_PLATFORM_V1: early-middleware';
const routesMarker = '// SOCIALBIRD_FINAL_PLATFORM_V1: final-routes';
const adminCinemaMarker = '// SOCIALBIRD_ADMIN_CINEMA_V1: routes';

if (!source.includes(earlyMarker)) {
  const anchor = 'const app = express();';
  replaceOnce(
    'early middleware anchor',
    anchor,
    `${anchor}\nconst { registerStrictPrivacyGate } = require('./strict-privacy-gate');\nconst { registerStableNewsTime } = require('./stable-news-time');\n\n${earlyMarker}\nregisterStrictPrivacyGate({ app, getDb: () => db });\nregisterStableNewsTime({ app, getDb: () => db });`,
  );
}

if (!source.includes(routesMarker)) {
  const anchor = '// Старт сервера';
  replaceOnce(
    'final route anchor',
    anchor,
    `${routesMarker}\nconst { registerSocialBirdFinalPlatform } = require('./socialbird-final-platform');\nconst { registerCinemaQr } = require('./cinema-qr');\nconst { registerCinemaStream } = require('./cinema-stream');\n\nregisterSocialBirdFinalPlatform({ app, db, verifyToken, transporter, notifyClients });\nregisterCinemaQr({ app, db, verifyToken });\nregisterCinemaStream({ app, db });\n\n${anchor}`,
  );
}

if (!source.includes(adminCinemaMarker)) {
  const anchor = 'registerCinemaStream({ app, db });';
  replaceOnce(
    'admin cinema route anchor',
    anchor,
    `${anchor}\n\n${adminCinemaMarker}\nconst { registerAdminCinemaLibrary } = require('./admin-cinema-library');\nregisterAdminCinemaLibrary({ app, db });`,
  );
}

for (const required of [
  earlyMarker,
  routesMarker,
  adminCinemaMarker,
  "require('./strict-privacy-gate')",
  "require('./stable-news-time')",
  "require('./socialbird-final-platform')",
  "require('./cinema-qr')",
  "require('./cinema-stream')",
  "require('./admin-cinema-library')",
  'registerSocialBirdFinalPlatform({ app, db, verifyToken, transporter, notifyClients })',
]) {
  if (!source.includes(required)) throw new Error(`Final backend invariant missing: ${required}`);
}

fs.writeFileSync(file, source, 'utf8');
console.log('Final backend wiring V1 applied: privacy middleware, final platform, C-Party routes and Admin Cinema are preserved.');

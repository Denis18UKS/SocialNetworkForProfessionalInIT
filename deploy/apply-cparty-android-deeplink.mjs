import fs from 'node:fs';

const file = 'android-app/app/src/main/java/io/itbird/socialbird/MainActivity.java';
let source = fs.readFileSync(file, 'utf8');
const marker = '// CPARTY_ANDROID_DEEPLINK_V1: canonical-socialbird-origin';

if (!source.includes(marker)) {
  const oldConstants = '    private static final String SITE_ORIGIN = "https://socialbird.31.207.74.138.nip.io";\n    private static final String SITE_HOST = "socialbird.31.207.74.138.nip.io";';
  const newConstants = `    ${marker}\n    private static final String SITE_ORIGIN = "https://socialbird.ru";\n    private static final String SITE_HOST = "socialbird.ru";\n    private static final String LEGACY_SITE_HOST = "socialbird.31.207.74.138.nip.io";`;
  if (!source.includes(oldConstants)) throw new Error('C-Party Android patch failed: site constants');
  source = source.replace(oldConstants, newConstants);

  const oldTrusted = '            && SITE_HOST.equalsIgnoreCase(uri.getHost());';
  const newTrusted = '            && (SITE_HOST.equalsIgnoreCase(uri.getHost()) || LEGACY_SITE_HOST.equalsIgnoreCase(uri.getHost()));';
  if (!source.includes(oldTrusted)) throw new Error('C-Party Android patch failed: trusted host predicate');
  source = source.replace(oldTrusted, newTrusted);
}

for (const expected of [marker, 'SITE_ORIGIN = "https://socialbird.ru"', 'LEGACY_SITE_HOST', 'SITE_HOST.equalsIgnoreCase(uri.getHost()) || LEGACY_SITE_HOST.equalsIgnoreCase(uri.getHost())']) {
  if (!source.includes(expected)) throw new Error(`C-Party Android verification failed: ${expected}`);
}

fs.writeFileSync(file, source, 'utf8');
console.log('C-Party Android deep links now preserve socialbird.ru room/invite URLs and keep the legacy nip.io host trusted.');

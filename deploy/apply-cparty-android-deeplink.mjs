import fs from 'node:fs';

const file = 'android-app/app/src/main/java/io/itbird/socialbird/MainActivity.java';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const marker = '// CPARTY_ANDROID_DEEPLINK_V1: canonical-socialbird-origin';

const oldConstants = '    private static final String SITE_ORIGIN = "https://socialbird.31.207.74.138.nip.io";\n    private static final String SITE_HOST = "socialbird.31.207.74.138.nip.io";';
const canonicalConstants = '    private static final String SITE_ORIGIN = "https://socialbird.ru";\n    private static final String SITE_HOST = "socialbird.ru";';
const patchedConstants = `    ${marker}\n    private static final String SITE_ORIGIN = "https://socialbird.ru";\n    private static final String SITE_HOST = "socialbird.ru";\n    private static final String LEGACY_SITE_HOST = "socialbird.31.207.74.138.nip.io";`;

if (!source.includes(marker)) {
  if (source.includes(oldConstants)) {
    source = source.replace(oldConstants, patchedConstants);
  } else if (source.includes(canonicalConstants)) {
    // Native FCM wiring may already have promoted socialbird.ru before this patch.
    source = source.replace(canonicalConstants, patchedConstants);
  } else if (source.includes('private static final String LEGACY_SITE_HOST = "socialbird.31.207.74.138.nip.io";')) {
    // Accept a previously patched equivalent and only add the marker.
    source = source.replace(
      '    private static final String SITE_ORIGIN = "https://socialbird.ru";',
      `    ${marker}\n    private static final String SITE_ORIGIN = "https://socialbird.ru";`,
    );
  } else {
    throw new Error('C-Party Android patch failed: site constants');
  }
}

const oldTrusted = '            && SITE_HOST.equalsIgnoreCase(uri.getHost());';
const newTrusted = '            && (SITE_HOST.equalsIgnoreCase(uri.getHost()) || LEGACY_SITE_HOST.equalsIgnoreCase(uri.getHost()));';
if (source.includes(oldTrusted)) source = source.replace(oldTrusted, newTrusted);

for (const expected of [
  marker,
  'SITE_ORIGIN = "https://socialbird.ru"',
  'SITE_HOST = "socialbird.ru"',
  'LEGACY_SITE_HOST',
  'SITE_HOST.equalsIgnoreCase(uri.getHost()) || LEGACY_SITE_HOST.equalsIgnoreCase(uri.getHost())',
]) {
  if (!source.includes(expected)) throw new Error(`C-Party Android verification failed: ${expected}`);
}

fs.writeFileSync(file, source, 'utf8');
console.log('C-Party Android deep links now preserve socialbird.ru room/invite URLs and keep the legacy nip.io host trusted.');

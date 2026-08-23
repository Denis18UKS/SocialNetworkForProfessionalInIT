import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const patch = (relativePath, transform) => {
  const filePath = path.join(root, relativePath);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    console.log(`Applied native FCM Android patch: ${relativePath}`);
  } else {
    console.log(`Native FCM Android patch already current: ${relativePath}`);
  }
};

patch('android-app/app/src/main/java/io/itbird/socialbird/MainActivity.java', (input) => {
  let source = input
    .replace('private static final String SITE_ORIGIN = "https://socialbird.31.207.74.138.nip.io";', 'private static final String SITE_ORIGIN = "https://socialbird.ru";')
    .replace('private static final String SITE_HOST = "socialbird.31.207.74.138.nip.io";', 'private static final String SITE_HOST = "socialbird.ru";');

  const oldSync = `                if (!normalized.isEmpty()) ensureNotificationPermission();\n                BackgroundMessagingService.syncAuth(MainActivity.this, normalized);`;
  const newSync = `                if (!normalized.isEmpty()) ensureNotificationPermission();\n                // NATIVE_FCM_PUSH: same JWT session registers the Android FCM token.\n                NativePushRegistrar.syncAuth(MainActivity.this, normalized);\n                BackgroundMessagingService.syncAuth(MainActivity.this, normalized);`;
  if (source.includes(oldSync)) source = source.replace(oldSync, newSync);
  return source;
});

patch('android-app/app/src/main/java/io/itbird/socialbird/BackgroundMessagingService.java', (input) => input
  .replace('private static final String WS_URL = "wss://api.31.207.74.138.nip.io";', 'private static final String WS_URL = "wss://api.socialbird.ru";'));

console.log('Native FCM Android runtime wiring is current.');

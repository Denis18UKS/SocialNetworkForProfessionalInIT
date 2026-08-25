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
  const newSync = `                if (!normalized.isEmpty()) ensureNotificationPermission();\n                // NATIVE_FCM_PUSH: same JWT session registers the Android FCM token.\n                NativePushRegistrar.syncAuth(MainActivity.this, normalized);\n                // The legacy native socket is retained only as a call-lifecycle fallback.\n                // With Firebase configured, syncAuth persists the token without keeping an\n                // always-on background WebSocket/foreground notification alive.\n                BackgroundMessagingService.syncAuth(MainActivity.this, normalized);`;
  if (source.includes(oldSync)) source = source.replace(oldSync, newSync);
  return source;
});

patch('android-app/app/src/main/java/io/itbird/socialbird/SocialBirdFirebaseMessagingService.java', (input) => {
  // NATIVE_FCM_PUSH: canonical-push-origin
  // A WebView session is origin-scoped. Opening the old nip.io host from a push made
  // localStorage/JWT look empty even though the user was signed in on socialbird.ru.
  return input.replace(
    'private static final String SITE_ORIGIN = "https://socialbird.31.207.74.138.nip.io";',
    'private static final String SITE_ORIGIN = "https://socialbird.ru";'
  );
});

patch('android-app/app/src/main/java/io/itbird/socialbird/BackgroundMessagingService.java', (input) => {
  let source = input
    .replace('private static final String WS_URL = "wss://api.31.207.74.138.nip.io";', 'private static final String WS_URL = "wss://api.socialbird.ru";')
    .replace('Uri.parse("https://socialbird.31.207.74.138.nip.io" + normalized)', 'Uri.parse("https://socialbird.ru" + normalized)');

  if (!source.includes('NATIVE_FCM_PUSH: no-persistent-socket')) {
    const marker = `        if (normalized.isEmpty()) {\n            context.stopService(new Intent(context, BackgroundMessagingService.class));\n            dismissIncomingCallNotification(context);\n            return;\n        }\n\n        Intent intent = new Intent(context, BackgroundMessagingService.class)`;
    const replacement = `        if (normalized.isEmpty()) {\n            context.stopService(new Intent(context, BackgroundMessagingService.class));\n            dismissIncomingCallNotification(context);\n            return;\n        }\n\n        // NATIVE_FCM_PUSH: no-persistent-socket\n        // FCM is the primary background transport. Persist the JWT so a system\n        // Decline action can authenticate, but do not keep a second always-on\n        // WebSocket/foreground service running just to wait for notifications.\n        if (SocialBirdApplication.hasFirebaseConfig()) {\n            context.stopService(new Intent(context, BackgroundMessagingService.class));\n            return;\n        }\n\n        Intent intent = new Intent(context, BackgroundMessagingService.class)`;
    if (!source.includes(marker)) throw new Error('Native FCM Android patch failed: syncAuth fallback marker');
    source = source.replace(marker, replacement);
  }

  if (!source.includes('NATIVE_FCM_PUSH: stop-idle-call-service')) {
    const marker = `        } else if (ACTION_CALL_STATE.equals(action)) {\n            setCallWakeLock(intent.getBooleanExtra(EXTRA_CALL_ACTIVE, false));\n            updateBackgroundNotification();\n        }`;
    const replacement = `        } else if (ACTION_CALL_STATE.equals(action)) {\n            boolean active = intent.getBooleanExtra(EXTRA_CALL_ACTIVE, false);\n            setCallWakeLock(active);\n            updateBackgroundNotification();\n            // NATIVE_FCM_PUSH: stop-idle-call-service\n            if (!active && SocialBirdApplication.hasFirebaseConfig()) {\n                stopping = true;\n                stopSelf();\n                return START_NOT_STICKY;\n            }\n        }`;
    if (!source.includes(marker)) throw new Error('Native FCM Android patch failed: call state marker');
    source = source.replace(marker, replacement);
  }

  if (!source.includes('NATIVE_FCM_PUSH: stop-after-decline')) {
    const marker = `            if (activeSocket.send(payload.toString())) pendingDecline = null;`;
    const replacement = `            if (activeSocket.send(payload.toString())) {\n                pendingDecline = null;\n                // NATIVE_FCM_PUSH: stop-after-decline\n                if (SocialBirdApplication.hasFirebaseConfig() && !isCallWakeLockHeld()) {\n                    handler.postDelayed(() -> {\n                        if (pendingDecline == null && !isCallWakeLockHeld()) {\n                            stopping = true;\n                            stopSelf();\n                        }\n                    }, 750L);\n                }\n            }`;
    if (!source.includes(marker)) throw new Error('Native FCM Android patch failed: decline marker');
    source = source.replace(marker, replacement);
  }

  return source;
});

const fcmService = fs.readFileSync(path.join(root, 'android-app/app/src/main/java/io/itbird/socialbird/SocialBirdFirebaseMessagingService.java'), 'utf8');
const backgroundService = fs.readFileSync(path.join(root, 'android-app/app/src/main/java/io/itbird/socialbird/BackgroundMessagingService.java'), 'utf8');
if (!fcmService.includes('private static final String SITE_ORIGIN = "https://socialbird.ru";')) {
  throw new Error('Native FCM Android patch failed: FCM push still uses a non-canonical origin');
}
if (!backgroundService.includes('Uri.parse("https://socialbird.ru" + normalized)')) {
  throw new Error('Native FCM Android patch failed: background notification still uses a non-canonical origin');
}

console.log('Native FCM Android runtime wiring is current. All push/deep-link entry points stay on socialbird.ru so the signed-in WebView session is preserved.');

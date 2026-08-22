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
    console.log(`Applied native Android integration: ${relativePath}`);
  } else {
    console.log(`Native Android integration already current: ${relativePath}`);
  }
};

const replaceRequired = (source, label, from, to) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Native Android integration failed: ${label}`);
  return source.replace(from, to);
};

patch('backend/server.js', (input) => {
  let source = input;
  if (!source.includes('NATIVE_ANDROID: notification-only-auth')) {
    const marker = `            if (payload.type === 'AUTH' && payload.token) {`;
    const block = `            // NATIVE_ANDROID: notification-only-auth\n            // The Android foreground listener receives targeted notifications but is\n            // intentionally NOT added to onlineUsers and does not consume durable\n            // CALL_INVITE/OFFER/ICE rows. The WebView remains the interactive client.\n            if (payload.type === 'AUTH_NATIVE' && payload.token) {\n                const decoded = jwt.verify(payload.token, process.env.JWT_SECRET);\n                ws.userId = Number(decoded.id);\n                ws.nativeNotificationSocket = true;\n                ws.send(JSON.stringify({ type: 'NATIVE_AUTH_OK', data: { userId: Number(decoded.id) } }));\n                return;\n            }\n\n${marker}`;
    source = replaceRequired(source, 'native websocket auth', marker, block);
  }
  return source;
});

patch('src/App.tsx', (input) => {
  let source = input;
  if (!source.includes("import NativeAppBridge from './components/NativeAppBridge';")) {
    const marker = "import PushCallRegistration from './components/PushCallRegistration';";
    source = replaceRequired(
      source,
      'NativeAppBridge import',
      marker,
      `${marker}\nimport NativeAppBridge from './components/NativeAppBridge';`,
    );
  }
  if (!source.includes('<NativeAppBridge />')) {
    source = replaceRequired(
      source,
      'NativeAppBridge mount',
      '    <>\n      <RealtimeNotifications />',
      '    <>\n      <NativeAppBridge />\n      <RealtimeNotifications />',
    );
  }
  return source;
});

const patchNativePip = (relativePath) => {
  patch(relativePath, (input) => {
    let source = input;
    if (source.includes('NATIVE_ANDROID: picture-in-picture')) return source;
    const marker = '  const openCallPictureInPicture = async () => {';
    if (!source.includes(marker)) return source;
    return source.replace(
      marker,
      `${marker}\n    // NATIVE_ANDROID: picture-in-picture\n    const nativeBridge = (window as typeof window & { ITBirdAndroid?: { enterPictureInPicture?: () => void } }).ITBirdAndroid;\n    if (nativeBridge?.enterPictureInPicture) {\n      nativeBridge.enterPictureInPicture();\n      return;\n    }`,
    );
  });
};

patchNativePip('src/components/VoiceCallControls.tsx');
patchNativePip('src/components/RealtimeNotifications.tsx');

patch('src/components/RealtimeNotifications.tsx', (input) => {
  let source = input;
  if (!source.includes('NATIVE_ANDROID: incoming-call-state')) {
    const activeMarker = '      setActiveCall(incomingCall);';
    if (source.includes(activeMarker)) {
      source = source.replace(
        activeMarker,
        `${activeMarker}\n      // NATIVE_ANDROID: incoming-call-state\n      window.dispatchEvent(new CustomEvent('itbird-native-call-state', { detail: { active: true } }));`,
      );
    }

    const cleanupMarker = '    setActiveCall(null);';
    if (source.includes(cleanupMarker)) {
      source = source.replace(
        cleanupMarker,
        `${cleanupMarker}\n    window.dispatchEvent(new CustomEvent('itbird-native-call-state', { detail: { active: false } }));`,
      );
    }
  }
  return source;
});

patch('deploy/install.sh', (input) => {
  let source = input;
  if (!source.includes('apply-native-android-integration.mjs')) {
    const preferred = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-call-hangup-lifecycle-fix.mjs"';
    const fallback = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/harden-source.mjs"';
    const call = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-native-android-integration.mjs"';
    if (source.includes(preferred)) source = source.replace(preferred, `${preferred}\n${call}`);
    else if (source.includes(fallback)) source = source.replace(fallback, `${call}\n${fallback}`);
    else console.warn('Native Android installer hook skipped: no known patch marker found');
  }
  return source;
});

console.log('Native Android integration is current.');

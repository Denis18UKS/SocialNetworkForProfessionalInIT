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
    const block = `            // NATIVE_ANDROID: notification-only-auth\n            // Android owns OS-level background ringing/notifications only. It does not\n            // become an interactive presence socket and never consumes WebRTC replay.\n            if (payload.type === 'AUTH_NATIVE' && payload.token) {\n                const decoded = jwt.verify(payload.token, process.env.JWT_SECRET);\n                ws.userId = Number(decoded.id);\n                ws.clientRole = 'android-native';\n                ws.nativeNotificationSocket = true;\n                ws.send(JSON.stringify({ type: 'NATIVE_AUTH_OK', data: { userId: Number(decoded.id) } }));\n                return;\n            }\n\n${marker}`;
    source = replaceRequired(source, 'native websocket auth', marker, block);
  }

  if (!source.includes('NATIVE_ANDROID: role-aware-web-auth')) {
    const decodedMarker = `                const decoded = jwt.verify(payload.token, process.env.JWT_SECRET);\n                addOnlineSocket(decoded.id, ws);`;
    if (source.includes(decodedMarker)) {
      source = source.replace(
        decodedMarker,
        `                const decoded = jwt.verify(payload.token, process.env.JWT_SECRET);\n                // NATIVE_ANDROID: role-aware-web-auth\n                ws.clientRole = String(payload.clientRole || 'generic');\n                addOnlineSocket(decoded.id, ws);`,
      );
    } else if (!source.includes(`ws.clientRole = String(payload.clientRole || 'generic')`)) {
      throw new Error('Native Android integration failed: role-aware AUTH marker');
    }
  }

  // There can be more than one authenticated WebSocket in one page (global host +
  // local call controls). Only the global host may consume durable INVITE/OFFER/ICE,
  // otherwise a local component can steal the queued mobile call before the incoming
  // call dialog sees it.
  const replayLine = `                void deliverPendingCallSignals(decoded.id, ws);`;
  const guardedReplay = `                // NATIVE_ANDROID: durable-call-replay-owner\n                if (ws.clientRole === 'call-host') {\n                    void deliverPendingCallSignals(decoded.id, ws);\n                }`;
  if (source.includes(replayLine) && !source.includes('NATIVE_ANDROID: durable-call-replay-owner')) {
    source = source.replace(replayLine, guardedReplay);
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

patch('src/components/PushCallRegistration.tsx', (input) => {
  let source = input;
  if (!source.includes('isNativeAndroidApp')) {
    const marker = 'import { useAuth } from "@/pages/AuthContext";';
    source = replaceRequired(
      source,
      'native push import',
      marker,
      `${marker}\nimport { isNativeAndroidApp } from "@/lib/screen-share";`,
    );
  }

  if (!source.includes('NATIVE_ANDROID: native-notifications-own-background')) {
    const marker = `  useEffect(() => {\n    if (!isAuthenticated) {`;
    source = replaceRequired(
      source,
      'skip web push inside APK',
      marker,
      `  useEffect(() => {\n    // NATIVE_ANDROID: native-notifications-own-background\n    // The APK uses the Android foreground notification/signalling service. Registering\n    // Web Push in WebView would create duplicate call/message notifications.\n    if (isNativeAndroidApp()) {\n      setShowPrompt(false);\n      return;\n    }\n    if (!isAuthenticated) {`,
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

patch('src/components/VoiceCallControls.tsx', (input) => {
  let source = input;
  const simpleAuth = `socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token }));`;
  const roleAuth = `socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token, clientRole: "call-control" }));`;
  if (source.includes(simpleAuth)) source = source.replace(simpleAuth, roleAuth);
  return source;
});

patch('src/components/RealtimeNotifications.tsx', (input) => {
  let source = input;

  const multilineAuth = `    socket.onopen = () => {\n      socket.send(JSON.stringify({ type: "AUTH", token }));\n    };`;
  const multilineRoleAuth = `    socket.onopen = () => {\n      // NATIVE_ANDROID: global-call-host\n      socket.send(JSON.stringify({ type: "AUTH", token, clientRole: "call-host" }));\n    };`;
  if (source.includes(multilineAuth)) source = source.replace(multilineAuth, multilineRoleAuth);
  const simpleAuth = `socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token }));`;
  if (source.includes(simpleAuth)) {
    source = source.replace(
      simpleAuth,
      `socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token, clientRole: "call-host" }));`,
    );
  }

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

  if (!source.includes('nativeAutoAnswerRef')) {
    const candidates = [
      '  const ringtoneTimerRef = useRef<number | null>(null);',
      '  const suppressIncomingDialogDeclineRef = useRef(false);',
    ];
    const marker = candidates.find((candidate) => source.includes(candidate));
    if (!marker) throw new Error('Native Android integration failed: native auto-answer ref marker');
    source = source.replace(marker, `${marker}\n  const nativeAutoAnswerRef = useRef(false);`);
  }

  if (!source.includes('NATIVE_ANDROID: answer-from-system-notification')) {
    const marker = '  const declineIncomingCall = () => {';
    if (!source.includes(marker)) throw new Error('Native Android integration failed: decline marker');
    const block = `  // NATIVE_ANDROID: answer-from-system-notification\n  // The Android notification Answer action only requests an answer. The same React\n  // WebRTC code still creates/owns the peer connection, so website and APK never fork.\n  useEffect(() => {\n    const requestNativeAnswer = () => {\n      nativeAutoAnswerRef.current = true;\n      try { sessionStorage.removeItem('itbird-native-answer-call'); } catch {}\n    };\n\n    try {\n      if (sessionStorage.getItem('itbird-native-answer-call') === '1') requestNativeAnswer();\n    } catch {}\n    window.addEventListener('itbird-native-answer-call', requestNativeAnswer);\n    return () => window.removeEventListener('itbird-native-answer-call', requestNativeAnswer);\n  }, []);\n\n  useEffect(() => {\n    if (!nativeAutoAnswerRef.current || !incomingCall || !offerReady) return;\n    nativeAutoAnswerRef.current = false;\n    void acceptIncomingCall();\n  }, [incomingCall, offerReady]);\n\n${marker}`;
    source = source.replace(marker, block);
  }

  return source;
});

patch('deploy/install.sh', (input) => {
  let source = input;
  if (!source.includes('apply-native-android-integration.mjs')) {
    const preferred = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-single-camera-tile-fix.mjs"';
    const alternative = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-call-hangup-lifecycle-fix.mjs"';
    const fallback = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/harden-source.mjs"';
    const call = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-native-android-integration.mjs"';
    if (source.includes(preferred)) source = source.replace(preferred, `${preferred}\n${call}`);
    else if (source.includes(alternative)) source = source.replace(alternative, `${alternative}\n${call}`);
    else if (source.includes(fallback)) source = source.replace(fallback, `${call}\n${fallback}`);
    else console.warn('Native Android installer hook skipped: no known patch marker found');
  }
  return source;
});

console.log('Native Android integration is current.');

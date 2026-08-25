import fs from 'node:fs';

const realtimeFile = 'src/components/RealtimeNotifications.tsx';
let realtime = fs.readFileSync(realtimeFile, 'utf8').replace(/\r\n/g, '\n');
const marker = '// SOCIALBIRD_CALL_SYSTEM_V4: CallProvider owns CALL_* signalling';

if (!realtime.includes(marker)) {
  const pattern = /(\s+const notification = JSON\.parse\(event\.data\);\n)/;
  if (!pattern.test(realtime)) {
    throw new Error('Call system V4 patch failed: RealtimeNotifications websocket parse anchor not found');
  }
  realtime = realtime.replace(
    pattern,
    `$1\n      ${marker}\n      if (String(notification.type || '').startsWith('CALL_')) return;\n`,
  );
  fs.writeFileSync(realtimeFile, realtime, 'utf8');
}

const providerFile = 'src/components/call/CallProvider.tsx';
let provider = fs.readFileSync(providerFile, 'utf8').replace(/\r\n/g, '\n');

// The backend replays durable mobile INVITE/OFFER/ICE only to the single call host.
const oldAuth = '    socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token }));';
const callHostAuth = '    socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token, clientRole: "call-host" }));';
if (provider.includes(oldAuth)) provider = provider.replace(oldAuth, callHostAuth);

// Existing Android runtime builds already dispatch this event after the explicit
// Answer action. Keep it as a supported input alongside FCM/PWA action messages and
// the sb_call_action=answer deep-link fallback.
const nativeRuntimeMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: legacy-native-answer-event';
if (!provider.includes(nativeRuntimeMarker)) {
  const anchor = `  }, [acceptIncoming, declineIncoming]);\n\n  useEffect(() => {\n    const timer = window.setInterval(() => {`;
  if (!provider.includes(anchor)) {
    throw new Error('Call system V4 patch failed: native-answer insertion anchor not found');
  }
  const block = `  }, [acceptIncoming, declineIncoming]);\n\n  // SOCIALBIRD_CALL_SYSTEM_V4: legacy-native-answer-event\n  useEffect(() => {\n    const acceptFromNativeRuntime = () => {\n      autoAnswerRef.current = true;\n      try { sessionStorage.removeItem("itbird-native-answer-call"); } catch {}\n      if (incomingRef.current) void acceptIncoming();\n    };\n\n    let pending = false;\n    try { pending = sessionStorage.getItem("itbird-native-answer-call") === "1"; } catch {}\n    if (pending) acceptFromNativeRuntime();\n\n    window.addEventListener("itbird-native-answer-call", acceptFromNativeRuntime);\n    return () => window.removeEventListener("itbird-native-answer-call", acceptFromNativeRuntime);\n  }, [acceptIncoming]);\n\n  useEffect(() => {\n    const timer = window.setInterval(() => {`;
  provider = provider.replace(anchor, block);
}

if (provider !== fs.readFileSync(providerFile, 'utf8').replace(/\r\n/g, '\n')) {
  fs.writeFileSync(providerFile, provider, 'utf8');
}

const requiredFiles = [
  providerFile,
  'src/components/call/NativeCallAudioBridge.tsx',
  'src/components/call/PushCallDeepLinkBridge.tsx',
  'src/components/VoiceCallControls.tsx',
  'src/components/GlobalCallOverlay.tsx',
  'src/App.tsx',
  'src/lib/webrtc.ts',
  'src/lib/screen-share.ts',
  'public/sw.js',
];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Call system V4 missing file: ${file}`);
}

provider = fs.readFileSync(providerFile, 'utf8');
const overlay = fs.readFileSync('src/components/GlobalCallOverlay.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const webrtc = fs.readFileSync('src/lib/webrtc.ts', 'utf8');
const sw = fs.readFileSync('public/sw.js', 'utf8');

for (const expected of [
  'export const CallProvider',
  'CALL_SCREEN_START',
  'switchCamera',
  'itbird-native-call-action',
  'itbird-native-answer-call',
  'clientRole: "call-host"',
  'createSpeakingMonitor',
]) {
  if (!provider.includes(expected)) throw new Error(`Call system V4 provider verification failed: ${expected}`);
}
for (const expected of ['Перевернуть камеру', 'Демонстрация экрана', 'Говорит', 'разговорный динамик']) {
  if (!overlay.includes(expected)) throw new Error(`Call system V4 overlay verification failed: ${expected}`);
}
for (const expected of ['<CallProvider>', '<NativeCallAudioBridge />', '<PushCallDeepLinkBridge />']) {
  if (!app.includes(expected)) throw new Error(`Call system V4 App verification failed: ${expected}`);
}
if (!webrtc.includes('CameraFacingMode') || !webrtc.includes('facingMode')) {
  throw new Error('Call system V4 mobile camera controls missing');
}
const hasPushActionBridge = sw.includes('ITBIRD_PUSH_CALL_OPEN')
  && sw.includes("callAction = action === 'answer' ? 'answer' : 'open'")
  && sw.includes('action: callAction');
if (!hasPushActionBridge) {
  throw new Error('Call system V4 PWA push-answer bridge missing');
}
if (!realtime.includes(marker)) throw new Error('Call system V4 realtime isolation marker missing');

console.log('Call system V4 applied: one CallProvider owns signalling/media, durable replay uses call-host, Android/PWA answer paths are unified and legacy RealtimeNotifications CALL_* handling is disabled.');

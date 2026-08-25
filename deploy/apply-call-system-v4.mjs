import fs from 'node:fs';

const normalize = (value) => value.replace(/\r\n/g, '\n');

// -----------------------------------------------------------------------------
// 1. Legacy frontend call ownership: RealtimeNotifications must never create a
// second WebRTC stack. It may still receive CALL_* on its generic websocket, but
// CallProvider is the sole consumer.
// -----------------------------------------------------------------------------
const realtimeFile = 'src/components/RealtimeNotifications.tsx';
let realtime = normalize(fs.readFileSync(realtimeFile, 'utf8'));
const realtimeMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: CallProvider owns CALL_* signalling';

if (!realtime.includes(realtimeMarker)) {
  const pattern = /(\s+const notification = JSON\.parse\(event\.data\);\n)/;
  if (!pattern.test(realtime)) {
    throw new Error('Call system V4 patch failed: RealtimeNotifications websocket parse anchor not found');
  }
  realtime = realtime.replace(
    pattern,
    `$1\n      ${realtimeMarker}\n      if (String(notification.type || '').startsWith('CALL_')) return;\n`,
  );
  fs.writeFileSync(realtimeFile, realtime, 'utf8');
}

// -----------------------------------------------------------------------------
// 2. One global call host + every Android/PWA answer path.
// -----------------------------------------------------------------------------
const providerFile = 'src/components/call/CallProvider.tsx';
let provider = normalize(fs.readFileSync(providerFile, 'utf8'));
const providerBefore = provider;

const oldAuth = '    socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token }));';
const callHostAuth = '    socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token, clientRole: "call-host" }));';
if (provider.includes(oldAuth)) provider = provider.replace(oldAuth, callHostAuth);

const nativeRuntimeMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: legacy-native-answer-event';
if (!provider.includes(nativeRuntimeMarker)) {
  const anchor = `  }, [acceptIncoming, declineIncoming]);\n\n  useEffect(() => {\n    const timer = window.setInterval(() => {`;
  if (!provider.includes(anchor)) {
    throw new Error('Call system V4 patch failed: native-answer insertion anchor not found');
  }
  const block = `  }, [acceptIncoming, declineIncoming]);\n\n  // SOCIALBIRD_CALL_SYSTEM_V4: legacy-native-answer-event\n  useEffect(() => {\n    const acceptFromNativeRuntime = () => {\n      autoAnswerRef.current = true;\n      try { sessionStorage.removeItem("itbird-native-answer-call"); } catch {}\n      if (incomingRef.current) void acceptIncoming();\n    };\n\n    let pending = false;\n    try { pending = sessionStorage.getItem("itbird-native-answer-call") === "1"; } catch {}\n    if (pending) acceptFromNativeRuntime();\n\n    window.addEventListener("itbird-native-answer-call", acceptFromNativeRuntime);\n    return () => window.removeEventListener("itbird-native-answer-call", acceptFromNativeRuntime);\n  }, [acceptIncoming]);\n\n  useEffect(() => {\n    const timer = window.setInterval(() => {`;
  provider = provider.replace(anchor, block);
}

if (provider !== providerBefore) fs.writeFileSync(providerFile, provider, 'utf8');

// -----------------------------------------------------------------------------
// 3. Durable mobile signaling. A sleeping Android/WebView socket can remain in the
// server presence map even though JS cannot consume INVITE/OFFER/ICE. V4 stores the
// short signaling path for every target and replays it only to the single call-host.
// -----------------------------------------------------------------------------
const queueFile = 'backend/offline-call-queue.js';
let queue = normalize(fs.readFileSync(queueFile, 'utf8'));

if (!queue.includes('SOCIALBIRD_CALL_SYSTEM_V4: durable-signals')) {
  const oldTargets = `            if (!['CALL_INVITE', 'CALL_OFFER', 'CALL_ICE', 'CALL_RELAY_TRACK'].includes(type)) return;\n            const offlineTargets = uniqueTargets.filter((userId) => !isUserOnline(userId));\n            if (offlineTargets.length === 0) return;\n\n            for (const targetUserId of offlineTargets) {`;
  const durableTargets = `            if (!['CALL_INVITE', 'CALL_OFFER', 'CALL_ICE', 'CALL_RELAY_TRACK'].includes(type)) return;\n\n            // SOCIALBIRD_CALL_SYSTEM_V4: durable-signals\n            // Persist even when presence says online: suspended mobile WebViews can\n            // leave an OPEN socket behind while no JavaScript is actually consuming it.\n            for (const targetUserId of uniqueTargets) {`;
  if (!queue.includes(oldTargets)) throw new Error('Call system V4 queue patch failed: target selection');
  queue = queue.replace(oldTargets, durableTargets);
}

if (!queue.includes('SOCIALBIRD_CALL_SYSTEM_V4: accepted-call-cleanup')) {
  const expiryLine = `            await db.query('DELETE FROM pending_call_signals WHERE expires_at <= NOW()');`;
  const firstIndex = queue.indexOf(expiryLine, queue.indexOf('const queueOfflineCallSignal'));
  if (firstIndex < 0) throw new Error('Call system V4 queue patch failed: cleanup anchor');
  const insertAt = firstIndex + expiryLine.length;
  const cleanup = `\n\n            // SOCIALBIRD_CALL_SYSTEM_V4: accepted-call-cleanup\n            // A callee answering/accepting carries initiatorId. Remove caller -> callee\n            // durable rows immediately so a later reconnect cannot resurrect the call.\n            const originalCallerId = Number(data?.initiatorId || data?.originalCallerId || data?.senderId);\n            if (['CALL_ACCEPT', 'CALL_ANSWER', 'CALL_HANGUP'].includes(type)\n                && originalCallerId > 0\n                && originalCallerId !== Number(senderId)) {\n                const incomingCallKey = buildCallKey(originalCallerId, data);\n                await db.query(\n                    'DELETE FROM pending_call_signals WHERE target_user_id = ? AND sender_user_id = ? AND call_key = ?',\n                    [Number(senderId), originalCallerId, incomingCallKey]\n                );\n            }`;
  queue = `${queue.slice(0, insertAt)}${cleanup}${queue.slice(insertAt)}`;
}
fs.writeFileSync(queueFile, queue, 'utf8');

const serverFile = 'backend/server.js';
let server = normalize(fs.readFileSync(serverFile, 'utf8'));

if (!server.includes("registerOfflineCallQueue")) {
  const importAnchor = "const { runSandboxedCompilerJob } = require('./compiler-client');";
  if (!server.includes(importAnchor)) throw new Error('Call system V4 backend patch failed: import anchor');
  server = server.replace(
    importAnchor,
    `${importAnchor}\nconst { registerOfflineCallQueue } = require('./offline-call-queue');`,
  );
}

if (!server.includes('SOCIALBIRD_CALL_SYSTEM_V4: offline-call-function-refs')) {
  const onlineAnchor = 'const isUserOnline = (userId) => onlineUsers.has(Number(userId));';
  if (!server.includes(onlineAnchor)) throw new Error('Call system V4 backend patch failed: online predicate');
  server = server.replace(
    onlineAnchor,
    `${onlineAnchor}\n// SOCIALBIRD_CALL_SYSTEM_V4: offline-call-function-refs\nlet queueOfflineCallSignal = async () => {};\nlet deliverPendingCallSignals = async () => {};`,
  );
}

if (!server.includes('SOCIALBIRD_CALL_SYSTEM_V4: call-host-replay')
    && !server.includes('NATIVE_ANDROID: durable-call-replay-owner')) {
  const roleAware = `                ws.clientRole = String(payload.clientRole || 'generic');\n                addOnlineSocket(decoded.id, ws);`;
  const replay = `${roleAware}\n                // SOCIALBIRD_CALL_SYSTEM_V4: call-host-replay\n                if (ws.clientRole === 'call-host') {\n                    void deliverPendingCallSignals(decoded.id, ws);\n                }`;
  if (!server.includes(roleAware)) throw new Error('Call system V4 backend patch failed: role-aware AUTH');
  server = server.replace(roleAware, replay);
}

if (!server.includes('SOCIALBIRD_CALL_SYSTEM_V4: queue-call-signals')) {
  const notifyBlock = `                notifyClients({\n                    type: payload.type,\n                    data: {\n                        ...payload.data,\n                        senderId: Number(ws.userId),\n                        targetIds,\n                    },\n                });`;
  if (!server.includes(notifyBlock)) throw new Error('Call system V4 backend patch failed: CALL notify block');
  server = server.replace(
    notifyBlock,
    `${notifyBlock}\n                // SOCIALBIRD_CALL_SYSTEM_V4: queue-call-signals\n                void queueOfflineCallSignal(payload.type, targetIds, payload.data || {}, Number(ws.userId));`,
  );
}

if (!server.includes('SOCIALBIRD_CALL_SYSTEM_V4: register-offline-call-queue')) {
  const startAnchor = '// Старт сервера\n// PRODUCTION_HARDENING: configurable-listen-address';
  if (!server.includes(startAnchor)) throw new Error('Call system V4 backend patch failed: server start anchor');
  server = server.replace(
    startAnchor,
    `// SOCIALBIRD_CALL_SYSTEM_V4: register-offline-call-queue\n({ queueOfflineCallSignal, deliverPendingCallSignals } = registerOfflineCallQueue({ db, isUserOnline }));\n\n${startAnchor}`,
  );
}
fs.writeFileSync(serverFile, server, 'utf8');

// -----------------------------------------------------------------------------
// 4. Verify the complete V4 feature surface.
// -----------------------------------------------------------------------------
const requiredFiles = [
  providerFile,
  'src/components/call/NativeCallAudioBridge.tsx',
  'src/components/call/PushCallDeepLinkBridge.tsx',
  'src/components/VoiceCallControls.tsx',
  'src/components/GlobalCallOverlay.tsx',
  'src/App.tsx',
  'src/lib/webrtc.ts',
  'src/lib/screen-share.ts',
  queueFile,
  'public/sw.js',
];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Call system V4 missing file: ${file}`);
}

provider = fs.readFileSync(providerFile, 'utf8');
realtime = fs.readFileSync(realtimeFile, 'utf8');
server = fs.readFileSync(serverFile, 'utf8');
queue = fs.readFileSync(queueFile, 'utf8');
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
if (!hasPushActionBridge) throw new Error('Call system V4 PWA push-answer bridge missing');
if (!realtime.includes(realtimeMarker)) throw new Error('Call system V4 realtime isolation marker missing');
if (!server.includes('registerOfflineCallQueue') || !server.includes('queueOfflineCallSignal(payload.type')) {
  throw new Error('Call system V4 durable backend queue wiring missing');
}
if (!queue.includes('SOCIALBIRD_CALL_SYSTEM_V4: durable-signals')) {
  throw new Error('Call system V4 durable queue policy missing');
}

console.log('Call system V4 applied: one CallProvider owns signaling/media, Android/PWA answers converge into it, mobile INVITE/OFFER/ICE are durable and legacy RealtimeNotifications CALL_* handling is disabled.');

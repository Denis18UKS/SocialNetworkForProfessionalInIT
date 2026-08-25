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

// Prevent INVITE + replayed OFFER from starting two simultaneous accept/getUserMedia
// flows while Android is waking from a push notification.
const acceptingMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: accept-transition-lock';
if (!provider.includes(acceptingMarker)) {
  const refAnchor = '  const autoAnswerRef = useRef(false);';
  if (!provider.includes(refAnchor)) throw new Error('Call system V4 patch failed: accept lock ref anchor');
  provider = provider.replace(
    refAnchor,
    `${refAnchor}\n  ${acceptingMarker}\n  const acceptingRef = useRef(false);\n  const startingRef = useRef(false);`,
  );

  const startAnchor = `  const startCall = useCallback(async (input: StartCallInput) => {\n    if (callRef.current || incomingRef.current) {`;
  const startReplacement = `  const startCall = useCallback(async (input: StartCallInput) => {\n    if (startingRef.current) return;\n    if (callRef.current || incomingRef.current) {`;
  if (!provider.includes(startAnchor)) throw new Error('Call system V4 patch failed: start lock anchor');
  provider = provider.replace(startAnchor, startReplacement);

  const startTry = `    try {\n      const stream = await ensureLocalMedia(input.kind, "user");`;
  const startTryReplacement = `    startingRef.current = true;\n    try {\n      const stream = await ensureLocalMedia(input.kind, "user");`;
  if (!provider.includes(startTry)) throw new Error('Call system V4 patch failed: start lock try');
  provider = provider.replace(startTry, startTryReplacement);

  const startCatch = `    } catch (error) {\n      finishCallLocally("start-error");\n      toast.error(error instanceof Error ? error.message : "Не удалось начать звонок");\n    }\n  }, [ensureLocalMedia, finishCallLocally, makeOffer, publishActive, sendSignal]);`;
  const startCatchReplacement = `    } catch (error) {\n      finishCallLocally("start-error");\n      toast.error(error instanceof Error ? error.message : "Не удалось начать звонок");\n    } finally {\n      startingRef.current = false;\n    }\n  }, [ensureLocalMedia, finishCallLocally, makeOffer, publishActive, sendSignal]);`;
  if (!provider.includes(startCatch)) throw new Error('Call system V4 patch failed: start lock finally');
  provider = provider.replace(startCatch, startCatchReplacement);

  const acceptAnchor = `  const acceptIncoming = useCallback(async () => {\n    const invite = incomingRef.current;\n    if (!invite) {\n      autoAnswerRef.current = true;\n      return;\n    }`;
  const acceptReplacement = `  const acceptIncoming = useCallback(async () => {\n    const invite = incomingRef.current;\n    if (!invite) {\n      autoAnswerRef.current = true;\n      return;\n    }\n    if (acceptingRef.current) return;\n    acceptingRef.current = true;`;
  if (!provider.includes(acceptAnchor)) throw new Error('Call system V4 patch failed: accept lock anchor');
  provider = provider.replace(acceptAnchor, acceptReplacement);

  const acceptCatch = `    } catch (error) {\n      finishCallLocally("accept-error");\n      toast.error(error instanceof Error ? error.message : "Не удалось принять звонок");\n    }\n  }, [ensureLocalMedia, finishCallLocally, handleOffer, makeOffer, publishActive, sendSignal, stopRingtone]);`;
  const acceptCatchReplacement = `    } catch (error) {\n      finishCallLocally("accept-error");\n      toast.error(error instanceof Error ? error.message : "Не удалось принять звонок");\n    } finally {\n      acceptingRef.current = false;\n    }\n  }, [ensureLocalMedia, finishCallLocally, handleOffer, makeOffer, publishActive, sendSignal, stopRingtone]);`;
  if (!provider.includes(acceptCatch)) throw new Error('Call system V4 patch failed: accept lock finally');
  provider = provider.replace(acceptCatch, acceptCatchReplacement);
}

// A CALL_ACCEPT after mobile wake must supersede an unanswered stale local offer.
// iceRestart=true makes makeOffer rollback have-local-offer and send a fresh offer.
const renegotiationMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: fresh-offer-after-accept';
if (!provider.includes(renegotiationMarker)) {
  const oldAccept = `      if (!peersRef.current[peerId] || !peersRef.current[peerId].pc.remoteDescription) {\n        if (selfId < peerId || active.direction === "outgoing") await makeOffer(peerId);\n      }`;
  const newAccept = `      if (!peersRef.current[peerId] || !peersRef.current[peerId].pc.remoteDescription) {\n        ${renegotiationMarker}\n        if (selfId < peerId || active.direction === "outgoing") await makeOffer(peerId, true);\n      }`;
  if (!provider.includes(oldAccept)) throw new Error('Call system V4 patch failed: fresh offer anchor');
  provider = provider.replace(oldAccept, newAccept);
}

// Ignore late signals from an older call so a delayed HANGUP/SCREEN/ANSWER cannot
// damage a newly-established call in the same chat.
const staleMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: stale-call-signal-guard';
if (!provider.includes(staleMarker)) {
  const anchor = `    if (Array.isArray(signal.targetIds) && !signal.targetIds.map(Number).includes(selfId)) return;\n\n    if (type === "CALL_INVITE") {`;
  const guarded = `    if (Array.isArray(signal.targetIds) && !signal.targetIds.map(Number).includes(selfId)) return;\n\n    ${staleMarker}\n    if (type !== "CALL_INVITE") {\n      const relevant = callRef.current || incomingRef.current;\n      if (relevant) {\n        if (relevant.callId && signal.callId && relevant.callId !== signal.callId) return;\n        if (String(relevant.chatId) !== String(signal.chatId) || relevant.mode !== signal.mode) return;\n      }\n    }\n\n    if (type === "CALL_INVITE") {`;
  if (!provider.includes(anchor)) throw new Error('Call system V4 patch failed: stale signal guard anchor');
  provider = provider.replace(anchor, guarded);
}

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
// 3. Durable mobile signaling. Also migrate installations that already contain the
// old SOCIAL_NEXT / MOBILE_CALL_DELIVERY queue patches without duplicating vars,
// queue writes, replay or registration.
// -----------------------------------------------------------------------------
const queueFile = 'backend/offline-call-queue.js';
let queue = normalize(fs.readFileSync(queueFile, 'utf8'));
const durableMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: durable-signals';

if (!queue.includes(durableMarker)) {
  const oldTargets = `            if (!['CALL_INVITE', 'CALL_OFFER', 'CALL_ICE', 'CALL_RELAY_TRACK'].includes(type)) return;\n            const offlineTargets = uniqueTargets.filter((userId) => !isUserOnline(userId));\n            if (offlineTargets.length === 0) return;\n\n            for (const targetUserId of offlineTargets) {`;
  const durableTargets = `            if (!['CALL_INVITE', 'CALL_OFFER', 'CALL_ICE', 'CALL_RELAY_TRACK'].includes(type)) return;\n\n            ${durableMarker}\n            // Persist even when presence says online: suspended mobile WebViews can\n            // leave an OPEN socket behind while no JavaScript is actually consuming it.\n            for (const targetUserId of uniqueTargets) {`;

  if (queue.includes(oldTargets)) {
    queue = queue.replace(oldTargets, durableTargets);
  } else if (queue.includes('MOBILE_CALL_DELIVERY_FIX: durable-signals')
      && queue.includes('for (const targetUserId of uniqueTargets) {')) {
    queue = queue.replace(
      '// MOBILE_CALL_DELIVERY_FIX: durable-signals',
      `// MOBILE_CALL_DELIVERY_FIX: durable-signals\n            ${durableMarker}`,
    );
  } else {
    const uniqueLoop = '            for (const targetUserId of uniqueTargets) {';
    if (!queue.includes(uniqueLoop)) throw new Error('Call system V4 queue patch failed: target selection');
    queue = queue.replace(uniqueLoop, `            ${durableMarker}\n${uniqueLoop}`);
  }
}

const cleanupMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: accepted-call-cleanup';
const newCleanup = `            ${cleanupMarker}\n            // A callee answering/accepting carries initiatorId. Remove caller -> callee\n            // durable rows immediately so a later reconnect cannot resurrect the call.\n            const originalCallerId = Number(data?.initiatorId || data?.originalCallerId || data?.senderId);\n            if (['CALL_ACCEPT', 'CALL_ANSWER', 'CALL_HANGUP'].includes(type)\n                && originalCallerId > 0\n                && originalCallerId !== Number(senderId)) {\n                const incomingCallKey = buildCallKey(originalCallerId, data);\n                await db.query(\n                    'DELETE FROM pending_call_signals WHERE target_user_id = ? AND sender_user_id = ? AND call_key = ?',\n                    [Number(senderId), originalCallerId, incomingCallKey]\n                );\n            }`;

if (!queue.includes(cleanupMarker)) {
  const legacyCleanup = `            // MOBILE_CALL_DELIVERY_FIX: clear-accepted-incoming-signals\n            // CALL_ANSWER/HANGUP sent by the callee contains the original caller id in\n            // data.senderId. Remove the caller -> callee durable invite/offer/ICE rows\n            // so a later reconnect cannot resurrect an already answered/ended call.\n            const originalCallerId = Number(data?.senderId);\n            if (['CALL_ANSWER', 'CALL_HANGUP'].includes(type) && originalCallerId && originalCallerId !== Number(senderId)) {\n                const incomingCallKey = buildCallKey(originalCallerId, data);\n                await db.query(\n                    'DELETE FROM pending_call_signals WHERE target_user_id = ? AND sender_user_id = ? AND call_key = ?',\n                    [Number(senderId), originalCallerId, incomingCallKey]\n                );\n            }`;

  if (queue.includes(legacyCleanup)) {
    queue = queue.replace(legacyCleanup, newCleanup);
  } else {
    const expiryLine = `            await db.query('DELETE FROM pending_call_signals WHERE expires_at <= NOW()');`;
    const firstIndex = queue.indexOf(expiryLine, queue.indexOf('const queueOfflineCallSignal'));
    if (firstIndex < 0) throw new Error('Call system V4 queue patch failed: cleanup anchor');
    const insertAt = firstIndex + expiryLine.length;
    queue = `${queue.slice(0, insertAt)}\n\n${newCleanup}${queue.slice(insertAt)}`;
  }
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

const refsMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: offline-call-function-refs';
if (!server.includes(refsMarker)) {
  if (server.includes('let queueOfflineCallSignal = async () => {};')
      && server.includes('let deliverPendingCallSignals = async () => {};')) {
    server = server.replace(
      'let queueOfflineCallSignal = async () => {};',
      `${refsMarker}\nlet queueOfflineCallSignal = async () => {};`,
    );
  } else {
    const onlineAnchor = 'const isUserOnline = (userId) => onlineUsers.has(Number(userId));';
    if (!server.includes(onlineAnchor)) throw new Error('Call system V4 backend patch failed: online predicate');
    server = server.replace(
      onlineAnchor,
      `${onlineAnchor}\n${refsMarker}\nlet queueOfflineCallSignal = async () => {};\nlet deliverPendingCallSignals = async () => {};`,
    );
  }
}

const replayMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: call-host-replay';
const nativeReplayMarker = '// NATIVE_ANDROID: durable-call-replay-owner';
const nestedReplay = `                ${replayMarker}\n                if (ws.clientRole === 'call-host') {\n                    ${nativeReplayMarker}\n                if (ws.clientRole === 'call-host') {\n                    void deliverPendingCallSignals(decoded.id, ws);\n                }\n                }`;
const normalizedReplay = `                ${replayMarker}\n                ${nativeReplayMarker}\n                if (ws.clientRole === 'call-host') {\n                    void deliverPendingCallSignals(decoded.id, ws);\n                }`;
if (server.includes(nestedReplay)) server = server.replace(nestedReplay, normalizedReplay);

if (!server.includes(replayMarker) && !server.includes(nativeReplayMarker)) {
  const legacyReplay = `                // SOCIAL_NEXT: replay-offline-call-signals\n                void deliverPendingCallSignals(decoded.id, ws);`;
  const guarded = `                ${replayMarker}\n                ${nativeReplayMarker}\n                if (ws.clientRole === 'call-host') {\n                    void deliverPendingCallSignals(decoded.id, ws);\n                }`;
  if (server.includes(legacyReplay)) {
    server = server.replace(legacyReplay, guarded);
  } else {
    const roleAware = `                ws.clientRole = String(payload.clientRole || 'generic');\n                addOnlineSocket(decoded.id, ws);`;
    if (!server.includes(roleAware)) throw new Error('Call system V4 backend patch failed: role-aware AUTH');
    server = server.replace(roleAware, `${roleAware}\n${guarded}`);
  }
}

const queueMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: queue-call-signals';
if (!server.includes(queueMarker)) {
  const existingQueueCall = '                void queueOfflineCallSignal(payload.type, targetIds, payload.data || {}, Number(ws.userId));';
  if (server.includes(existingQueueCall)) {
    server = server.replace(existingQueueCall, `                ${queueMarker}\n${existingQueueCall}`);
  } else {
    const notifyBlock = `                notifyClients({\n                    type: payload.type,\n                    data: {\n                        ...payload.data,\n                        senderId: Number(ws.userId),\n                        targetIds,\n                    },\n                });`;
    if (!server.includes(notifyBlock)) throw new Error('Call system V4 backend patch failed: CALL notify block');
    server = server.replace(
      notifyBlock,
      `${notifyBlock}\n                ${queueMarker}\n                void queueOfflineCallSignal(payload.type, targetIds, payload.data || {}, Number(ws.userId));`,
    );
  }
}

const registrationMarker = '// SOCIALBIRD_CALL_SYSTEM_V4: register-offline-call-queue';
if (!server.includes(registrationMarker)) {
  const registration = '({ queueOfflineCallSignal, deliverPendingCallSignals } = registerOfflineCallQueue({ db, isUserOnline }));';
  if (server.includes(registration)) {
    server = server.replace(registration, `${registrationMarker}\n${registration}`);
  } else {
    const startAnchor = '// Старт сервера\n// PRODUCTION_HARDENING: configurable-listen-address';
    if (!server.includes(startAnchor)) throw new Error('Call system V4 backend patch failed: server start anchor');
    server = server.replace(startAnchor, `${registrationMarker}\n${registration}\n\n${startAnchor}`);
  }
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
  acceptingMarker,
  renegotiationMarker,
  staleMarker,
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
if (server.includes(nestedReplay)) throw new Error('Call system V4 nested replay guard was not normalized');
if (!queue.includes(durableMarker) || !queue.includes(cleanupMarker)) {
  throw new Error('Call system V4 durable queue policy missing');
}

console.log('Call system V4 applied: one CallProvider owns signaling/media, push-answer uses fresh renegotiation and transition locks, stale call signals are rejected, Android/PWA answers converge into it, legacy queue patches migrate without duplication, mobile INVITE/OFFER/ICE are durable and legacy RealtimeNotifications CALL_* handling is disabled.');

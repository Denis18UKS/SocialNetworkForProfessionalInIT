import fs from 'node:fs';

const normalize = (value) => value.replace(/\r\n/g, '\n');
const mustReplace = (source, from, to, label) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Call V5 patch failed: ${label}`);
  return source.replace(from, to);
};

const providerFile = 'src/components/call/CallProvider.tsx';
let provider = normalize(fs.readFileSync(providerFile, 'utf8'));

// -----------------------------------------------------------------------------
// 1) Cold-start push acceptance must not depend on AuthContext's first render.
// Keep the notification answer pending until the call-host websocket is authenticated
// and an actual INVITE/OFFER has arrived.
// -----------------------------------------------------------------------------
if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: cold-start-auth-independent')) {
  provider = mustReplace(
    provider,
    'import { useAuth } from "@/pages/AuthContext";\n',
    '',
    'remove AuthContext dependency',
  );
  provider = mustReplace(
    provider,
    '  const { isAuthenticated } = useAuth();\n',
    '',
    'remove isAuthenticated destructure',
  );
  provider = mustReplace(
    provider,
    '  const token = isAuthenticated ? (localStorage.getItem("token") || "") : "";',
    '  // SOCIALBIRD_CALL_SYSTEM_V5: cold-start-auth-independent\n  const token = localStorage.getItem("token") || "";',
    'token must be available on first render',
  );
}

if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: pending-push-answer')) {
  provider = mustReplace(
    provider,
    '  const autoAnswerRef = useRef(false);\n',
    '  const autoAnswerRef = useRef(false);\n  // SOCIALBIRD_CALL_SYSTEM_V5: pending-push-answer\n  const pendingPushAnswerRef = useRef(false);\n  const socketReadyRef = useRef(false);\n  const acceptedConnectTimerRef = useRef<number | null>(null);\n',
    'pending push answer refs',
  );
}

if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: real-webrtc-connected-state')) {
  const peerStore = '    peersRef.current[peerId] = bundle;\n    return bundle;';
  const replacement = `    // SOCIALBIRD_CALL_SYSTEM_V5: real-webrtc-connected-state\n    const markRealConnection = () => {\n      if (pc.connectionState !== "connected") return;\n      if (acceptedConnectTimerRef.current !== null) {\n        window.clearTimeout(acceptedConnectTimerRef.current);\n        acceptedConnectTimerRef.current = null;\n      }\n      setCall((current) => {\n        if (!current || current.phase === "active") return current;\n        const next = { ...current, phase: "active" as const };\n        callRef.current = next;\n        window.dispatchEvent(new CustomEvent("itbird-native-call-state", { detail: { active: true, phase: "active" } }));\n        return next;\n      });\n    };\n    pc.addEventListener("connectionstatechange", markRealConnection);\n\n${peerStore}`;
  provider = mustReplace(provider, peerStore, replacement, 'real connection state listener');

  provider = provider.replace(
    '    setCall((current) => current ? { ...current, phase: "active" } : current);\n  }, [flushPendingIce]);',
    '    // V5: SDP answer alone is not a connected call. connectionstatechange owns phase=active.\n  }, [flushPendingIce]);',
  );
  provider = provider.replace(
    '      setCall((current) => current ? { ...current, phase: "active" } : current);\n      return;\n    }\n\n    if (type === "CALL_SCREEN_START") {',
    '      // V5: CALL_ACCEPT only starts/refreshes negotiation; real WebRTC connected marks active.\n      return;\n    }\n\n    if (type === "CALL_SCREEN_START") {',
  );
}

if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: accepted-connect-timeout')) {
  const anchor = '      publishActive(snapshot);\n\n      const pending = Object.values(pendingOffersRef.current);';
  const block = `      publishActive(snapshot);\n      // SOCIALBIRD_CALL_SYSTEM_V5: accepted-connect-timeout\n      if (acceptedConnectTimerRef.current !== null) window.clearTimeout(acceptedConnectTimerRef.current);\n      acceptedConnectTimerRef.current = window.setTimeout(() => {\n        const active = callRef.current;\n        const connected = Object.values(peersRef.current).some((bundle) => bundle.pc.connectionState === "connected");\n        if (active?.callId === snapshot.callId && !connected) {\n          toast.error("Не удалось установить соединение. Попробуйте позвонить ещё раз.");\n          finishCallLocally("connect-timeout");\n        }\n        acceptedConnectTimerRef.current = null;\n      }, 18000);\n\n      const pending = Object.values(pendingOffersRef.current);`;
  provider = mustReplace(provider, anchor, block, 'accepted connection timeout');
}

if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: clear-connect-timeout')) {
  const anchor = '    autoAnswerRef.current = false;\n    setWindowCallState(null);';
  const block = `    autoAnswerRef.current = false;\n    pendingPushAnswerRef.current = false;\n    // SOCIALBIRD_CALL_SYSTEM_V5: clear-connect-timeout\n    if (acceptedConnectTimerRef.current !== null) {\n      window.clearTimeout(acceptedConnectTimerRef.current);\n      acceptedConnectTimerRef.current = null;\n    }\n    setWindowCallState(null);`;
  provider = mustReplace(provider, anchor, block, 'clear accepted connection timeout');
}

// acceptIncoming() is now a transaction: INVITE + authenticated call-host socket first.
if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: defer-answer-until-ready')) {
  const anchor = `  const acceptIncoming = useCallback(async () => {\n    const invite = incomingRef.current;\n    if (!invite) {\n      autoAnswerRef.current = true;\n      return;\n    }`;
  const block = `  const acceptIncoming = useCallback(async () => {\n    const invite = incomingRef.current;\n    if (!invite || !socketReadyRef.current || socketRef.current?.readyState !== WebSocket.OPEN) {\n      // SOCIALBIRD_CALL_SYSTEM_V5: defer-answer-until-ready\n      autoAnswerRef.current = true;\n      pendingPushAnswerRef.current = true;\n      return;\n    }`;
  provider = mustReplace(provider, anchor, block, 'defer push answer until websocket/invite');

  provider = provider.replace(
    '      autoAnswerRef.current = false;\n      publishActive(snapshot);',
    '      autoAnswerRef.current = false;\n      pendingPushAnswerRef.current = false;\n      publishActive(snapshot);',
  );
}

// Socket readiness is established only after a server-authenticated response or CALL_* replay.
if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: authenticated-call-host-ready')) {
  const oldEffect = `  useEffect(() => {\n    if (!isAuthenticated || !token) {\n      socketRef.current?.close();\n      socketRef.current = null;\n      if (callRef.current || incomingRef.current) finishCallLocally("logout");\n      return;\n    }\n\n    const socket = createReconnectingWebSocket(getWsUrl());\n    socketRef.current = socket;\n    socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token, clientRole: "call-host" }));\n    socket.onmessage = (event) => {\n      try {\n        const payload = JSON.parse(event.data);\n        if (!String(payload.type || "").startsWith("CALL_")) return;\n        void handleCallSignal(String(payload.type), payload.data || {});\n      } catch {}\n    };\n    return () => {\n      socket.close();\n      if (socketRef.current === socket) socketRef.current = null;\n    };\n  }, [finishCallLocally, handleCallSignal, isAuthenticated, token]);`;
  const newEffect = `  useEffect(() => {\n    if (!token) {\n      socketReadyRef.current = false;\n      socketRef.current?.close();\n      socketRef.current = null;\n      if (callRef.current || incomingRef.current) finishCallLocally("logout");\n      return;\n    }\n\n    const socket = createReconnectingWebSocket(getWsUrl());\n    socketRef.current = socket;\n    socketReadyRef.current = false;\n    socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token, clientRole: "call-host" }));\n    socket.onmessage = (event) => {\n      try {\n        const payload = JSON.parse(event.data);\n        const type = String(payload.type || "");\n        if (type === "ONLINE_USERS" || type.startsWith("CALL_")) {\n          // SOCIALBIRD_CALL_SYSTEM_V5: authenticated-call-host-ready\n          socketReadyRef.current = true;\n        }\n        if (type.startsWith("CALL_")) void handleCallSignal(type, payload.data || {});\n        if (socketReadyRef.current && pendingPushAnswerRef.current && incomingRef.current) {\n          window.setTimeout(() => { void acceptIncoming(); }, 0);\n        }\n      } catch {}\n    };\n    return () => {\n      socketReadyRef.current = false;\n      socket.close();\n      if (socketRef.current === socket) socketRef.current = null;\n    };\n  }, [acceptIncoming, finishCallLocally, handleCallSignal, token]);`;
  if (provider.includes(oldEffect)) {
    provider = provider.replace(oldEffect, newEffect);
  } else {
    // Current generated source may already have the V5 token change but old effect condition.
    const start = provider.indexOf('  useEffect(() => {\n    if (!isAuthenticated || !token) {');
    const endAnchor = '  }, [finishCallLocally, handleCallSignal, isAuthenticated, token]);';
    const end = provider.indexOf(endAnchor, start);
    if (start < 0 || end < 0) throw new Error('Call V5 patch failed: websocket lifecycle block');
    provider = `${provider.slice(0, start)}${newEffect}${provider.slice(end + endAnchor.length)}`;
  }
}

// All native/PWA answer sources set the same pending transaction flag.
provider = provider.replace(
  '      if (detail.action === "answer") {\n        autoAnswerRef.current = true;',
  '      if (detail.action === "answer") {\n        autoAnswerRef.current = true;\n        pendingPushAnswerRef.current = true;',
);
provider = provider.replace(
  '    const acceptFromNativeRuntime = () => {\n      autoAnswerRef.current = true;',
  '    const acceptFromNativeRuntime = () => {\n      autoAnswerRef.current = true;\n      pendingPushAnswerRef.current = true;',
);

// -----------------------------------------------------------------------------
// 2) Per-participant volume (microphone + that participant's screen audio).
// -----------------------------------------------------------------------------
if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: participant-volume-storage')) {
  const anchor = 'const setWindowCallState = (state: CallSnapshot | null) => {';
  const block = `// SOCIALBIRD_CALL_SYSTEM_V5: participant-volume-storage\nconst participantVolumeKey = (userId: number) => \`socialbird:call-volume:\${userId}\`;\nconst readParticipantVolume = (userId: number) => {\n  try {\n    const raw = localStorage.getItem(participantVolumeKey(userId));\n    if (raw === null || raw.trim() === "") return 1;\n    const value = Number(raw);\n    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;\n  } catch { return 1; }\n};\nconst writeParticipantVolume = (userId: number, volume: number) => {\n  try { localStorage.setItem(participantVolumeKey(userId), String(volume)); } catch {}\n};\n\n${anchor}`;
  provider = mustReplace(provider, anchor, block, 'participant volume storage');
}

provider = mustReplace(
  provider,
  '  speakingUserIds: number[];\n  currentUserId: number | null;',
  '  speakingUserIds: number[];\n  participantVolumes: Record<number, number>;\n  setParticipantVolume: (userId: number, volume: number) => void;\n  currentUserId: number | null;',
  'volume context API',
);
provider = mustReplace(
  provider,
  '  const [speakingUserIds, setSpeakingUserIds] = useState<number[]>([]);',
  '  const [speakingUserIds, setSpeakingUserIds] = useState<number[]>([]);\n  const [participantVolumes, setParticipantVolumes] = useState<Record<number, number>>({});',
  'volume state',
);
provider = mustReplace(
  provider,
  '  const audioBindingsRef = useRef<Record<string, AudioBinding>>({});',
  '  const audioBindingsRef = useRef<Record<string, AudioBinding>>({});\n  const participantVolumesRef = useRef<Record<number, number>>({});\n  const cameraResyncTimersRef = useRef<Record<number, number>>({});',
  'volume/camera refs',
);

if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: volume-ref-sync')) {
  const anchor = '  useEffect(() => {\n    incomingRef.current = incoming;\n  }, [incoming]);';
  provider = mustReplace(provider, anchor, `${anchor}\n\n  // SOCIALBIRD_CALL_SYSTEM_V5: volume-ref-sync\n  useEffect(() => { participantVolumesRef.current = participantVolumes; }, [participantVolumes]);`, 'volume ref sync');
}

if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: remote-audio-volume')) {
  const anchor = '    if (!isScreenAudio) monitorAudioTrack(`remote:${peerId}:${track.id}`, peerId, track);';
  const block = `    // SOCIALBIRD_CALL_SYSTEM_V5: remote-audio-volume\n    const peerVolume = participantVolumesRef.current[peerId] ?? readParticipantVolume(peerId);\n    participantVolumesRef.current[peerId] = peerVolume;\n    audioBindingsRef.current[key].media.volume = peerVolume;\n    setParticipantVolumes((current) => current[peerId] === peerVolume ? current : { ...current, [peerId]: peerVolume });\n    if (!isScreenAudio) monitorAudioTrack(\`remote:\${peerId}:\${track.id}\`, peerId, track);`;
  provider = mustReplace(provider, anchor, block, 'remote participant volume apply');
}

if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: set-participant-volume')) {
  const anchor = '  const toggleSound = useCallback(() => {';
  const block = `  // SOCIALBIRD_CALL_SYSTEM_V5: set-participant-volume\n  const setParticipantVolume = useCallback((userId: number, volume: number) => {\n    const id = Number(userId);\n    if (!Number.isFinite(id) || id <= 0) return;\n    const normalized = Math.min(1, Math.max(0, Number(volume) || 0));\n    participantVolumesRef.current[id] = normalized;\n    setParticipantVolumes((current) => ({ ...current, [id]: normalized }));\n    writeParticipantVolume(id, normalized);\n    Object.entries(audioBindingsRef.current).forEach(([key, binding]) => {\n      if (key.startsWith(\`peer:\${id}:\`)) binding.media.volume = normalized;\n    });\n  }, []);\n\n${anchor}`;
  provider = mustReplace(provider, anchor, block, 'participant volume setter');
}

// -----------------------------------------------------------------------------
// 3) Camera started inside a voice call must be renegotiated and recoverable.
// -----------------------------------------------------------------------------
provider = mustReplace(
  provider,
  '  screenStreamId?: string;\n};',
  '  screenStreamId?: string;\n  cameraEnabled?: boolean;\n  cameraFacing?: CameraFacingMode;\n};',
  'camera signal fields',
);

if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: camera-renegotiation')) {
  const start = provider.indexOf('  const toggleCamera = useCallback(');
  const end = provider.indexOf('\n  const stopScreenShare = useCallback(', start);
  if (start < 0 || end < 0) throw new Error('Call V5 patch failed: camera controls block');
  const replacement = `  const renegotiateCamera = useCallback(async (snapshot: CallSnapshot, track: MediaStreamTrack | null) => {\n    // SOCIALBIRD_CALL_SYSTEM_V5: camera-renegotiation\n    const local = localStreamRef.current;\n    const peerIds = Object.keys(peersRef.current).map(Number);\n    for (const peerId of peerIds) {\n      const bundle = peersRef.current[peerId];\n      if (!bundle || bundle.pc.signalingState === "closed") continue;\n      try {\n        if (typeof bundle.cameraSender.setStreams === "function") bundle.cameraSender.setStreams(...(local ? [local] : []));\n      } catch {}\n      await bundle.cameraSender.replaceTrack(track).catch(() => undefined);\n    }\n    sendSignal("CALL_CAMERA_STATE", allOtherParticipantIds(snapshot), { ...snapshot, cameraEnabled: Boolean(track) });\n    for (const peerId of peerIds) await makeOffer(peerId, true);\n  }, [allOtherParticipantIds, makeOffer, sendSignal]);\n\n  const toggleCamera = useCallback(async () => {\n    const active = callRef.current;\n    if (!active) return;\n    if (active.cameraEnabled) {\n      const oldTracks = localStreamRef.current?.getVideoTracks() || [];\n      oldTracks.forEach((track) => {\n        localStreamRef.current?.removeTrack(track);\n        if (track.readyState !== "ended") track.stop();\n      });\n      const next: CallSnapshot = { ...active, cameraEnabled: false, localStream: localStreamRef.current };\n      callRef.current = next;\n      setCall(next);\n      await renegotiateCamera(next, null);\n      return;\n    }\n\n    try {\n      const { track } = await requestCameraTrack({ facingMode: active.cameraFacing });\n      if (!localStreamRef.current) localStreamRef.current = new MediaStream();\n      localStreamRef.current.getVideoTracks().forEach((oldTrack) => {\n        localStreamRef.current?.removeTrack(oldTrack);\n        if (oldTrack.readyState !== "ended") oldTrack.stop();\n      });\n      localStreamRef.current.addTrack(track);\n      const next: CallSnapshot = { ...active, callKind: "video", cameraEnabled: true, localStream: localStreamRef.current };\n      callRef.current = next;\n      setCall(next);\n      await renegotiateCamera(next, track);\n    } catch (error) {\n      toast.error(error instanceof Error ? error.message : "Не удалось включить видео");\n    }\n  }, [renegotiateCamera]);\n\n  const switchCamera = useCallback(async () => {\n    const active = callRef.current;\n    if (!active?.cameraEnabled) return;\n    try {\n      let nextFacing: CameraFacingMode = active.cameraFacing === "user" ? "environment" : "user";\n      let cameraDeviceId: string | undefined;\n      if (!isMobile) {\n        const cameras = await listVideoInputs();\n        if (cameras.length < 2) { toast.info("Доступна только одна камера"); return; }\n        const currentTrack = localStreamRef.current?.getVideoTracks()[0];\n        const currentDeviceId = currentTrack?.getSettings().deviceId;\n        const currentIndex = Math.max(0, cameras.findIndex((camera) => camera.deviceId === currentDeviceId));\n        cameraDeviceId = cameras[(currentIndex + 1) % cameras.length]?.deviceId;\n        nextFacing = active.cameraFacing;\n      }\n      const { track } = await requestCameraTrack({ facingMode: isMobile ? nextFacing : undefined, deviceId: cameraDeviceId });\n      const oldTrack = localStreamRef.current?.getVideoTracks()[0];\n      if (!localStreamRef.current) localStreamRef.current = new MediaStream();\n      if (oldTrack) localStreamRef.current.removeTrack(oldTrack);\n      localStreamRef.current.addTrack(track);\n      const next: CallSnapshot = { ...active, cameraFacing: nextFacing, cameraEnabled: true, callKind: "video", localStream: localStreamRef.current };\n      callRef.current = next;\n      setCall(next);\n      await renegotiateCamera(next, track);\n      if (oldTrack && oldTrack.readyState !== "ended") oldTrack.stop();\n    } catch (error) {\n      toast.error(error instanceof Error ? error.message : "Не удалось переключить камеру");\n    }\n  }, [isMobile, renegotiateCamera]);\n`;
  provider = `${provider.slice(0, start)}${replacement}${provider.slice(end)}`;
}

if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: remote-camera-resync')) {
  const anchor = '    if (type === "CALL_SCREEN_START") {';
  const block = `    // SOCIALBIRD_CALL_SYSTEM_V5: remote-camera-resync\n    if (type === "CALL_CAMERA_STATE") {\n      const peerId = Number(signal.senderId);\n      if (cameraResyncTimersRef.current[peerId]) window.clearTimeout(cameraResyncTimersRef.current[peerId]);\n      if (!signal.cameraEnabled) {\n        setRemoteMedia((current) => {\n          const previous = current[peerId];\n          if (!previous) return current;\n          const next = { ...previous };\n          delete next.camera;\n          return { ...current, [peerId]: next };\n        });\n        return;\n      }\n      cameraResyncTimersRef.current[peerId] = window.setTimeout(() => {\n        const screenId = expectedScreenStreamRef.current[peerId];\n        const hasLiveCamera = Object.values(remoteStreamByIdRef.current).some((entry) =>\n          entry.peerId === peerId && entry.stream.id !== screenId\n          && entry.stream.getVideoTracks().some((track) => track.readyState === "live" && !track.muted),\n        );\n        if (!hasLiveCamera) sendSignal("CALL_CAMERA_RESYNC", [peerId], signal);\n        delete cameraResyncTimersRef.current[peerId];\n      }, 1400);\n      return;\n    }\n\n    if (type === "CALL_CAMERA_RESYNC") {\n      const active = callRef.current;\n      const peerId = Number(signal.senderId);\n      const track = localStreamRef.current?.getVideoTracks().find((item) => item.readyState === "live") || null;\n      const bundle = peersRef.current[peerId];\n      if (active?.cameraEnabled && bundle && track) {\n        try { if (typeof bundle.cameraSender.setStreams === "function" && localStreamRef.current) bundle.cameraSender.setStreams(localStreamRef.current); } catch {}\n        await bundle.cameraSender.replaceTrack(track).catch(() => undefined);\n        await makeOffer(peerId, true);\n      }\n      return;\n    }\n\n${anchor}`;
  provider = mustReplace(provider, anchor, block, 'camera state/resync signal handlers');
}

// Camera timer cleanup when a peer leaves.
if (!provider.includes('SOCIALBIRD_CALL_SYSTEM_V5: peer-camera-timer-cleanup')) {
  const anchor = '    delete expectedScreenStreamRef.current[peerId];';
  provider = mustReplace(provider, anchor, `${anchor}\n    // SOCIALBIRD_CALL_SYSTEM_V5: peer-camera-timer-cleanup\n    if (cameraResyncTimersRef.current[peerId]) window.clearTimeout(cameraResyncTimersRef.current[peerId]);\n    delete cameraResyncTimersRef.current[peerId];`, 'camera timer peer cleanup');
}

// Context exports.
provider = mustReplace(
  provider,
  '    speakingUserIds,\n    currentUserId: currentUserIdRef.current,',
  '    speakingUserIds,\n    participantVolumes,\n    setParticipantVolume,\n    currentUserId: currentUserIdRef.current,',
  'context values volume',
);
provider = mustReplace(
  provider,
  '    remoteMedia,\n    speakingUserIds,\n    startCall,',
  '    remoteMedia,\n    speakingUserIds,\n    participantVolumes,\n    setParticipantVolume,\n    startCall,',
  'context memo dependencies volume',
);

fs.writeFileSync(providerFile, provider, 'utf8');

// -----------------------------------------------------------------------------
// 4) Global overlay: resilient remote video playback + participant volume sliders.
// -----------------------------------------------------------------------------
const overlayFile = 'src/components/GlobalCallOverlay.tsx';
let overlay = normalize(fs.readFileSync(overlayFile, 'utf8'));

overlay = mustReplace(
  overlay,
  '    speakingUserIds,\n    currentUserId,',
  '    speakingUserIds,\n    participantVolumes,\n    setParticipantVolume,\n    currentUserId,',
  'overlay volume context',
);

if (!overlay.includes('SOCIALBIRD_CALL_SYSTEM_V5: resilient-remote-video')) {
  const oldEffect = `  useEffect(() => {\n    const video = ref.current;\n    if (!video) return;\n    video.srcObject = stream;\n    void video.play().catch(() => undefined);\n    return () => {\n      if (video.srcObject === stream) video.srcObject = null;\n    };\n  }, [stream]);`;
  const newEffect = `  useEffect(() => {\n    const video = ref.current;\n    if (!video) return;\n    let disposed = false;\n    // SOCIALBIRD_CALL_SYSTEM_V5: resilient-remote-video\n    const ensurePlaying = () => {\n      if (disposed) return;\n      if (video.srcObject !== stream) video.srcObject = stream;\n      void video.play().catch(() => undefined);\n    };\n    video.srcObject = stream;\n    stream.getVideoTracks().forEach((track) => {\n      track.addEventListener("unmute", ensurePlaying);\n      track.addEventListener("mute", ensurePlaying);\n    });\n    video.addEventListener("loadedmetadata", ensurePlaying);\n    video.addEventListener("canplay", ensurePlaying);\n    window.addEventListener("focus", ensurePlaying);\n    window.addEventListener("pageshow", ensurePlaying);\n    document.addEventListener("visibilitychange", ensurePlaying);\n    const timer = window.setInterval(ensurePlaying, 1200);\n    ensurePlaying();\n    return () => {\n      disposed = true;\n      window.clearInterval(timer);\n      stream.getVideoTracks().forEach((track) => {\n        track.removeEventListener("unmute", ensurePlaying);\n        track.removeEventListener("mute", ensurePlaying);\n      });\n      video.removeEventListener("loadedmetadata", ensurePlaying);\n      video.removeEventListener("canplay", ensurePlaying);\n      window.removeEventListener("focus", ensurePlaying);\n      window.removeEventListener("pageshow", ensurePlaying);\n      document.removeEventListener("visibilitychange", ensurePlaying);\n      if (video.srcObject === stream) video.srcObject = null;\n    };\n  }, [stream]);`;
  overlay = mustReplace(overlay, oldEffect, newEffect, 'resilient remote video');
}

if (!overlay.includes('SOCIALBIRD_CALL_SYSTEM_V5: participant-volume-slider')) {
  const anchor = '                {speaking && <span className="text-[10px] font-semibold text-emerald-300">Говорит</span>}';
  const block = `${anchor}\n                {!self && (\n                  <label className="ml-1 flex items-center gap-1.5" title={\`Громкость \${participant.username}\`}>\n                    {/* SOCIALBIRD_CALL_SYSTEM_V5: participant-volume-slider */}\n                    {(participantVolumes[id] ?? 1) <= 0.001 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}\n                    <input\n                      type="range" min="0" max="100" step="1"\n                      value={Math.round((participantVolumes[id] ?? 1) * 100)}\n                      onChange={(event) => setParticipantVolume(id, Number(event.currentTarget.value) / 100)}\n                      className="h-1.5 w-20 cursor-pointer accent-emerald-400 sm:w-24"\n                      aria-label={\`Громкость \${participant.username}\`}\n                    />\n                    <span className="w-8 text-right text-[10px] tabular-nums text-white/60">{Math.round((participantVolumes[id] ?? 1) * 100)}%</span>\n                  </label>\n                )}`;
  overlay = mustReplace(overlay, anchor, block, 'participant volume slider');
}

overlay = overlay.replace('title={call.cameraEnabled ? "Выключить камеру" : "Включить камеру"}', 'title={call.cameraEnabled ? "Выключить видео" : "Включить видео"}');
fs.writeFileSync(overlayFile, overlay, 'utf8');

// Verification.
provider = fs.readFileSync(providerFile, 'utf8');
overlay = fs.readFileSync(overlayFile, 'utf8');
for (const expected of [
  'SOCIALBIRD_CALL_SYSTEM_V5: defer-answer-until-ready',
  'SOCIALBIRD_CALL_SYSTEM_V5: real-webrtc-connected-state',
  'SOCIALBIRD_CALL_SYSTEM_V5: participant-volume-storage',
  'SOCIALBIRD_CALL_SYSTEM_V5: camera-renegotiation',
  'CALL_CAMERA_RESYNC',
  'setParticipantVolume',
]) {
  if (!provider.includes(expected)) throw new Error(`Call V5 provider verification failed: ${expected}`);
}
for (const expected of ['SOCIALBIRD_CALL_SYSTEM_V5: resilient-remote-video', 'SOCIALBIRD_CALL_SYSTEM_V5: participant-volume-slider']) {
  if (!overlay.includes(expected)) throw new Error(`Call V5 overlay verification failed: ${expected}`);
}

console.log('Call System V5 applied: push answer waits for authenticated signaling, active means real WebRTC connected, voice calls can renegotiate video, remote camera self-heals and every participant has independent remembered volume.');

import fs from 'node:fs';

const file = 'src/components/VoiceCallControls.tsx';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const marker = '// SOCIALBIRD_GLOBAL_CALL_V1: persistent-call-state';

const mustRegex = (label, pattern, replacement) => {
  if (!pattern.test(source)) throw new Error(`Global call patch failed: ${label}`);
  source = source.replace(pattern, replacement);
};

const verifyCurrent = () => {
  for (const expected of [marker, 'itbird-call-remote-stream', '__itbirdActiveCallState', 'publishGlobalCallState']) {
    if (!source.includes(expected)) throw new Error(`Global call verification failed: ${expected}`);
  }
};

if (!source.includes(marker)) {
  mustRegex(
    'window state type',
    /type ActiveCallWindow = typeof window & \{([\s\S]*?)\n\};/,
    (whole, body) => {
      if (body.includes('__itbirdActiveCallState')) return whole;
      return `type ActiveCallWindow = typeof window & {${body}\n  __itbirdActiveCallState?: Record<string, unknown> | null;\n};`;
    },
  );

  mustRegex(
    'global state publisher',
    /(  const visibleCallParticipants = \[[\s\S]*?\n  \];)/,
    `$1\n\n  ${marker}\n  const publishGlobalCallState = (patch: Record<string, unknown> = {}) => {\n    const callWindow = window as ActiveCallWindow;\n    const previous = (callWindow.__itbirdActiveCallState || {}) as Record<string, unknown>;\n    const next = {\n      ...previous,\n      chatId,\n      mode,\n      title,\n      callKind,\n      targetIds: callTargets,\n      participants: visibleCallParticipants,\n      localStream: localStreamRef.current,\n      screenStream: screenStreamRef.current,\n      ...patch,\n    };\n    callWindow.__itbirdActiveCallState = next;\n    window.dispatchEvent(new CustomEvent('itbird-call-state', { detail: next }));\n    return next;\n  };`,
  );

  mustRegex(
    'remote video bridge',
    /(  const attachRemoteStream = \(peerId: number, stream: MediaStream\) => \{\n)/,
    `$1    if (stream.getVideoTracks().length > 0) {\n      window.dispatchEvent(new CustomEvent('itbird-call-remote-stream', {\n        detail: { peerId, stream },\n      }));\n    }\n`,
  );

  mustRegex(
    'microphone recovery state',
    /(^[ \t]*)const recovered = await recoverMicrophoneTrack\(localStreamRef\.current,\s*micEnabled\);/m,
    `$1const desiredMicEnabled = Boolean((window as ActiveCallWindow).__itbirdActiveCallState?.micEnabled ?? micEnabled);\n$1const recovered = await recoverMicrophoneTrack(localStreamRef.current, desiredMicEnabled);`,
  );

  mustRegex(
    'persistent microphone source',
    /(  const toggleMic = \(\) => \{\n)\s*const next = !micEnabled;/,
    `$1    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.micEnabled;\n    const next = !(typeof globalValue === 'boolean' ? globalValue : micEnabled);`,
  );
  mustRegex(
    'persistent microphone publish',
    /(    setMicEnabled\(next\);)(\n  \};\n\n  const toggleSound)/,
    `$1\n    publishGlobalCallState({ micEnabled: next });$2`,
  );

  mustRegex(
    'persistent sound source',
    /(  const toggleSound = \(\) => \{\n)\s*const next = !soundEnabled;/,
    `$1    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.soundEnabled;\n    const next = !(typeof globalValue === 'boolean' ? globalValue : soundEnabled);`,
  );
  mustRegex(
    'persistent sound publish',
    /    setSoundEnabled\(next\);\s*\n\s*if \(next\) \{/,
    `    setSoundEnabled(next);\n    publishGlobalCallState({ soundEnabled: next });\n    if (next) {`,
  );
  mustRegex(
    'forced sound publish',
    /    setSoundEnabled\(true\);\s*\n\s*void Promise\.all\(media\.map\(\(element\) => playRemoteMedia\(element\)\)\)\.then\(\(results\) => \{/,
    `    setSoundEnabled(true);\n    publishGlobalCallState({ soundEnabled: true });\n    void Promise.all(media.map((element) => playRemoteMedia(element))).then((results) => {`,
  );

  mustRegex(
    'persistent video source',
    /(  const toggleVideo = async \(\) => \{\n)\s*const next = !videoEnabled;/,
    `$1    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.videoEnabled;\n    const next = !(typeof globalValue === 'boolean' ? globalValue : videoEnabled);`,
  );
  mustRegex(
    'video publish after camera add',
    /(        setVideoEnabled\(true\);)([\s\S]*?await Promise\.all\(Object\.keys\(peersRef\.current\)\.map\(\(id\) => renegotiate\(Number\(id\), "video"\)\)\);)/,
    `$1\n        publishGlobalCallState({ videoEnabled: true, callKind: 'video', localStream: localStreamRef.current });$2`,
  );
  mustRegex(
    'video publish normal toggle',
    /(    setVideoEnabled\(next\);)(\s*\n\s*if \(next\) \{)/,
    `$1\n    publishGlobalCallState({ videoEnabled: next, callKind: next ? 'video' : callKind, localStream: localStreamRef.current });$2`,
  );

  mustRegex(
    'screen stop publish',
    /(  const stopScreenShare = async \(\) => \{[\s\S]*?    setScreenEnabled\(false\);)/,
    `$1\n    publishGlobalCallState({ screenEnabled: false, screenStream: null });`,
  );
  mustRegex(
    'persistent screen source',
    /(  const toggleScreenShare = async \(\) => \{\n)\s*if \(screenEnabled\) \{/,
    `$1    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.screenEnabled;\n    const isScreenCurrentlyEnabled = typeof globalValue === 'boolean' ? globalValue : screenEnabled;\n    if (isScreenCurrentlyEnabled) {`,
  );
  mustRegex(
    'screen start publish',
    /(  const toggleScreenShare = async \(\) => \{[\s\S]*?      setScreenEnabled\(true\);)/,
    `$1\n      publishGlobalCallState({ screenEnabled: true, screenStream: stream });`,
  );

  mustRegex(
    'peer leave bridge',
    /(  const removeGroupPeer = \(peerId: number\) => \{[\s\S]*?    setParticipantSpeaking\(peerId, false\);)/,
    `$1\n    window.dispatchEvent(new CustomEvent('itbird-call-peer-left', { detail: { peerId } }));`,
  );

  mustRegex(
    'global state clear',
    /(  const endCall = \(\) => \{[\s\S]*?    const windowWithCall = window as ActiveCallWindow;)/,
    `$1\n    windowWithCall.__itbirdActiveCallState = null;\n    window.dispatchEvent(new CustomEvent('itbird-call-state', { detail: null }));`,
  );

  mustRegex(
    'active call state bootstrap',
    /(    windowWithCall\.__itbirdActiveCallToggleScreen = \(\) => \{[\s\S]*?    \};)\s*\n\s*window\.dispatchEvent\(new CustomEvent\("itbird-call-active", \{[\s\S]*?\}\)\);/,
    `$1\n    const activeState = publishGlobalCallState({\n      micEnabled,\n      soundEnabled,\n      videoEnabled,\n      screenEnabled,\n      localStream: localStreamRef.current,\n      screenStream: screenStreamRef.current,\n    });\n    window.dispatchEvent(new CustomEvent("itbird-call-active", { detail: activeState }));`,
  );

  fs.writeFileSync(file, source, 'utf8');
} else {
  fs.writeFileSync(file, source, 'utf8');
}

verifyCurrent();

const cssFile = 'src/styles/chat-platform-v1.css';
let css = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n') : '';
if (!css.includes('SOCIALBIRD_GLOBAL_CALL_V1')) {
  css += `\n/* SOCIALBIRD_GLOBAL_CALL_V1: old route-owned call panel is replaced by GlobalCallOverlay */\n.itbird-call-panel { display: none !important; }\n`;
  fs.writeFileSync(cssFile, css, 'utf8');
}

const incomingFile = 'src/components/RealtimeNotifications.tsx';
let incomingSource = fs.readFileSync(incomingFile, 'utf8').replace(/\r\n/g, '\n');
const incomingMarker = '// SOCIALBIRD_GLOBAL_CALL_INCOMING_V2: accepted-incoming-overlay';
const replaceIncoming = (label, from, to) => {
  if (!incomingSource.includes(from)) throw new Error(`Incoming global call patch failed: ${label}`);
  incomingSource = incomingSource.replace(from, to);
};

if (!incomingSource.includes(incomingMarker)) {
  replaceIncoming(
    'window state type',
    `type IncomingCall = {\n  senderId: number;\n  targetIds: number[];\n  chatId: number | string;\n  mode: \"private\" | \"group\";\n  title?: string;\n  description?: RTCSessionDescriptionInit;\n  candidate?: RTCIceCandidateInit;\n  callKind?: \"voice\" | \"video\";\n  callerName?: string;\n  isRenegotiation?: boolean;\n  participants?: CallParticipant[];\n};`,
    `type IncomingCall = {\n  senderId: number;\n  targetIds: number[];\n  chatId: number | string;\n  mode: \"private\" | \"group\";\n  title?: string;\n  description?: RTCSessionDescriptionInit;\n  candidate?: RTCIceCandidateInit;\n  callKind?: \"voice\" | \"video\";\n  callerName?: string;\n  isRenegotiation?: boolean;\n  participants?: CallParticipant[];\n};\n\ntype IncomingGlobalCallWindow = typeof window & {\n  __itbirdActiveCallEnd?: () => void;\n  __itbirdActiveCallToggleMic?: () => void;\n  __itbirdActiveCallToggleSound?: () => void;\n  __itbirdActiveCallToggleVideo?: () => void;\n  __itbirdActiveCallToggleScreen?: () => void;\n  __itbirdActiveCallState?: Record<string, unknown> | null;\n};`,
  );

  replaceIncoming(
    'cleanup incoming global state',
    `  const cleanupCall = () => {\n    peerWatchdogStopRef.current?.();`,
    `  const cleanupCall = () => {\n    ${incomingMarker}\n    const currentActive = activeCallRef.current;\n    if (currentActive && currentActive.senderId !== 0) {\n      const callWindow = window as IncomingGlobalCallWindow;\n      const globalState = (callWindow.__itbirdActiveCallState || {}) as Record<string, unknown>;\n      if (String(globalState.chatId || \"\") === String(currentActive.chatId || \"\")) {\n        callWindow.__itbirdActiveCallState = null;\n        delete callWindow.__itbirdActiveCallEnd;\n        delete callWindow.__itbirdActiveCallToggleMic;\n        delete callWindow.__itbirdActiveCallToggleSound;\n        delete callWindow.__itbirdActiveCallToggleVideo;\n        delete callWindow.__itbirdActiveCallToggleScreen;\n        window.dispatchEvent(new CustomEvent(\"itbird-call-state\", { detail: null }));\n      }\n    }\n    peerWatchdogStopRef.current?.();`,
  );

  replaceIncoming(
    'incoming remote video bridge',
    `        if (remoteStream.getVideoTracks().length > 0) {\n          const videoRoot = remoteVideoRef.current;`,
    `        if (remoteStream.getVideoTracks().length > 0) {\n          window.dispatchEvent(new CustomEvent(\"itbird-call-remote-stream\", {\n            detail: { peerId: incomingCall.senderId, stream: remoteStream },\n          }));\n          const videoRoot = remoteVideoRef.current;`,
  );

  replaceIncoming(
    'accepted incoming global state',
    `      setActiveCall(incomingCall);\n      setIncomingCall(null);\n      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));`,
    `      setActiveCall(incomingCall);\n      setIncomingCall(null);\n\n      const callWindow = window as IncomingGlobalCallWindow;\n      const acceptedState = {\n        chatId: incomingCall.chatId,\n        mode: incomingCall.mode,\n        title: incomingCall.title || incomingCall.callerName || \"Активный звонок\",\n        callKind: incomingCall.callKind || \"voice\",\n        participants: incomingCall.participants || [],\n        micEnabled: true,\n        soundEnabled: true,\n        videoEnabled: wantsVideo,\n        screenEnabled: false,\n        localStream: stream,\n        screenStream: null,\n        direction: \"incoming\",\n      };\n      callWindow.__itbirdActiveCallState = acceptedState;\n      window.dispatchEvent(new CustomEvent(\"itbird-call-active\", { detail: acceptedState }));\n      window.dispatchEvent(new CustomEvent(\"itbird-call-state\", { detail: acceptedState }));\n\n      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));`,
  );

  replaceIncoming(
    'incoming global controls',
    `  useEffect(() => {\n    if (!activeCall || activeCall.senderId === 0) return;\n    const timer = window.setInterval(() => { void repairIncomingMicrophone(); }, 2500);`,
    `  useEffect(() => {\n    if (!activeCall || activeCall.senderId === 0) return;\n    const callWindow = window as IncomingGlobalCallWindow;\n    callWindow.__itbirdActiveCallEnd = declineIncomingCall;\n    callWindow.__itbirdActiveCallToggleMic = toggleMic;\n    callWindow.__itbirdActiveCallToggleSound = toggleSound;\n    callWindow.__itbirdActiveCallToggleVideo = () => { void toggleVideo(); };\n    callWindow.__itbirdActiveCallToggleScreen = () => { void toggleScreenShare(); };\n\n    const previous = (callWindow.__itbirdActiveCallState || {}) as Record<string, unknown>;\n    const state = {\n      ...previous,\n      chatId: activeCall.chatId,\n      mode: activeCall.mode,\n      title: activeCall.title || activeCall.callerName || \"Активный звонок\",\n      callKind: activeCall.callKind || (videoEnabled ? \"video\" : \"voice\"),\n      participants: activeCall.participants || [],\n      micEnabled,\n      soundEnabled,\n      videoEnabled,\n      screenEnabled,\n      localStream: localStreamRef.current,\n      screenStream: screenStreamRef.current,\n      direction: \"incoming\",\n    };\n    callWindow.__itbirdActiveCallState = state;\n    window.dispatchEvent(new CustomEvent(\"itbird-call-state\", { detail: state }));\n\n    const timer = window.setInterval(() => { void repairIncomingMicrophone(); }, 2500);`,
  );

  replaceIncoming(
    'incoming global controls dependencies',
    `  }, [activeCall?.senderId, micEnabled]);`,
    `  }, [activeCall?.senderId, activeCall?.chatId, activeCall?.callKind, micEnabled, soundEnabled, videoEnabled, screenEnabled]);`,
  );

  fs.writeFileSync(incomingFile, incomingSource, 'utf8');
}

for (const expected of [incomingMarker, 'IncomingGlobalCallWindow', '__itbirdActiveCallState = acceptedState', '__itbirdActiveCallEnd = declineIncomingCall', 'direction: "incoming"']) {
  if (!incomingSource.includes(expected)) throw new Error(`Incoming global call verification failed: ${expected}`);
}

console.log('Global call overlay integration applied: outgoing and accepted incoming calls persist in GlobalCallOverlay with working controls.');

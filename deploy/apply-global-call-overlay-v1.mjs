import fs from 'node:fs';

const file = 'src/components/VoiceCallControls.tsx';
let source = fs.readFileSync(file, 'utf8');
const marker = '// SOCIALBIRD_GLOBAL_CALL_V1: persistent-call-state';

if (source.includes(marker)) {
  console.log('Global call overlay integration is already current.');
  process.exit(0);
}

const mustReplace = (label, from, to) => {
  if (!source.includes(from)) throw new Error(`Global call patch failed: ${label}`);
  source = source.replace(from, to);
};

mustReplace(
  'window state type',
  '  __itbirdActiveCallToggleScreen?: () => void;\n};',
  '  __itbirdActiveCallToggleScreen?: () => void;\n  __itbirdActiveCallState?: Record<string, unknown> | null;\n};',
);

const visibleAnchor = `  const visibleCallParticipants = [\n    ...(selfParticipant ? [selfParticipant] : []),\n    ...callableParticipants.filter((participant) => callTargets.includes(participant.id)),\n  ];`;
const publishBlock = `${visibleAnchor}\n\n  ${marker}\n  const publishGlobalCallState = (patch: Record<string, unknown> = {}) => {\n    const callWindow = window as ActiveCallWindow;\n    const previous = (callWindow.__itbirdActiveCallState || {}) as Record<string, unknown>;\n    const next = {\n      ...previous,\n      chatId,\n      mode,\n      title,\n      callKind,\n      targetIds: callTargets,\n      participants: visibleCallParticipants,\n      localStream: localStreamRef.current,\n      screenStream: screenStreamRef.current,\n      ...patch,\n    };\n    callWindow.__itbirdActiveCallState = next;\n    window.dispatchEvent(new CustomEvent('itbird-call-state', { detail: next }));\n    return next;\n  };`;
mustReplace('global state publisher', visibleAnchor, publishBlock);

const attachAnchor = `  const attachRemoteStream = (peerId: number, stream: MediaStream) => {\n    const audioTrack = stream.getAudioTracks()[0];`;
const attachReplacement = `  const attachRemoteStream = (peerId: number, stream: MediaStream) => {\n    if (stream.getVideoTracks().length > 0) {\n      window.dispatchEvent(new CustomEvent('itbird-call-remote-stream', {\n        detail: { peerId, stream },\n      }));\n    }\n    const audioTrack = stream.getAudioTracks()[0];`;
mustReplace('remote video bridge', attachAnchor, attachReplacement);

mustReplace(
  'microphone recovery state',
  '      const recovered = await recoverMicrophoneTrack(localStreamRef.current, micEnabled);',
  `      const desiredMicEnabled = Boolean((window as ActiveCallWindow).__itbirdActiveCallState?.micEnabled ?? micEnabled);\n      const recovered = await recoverMicrophoneTrack(localStreamRef.current, desiredMicEnabled);`,
);

const toggleMicOld = `  const toggleMic = () => {\n    const next = !micEnabled;\n    localStreamRef.current?.getAudioTracks().forEach((track) => {\n      track.enabled = next;\n    });\n    setMicEnabled(next);\n  };`;
const toggleMicNew = `  const toggleMic = () => {\n    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.micEnabled;\n    const next = !(typeof globalValue === 'boolean' ? globalValue : micEnabled);\n    localStreamRef.current?.getAudioTracks().forEach((track) => {\n      track.enabled = next;\n    });\n    setMicEnabled(next);\n    publishGlobalCallState({ micEnabled: next });\n  };`;
mustReplace('persistent microphone control', toggleMicOld, toggleMicNew);

mustReplace(
  'persistent sound toggle source',
  '  const toggleSound = () => {\n    const next = !soundEnabled;',
  `  const toggleSound = () => {\n    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.soundEnabled;\n    const next = !(typeof globalValue === 'boolean' ? globalValue : soundEnabled);`,
);
mustReplace(
  'persistent sound state publish',
  '    setSoundEnabled(next);\n    if (next) {',
  `    setSoundEnabled(next);\n    publishGlobalCallState({ soundEnabled: next });\n    if (next) {`,
);

mustReplace(
  'forced sound publish',
  '    setSoundEnabled(true);\n    void Promise.all(media.map((element) => playRemoteMedia(element))).then((results) => {',
  `    setSoundEnabled(true);\n    publishGlobalCallState({ soundEnabled: true });\n    void Promise.all(media.map((element) => playRemoteMedia(element))).then((results) => {`,
);

mustReplace(
  'persistent video toggle source',
  '  const toggleVideo = async () => {\n    const next = !videoEnabled;',
  `  const toggleVideo = async () => {\n    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.videoEnabled;\n    const next = !(typeof globalValue === 'boolean' ? globalValue : videoEnabled);`,
);
mustReplace(
  'video publish after camera add',
  '        setVideoEnabled(true);\n        await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id), "video")));',
  `        setVideoEnabled(true);\n        publishGlobalCallState({ videoEnabled: true, callKind: 'video', localStream: localStreamRef.current });\n        await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id), "video")));`,
);
mustReplace(
  'video publish normal toggle',
  '    setVideoEnabled(next);\n    if (next) {',
  `    setVideoEnabled(next);\n    publishGlobalCallState({ videoEnabled: next, callKind: next ? 'video' : callKind, localStream: localStreamRef.current });\n    if (next) {`,
);

mustReplace(
  'screen stop publish',
  '    setScreenEnabled(false);\n    await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id))));',
  `    setScreenEnabled(false);\n    publishGlobalCallState({ screenEnabled: false, screenStream: null });\n    await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id))));`,
);
mustReplace(
  'persistent screen toggle source',
  '  const toggleScreenShare = async () => {\n    if (screenEnabled) {',
  `  const toggleScreenShare = async () => {\n    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.screenEnabled;\n    const isScreenCurrentlyEnabled = typeof globalValue === 'boolean' ? globalValue : screenEnabled;\n    if (isScreenCurrentlyEnabled) {`,
);
mustReplace(
  'screen start publish',
  '      setScreenEnabled(true);\n      if (localScreenVideoRef.current) {',
  `      setScreenEnabled(true);\n      publishGlobalCallState({ screenEnabled: true, screenStream: stream });\n      if (localScreenVideoRef.current) {`,
);

const removePeerAnchor = `    setParticipantSpeaking(peerId, false);\n  };`;
mustReplace(
  'peer leave bridge',
  removePeerAnchor,
  `    setParticipantSpeaking(peerId, false);\n    window.dispatchEvent(new CustomEvent('itbird-call-peer-left', { detail: { peerId } }));\n  };`,
);

const endWindowAnchor = `    const windowWithCall = window as ActiveCallWindow;\n    if (windowWithCall.__itbirdActiveCallEnd === endCall) delete windowWithCall.__itbirdActiveCallEnd;`;
mustReplace(
  'global state clear',
  endWindowAnchor,
  `    const windowWithCall = window as ActiveCallWindow;\n    windowWithCall.__itbirdActiveCallState = null;\n    window.dispatchEvent(new CustomEvent('itbird-call-state', { detail: null }));\n    if (windowWithCall.__itbirdActiveCallEnd === endCall) delete windowWithCall.__itbirdActiveCallEnd;`,
);

const activeAnchor = `    windowWithCall.__itbirdActiveCallToggleScreen = () => {\n      void toggleScreenShare();\n    };\n    window.dispatchEvent(new CustomEvent("itbird-call-active", {\n      detail: { chatId, mode, title, callKind, targetIds: callTargets, participants: visibleCallParticipants },\n    }));`;
const activeReplacement = `    windowWithCall.__itbirdActiveCallToggleScreen = () => {\n      void toggleScreenShare();\n    };\n    const activeState = publishGlobalCallState({\n      micEnabled,\n      soundEnabled,\n      videoEnabled,\n      screenEnabled,\n      localStream: localStreamRef.current,\n      screenStream: screenStreamRef.current,\n    });\n    window.dispatchEvent(new CustomEvent("itbird-call-active", { detail: activeState }));`;
mustReplace('active call state bootstrap', activeAnchor, activeReplacement);

fs.writeFileSync(file, source, 'utf8');

const cssFile = 'src/styles/chat-platform-v1.css';
let css = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8') : '';
if (!css.includes('SOCIALBIRD_GLOBAL_CALL_V1')) {
  css += `\n/* SOCIALBIRD_GLOBAL_CALL_V1: old route-owned call panel is replaced by GlobalCallOverlay */\n.itbird-call-panel { display: none !important; }\n`;
  fs.writeFileSync(cssFile, css, 'utf8');
}

for (const expected of [marker, 'itbird-call-remote-stream', '__itbirdActiveCallState', 'publishGlobalCallState']) {
  if (!source.includes(expected)) throw new Error(`Global call verification failed: ${expected}`);
}
console.log('Global call overlay integration applied: active calls persist across route changes and remote/local screen video can be fullscreen.');

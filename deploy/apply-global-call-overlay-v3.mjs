import fs from 'node:fs';

const patchFile = (file, transform) => {
  const current = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const next = transform(current);
  fs.writeFileSync(file, next, 'utf8');
};

const replaceRegex = (source, label, pattern, replacement) => {
  if (!pattern.test(source)) throw new Error(`Global call V3 patch failed: ${label}`);
  return source.replace(pattern, replacement);
};

// Outgoing calls: persistent global overlay state.
patchFile('src/components/VoiceCallControls.tsx', (input) => {
  let source = input;
  const marker = '// SOCIALBIRD_GLOBAL_CALL_V1: persistent-call-state';
  if (source.includes(marker)) return source;

  source = replaceRegex(source, 'outgoing window state type', /type ActiveCallWindow = typeof window & \{([\s\S]*?)\n\};/, (whole, body) => {
    if (body.includes('__itbirdActiveCallState')) return whole;
    return `type ActiveCallWindow = typeof window & {${body}\n  __itbirdActiveCallState?: Record<string, unknown> | null;\n};`;
  });

  source = replaceRegex(source, 'outgoing global state publisher', /(  const visibleCallParticipants = \[[\s\S]*?\n  \];)/, `$1\n\n  ${marker}\n  const publishGlobalCallState = (patch: Record<string, unknown> = {}) => {\n    const callWindow = window as ActiveCallWindow;\n    const previous = (callWindow.__itbirdActiveCallState || {}) as Record<string, unknown>;\n    const next = {\n      ...previous,\n      chatId, mode, title, callKind,\n      targetIds: callTargets,\n      participants: visibleCallParticipants,\n      localStream: localStreamRef.current,\n      screenStream: screenStreamRef.current,\n      ...patch,\n    };\n    callWindow.__itbirdActiveCallState = next;\n    window.dispatchEvent(new CustomEvent('itbird-call-state', { detail: next }));\n    return next;\n  };`);

  source = replaceRegex(source, 'outgoing remote video bridge', /(  const attachRemoteStream = \(peerId: number, stream: MediaStream\) => \{\n)/, `$1    if (stream.getVideoTracks().length > 0) {\n      window.dispatchEvent(new CustomEvent('itbird-call-remote-stream', { detail: { peerId, stream } }));\n    }\n`);

  source = replaceRegex(source, 'outgoing mic recovery', /(^[ \t]*)const recovered = await recoverMicrophoneTrack\(localStreamRef\.current,\s*micEnabled\);/m, `$1const desiredMicEnabled = Boolean((window as ActiveCallWindow).__itbirdActiveCallState?.micEnabled ?? micEnabled);\n$1const recovered = await recoverMicrophoneTrack(localStreamRef.current, desiredMicEnabled);`);
  source = replaceRegex(source, 'outgoing mic source', /(  const toggleMic = \(\) => \{\n)\s*const next = !micEnabled;/, `$1    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.micEnabled;\n    const next = !(typeof globalValue === 'boolean' ? globalValue : micEnabled);`);
  source = replaceRegex(source, 'outgoing mic publish', /(    setMicEnabled\(next\);)(\n  \};\n\n  const toggleSound)/, `$1\n    publishGlobalCallState({ micEnabled: next });$2`);

  source = replaceRegex(source, 'outgoing sound source', /(  const toggleSound = \(\) => \{\n)\s*const next = !soundEnabled;/, `$1    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.soundEnabled;\n    const next = !(typeof globalValue === 'boolean' ? globalValue : soundEnabled);`);
  source = replaceRegex(source, 'outgoing sound publish', /    setSoundEnabled\(next\);\s*\n\s*if \(next\) \{/, `    setSoundEnabled(next);\n    publishGlobalCallState({ soundEnabled: next });\n    if (next) {`);
  source = replaceRegex(source, 'outgoing forced sound publish', /    setSoundEnabled\(true\);\s*\n\s*void Promise\.all\(media\.map\(\(element\) => playRemoteMedia\(element\)\)\)\.then\(\(results\) => \{/, `    setSoundEnabled(true);\n    publishGlobalCallState({ soundEnabled: true });\n    void Promise.all(media.map((element) => playRemoteMedia(element))).then((results) => {`);

  source = replaceRegex(source, 'outgoing video source', /(  const toggleVideo = async \(\) => \{\n)\s*const next = !videoEnabled;/, `$1    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.videoEnabled;\n    const next = !(typeof globalValue === 'boolean' ? globalValue : videoEnabled);`);
  source = replaceRegex(source, 'outgoing video camera publish', /(        setVideoEnabled\(true\);)([\s\S]*?await Promise\.all\(Object\.keys\(peersRef\.current\)\.map\(\(id\) => renegotiate\(Number\(id\), "video"\)\)\);)/, `$1\n        publishGlobalCallState({ videoEnabled: true, callKind: 'video', localStream: localStreamRef.current });$2`);
  source = replaceRegex(source, 'outgoing video publish', /(    setVideoEnabled\(next\);)(\s*\n\s*if \(next\) \{)/, `$1\n    publishGlobalCallState({ videoEnabled: next, callKind: next ? 'video' : callKind, localStream: localStreamRef.current });$2`);

  source = replaceRegex(source, 'outgoing screen stop publish', /(  const stopScreenShare = async \(\) => \{[\s\S]*?    setScreenEnabled\(false\);)/, `$1\n    publishGlobalCallState({ screenEnabled: false, screenStream: null });`);
  source = replaceRegex(source, 'outgoing screen source', /(  const toggleScreenShare = async \(\) => \{\n)\s*if \(screenEnabled\) \{/, `$1    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.screenEnabled;\n    const isScreenCurrentlyEnabled = typeof globalValue === 'boolean' ? globalValue : screenEnabled;\n    if (isScreenCurrentlyEnabled) {`);
  source = replaceRegex(source, 'outgoing screen start publish', /(  const toggleScreenShare = async \(\) => \{[\s\S]*?      setScreenEnabled\(true\);)/, `$1\n      publishGlobalCallState({ screenEnabled: true, screenStream: stream });`);

  source = replaceRegex(source, 'outgoing peer leave bridge', /(  const removeGroupPeer = \(peerId: number\) => \{[\s\S]*?    setParticipantSpeaking\(peerId, false\);)/, `$1\n    window.dispatchEvent(new CustomEvent('itbird-call-peer-left', { detail: { peerId } }));`);
  source = replaceRegex(source, 'outgoing state clear', /(  const endCall = \(\) => \{[\s\S]*?    const windowWithCall = window as ActiveCallWindow;)/, `$1\n    windowWithCall.__itbirdActiveCallState = null;\n    window.dispatchEvent(new CustomEvent('itbird-call-state', { detail: null }));`);
  source = replaceRegex(source, 'outgoing state bootstrap', /(    windowWithCall\.__itbirdActiveCallToggleScreen = \(\) => \{[\s\S]*?    \};)\s*\n\s*window\.dispatchEvent\(new CustomEvent\("itbird-call-active", \{[\s\S]*?\}\)\);/, `$1\n    const activeState = publishGlobalCallState({ micEnabled, soundEnabled, videoEnabled, screenEnabled, localStream: localStreamRef.current, screenStream: screenStreamRef.current });\n    window.dispatchEvent(new CustomEvent("itbird-call-active", { detail: activeState }));`);
  return source;
});

// Accepted incoming calls: publish exactly the same global overlay state.
patchFile('src/components/RealtimeNotifications.tsx', (input) => {
  let source = input;
  const marker = '// SOCIALBIRD_GLOBAL_CALL_INCOMING_V3: accepted-incoming-overlay';
  if (source.includes(marker)) return source;

  if (!source.includes('type IncomingGlobalCallWindow = typeof window & {')) {
    source = replaceRegex(source, 'incoming window state type', /(type IncomingCall = \{[\s\S]*?\n\};)/, `$1\n\ntype IncomingGlobalCallWindow = typeof window & {\n  __itbirdActiveCallEnd?: () => void;\n  __itbirdActiveCallToggleMic?: () => void;\n  __itbirdActiveCallToggleSound?: () => void;\n  __itbirdActiveCallToggleVideo?: () => void;\n  __itbirdActiveCallToggleScreen?: () => void;\n  __itbirdActiveCallState?: Record<string, unknown> | null;\n};`);
  }

  source = replaceRegex(source, 'incoming cleanup global state', /(  const cleanupCall = \(\) => \{\n)/, `$1    ${marker}\n    const currentActive = activeCallRef.current;\n    if (currentActive && currentActive.senderId !== 0) {\n      const callWindow = window as IncomingGlobalCallWindow;\n      const globalState = (callWindow.__itbirdActiveCallState || {}) as Record<string, unknown>;\n      if (String(globalState.chatId || '') === String(currentActive.chatId || '')) {\n        callWindow.__itbirdActiveCallState = null;\n        delete callWindow.__itbirdActiveCallEnd;\n        delete callWindow.__itbirdActiveCallToggleMic;\n        delete callWindow.__itbirdActiveCallToggleSound;\n        delete callWindow.__itbirdActiveCallToggleVideo;\n        delete callWindow.__itbirdActiveCallToggleScreen;\n        window.dispatchEvent(new CustomEvent('itbird-call-state', { detail: null }));\n        window.dispatchEvent(new CustomEvent('itbird-call-ended', { detail: { chatId: currentActive.chatId, mode: currentActive.mode, source: 'RealtimeNotifications' } }));\n      }\n    }\n`);

  if (!source.includes('detail: { peerId: incomingCall.senderId, stream: remoteStream }')) {
    source = replaceRegex(source, 'incoming remote video bridge', /(        if \(remoteStream\.getVideoTracks\(\)\.length > 0\) \{\s*)(const videoRoot = remoteVideoRef\.current;)/, `$1window.dispatchEvent(new CustomEvent('itbird-call-remote-stream', { detail: { peerId: incomingCall.senderId, stream: remoteStream } }));\n          $2`);
  }

  source = replaceRegex(source, 'incoming accepted state', /(      setActiveCall\(incomingCall\);\s*\n\s*      setIncomingCall\(null\);)(\s*\n\s*      await new Promise<void>\(\(resolve\) => window\.requestAnimationFrame\(\(\) => resolve\(\)\)\);)/, `$1\n\n      const callWindow = window as IncomingGlobalCallWindow;\n      const acceptedState = {\n        chatId: incomingCall.chatId, mode: incomingCall.mode,\n        title: incomingCall.title || incomingCall.callerName || 'Активный звонок',\n        callKind: incomingCall.callKind || 'voice',\n        participants: incomingCall.participants || [],\n        micEnabled: true, soundEnabled: true, videoEnabled: wantsVideo, screenEnabled: false,\n        localStream: stream, screenStream: null, direction: 'incoming',\n      };\n      callWindow.__itbirdActiveCallState = acceptedState;\n      window.dispatchEvent(new CustomEvent('itbird-call-active', { detail: acceptedState }));\n      window.dispatchEvent(new CustomEvent('itbird-call-state', { detail: acceptedState }));$2`);

  // Prevent recursion when GlobalCallOverlay calls declineIncomingCall as its end handler.
  source = replaceRegex(source, 'incoming end recursion guard', /(  const declineIncomingCall = \(\) => \{\n)\s*\(window as typeof window & \{ __itbirdActiveCallEnd\?: \(\) => void \}\)\.__itbirdActiveCallEnd\?\.\(\);/, `$1    if (activeCall?.senderId === 0) {\n      (window as typeof window & { __itbirdActiveCallEnd?: () => void }).__itbirdActiveCallEnd?.();\n    }`);

  source = replaceRegex(source, 'incoming global controls', /(  useEffect\(\(\) => \{\n    if \(!activeCall \|\| activeCall\.senderId === 0\) return;\n)(    const timer = window\.setInterval\(\(\) => \{ void repairIncomingMicrophone\(\); \}, 2500\);)/, `$1    const callWindow = window as IncomingGlobalCallWindow;\n    callWindow.__itbirdActiveCallEnd = declineIncomingCall;\n    callWindow.__itbirdActiveCallToggleMic = toggleMic;\n    callWindow.__itbirdActiveCallToggleSound = toggleSound;\n    callWindow.__itbirdActiveCallToggleVideo = () => { void toggleVideo(); };\n    callWindow.__itbirdActiveCallToggleScreen = () => { void toggleScreenShare(); };\n    const previous = (callWindow.__itbirdActiveCallState || {}) as Record<string, unknown>;\n    const state = {\n      ...previous,\n      chatId: activeCall.chatId, mode: activeCall.mode,\n      title: activeCall.title || activeCall.callerName || 'Активный звонок',\n      callKind: activeCall.callKind || (videoEnabled ? 'video' : 'voice'),\n      participants: activeCall.participants || [],\n      micEnabled, soundEnabled, videoEnabled, screenEnabled,\n      localStream: localStreamRef.current, screenStream: screenStreamRef.current, direction: 'incoming',\n    };\n    callWindow.__itbirdActiveCallState = state;\n    window.dispatchEvent(new CustomEvent('itbird-call-state', { detail: state }));\n    $2`);

  source = replaceRegex(source, 'incoming global controls dependencies', /  \}, \[activeCall\?\.senderId, micEnabled\]\);/, `  }, [activeCall?.senderId, activeCall?.chatId, activeCall?.callKind, micEnabled, soundEnabled, videoEnabled, screenEnabled]);`);
  return source;
});

const cssFile = 'src/styles/chat-platform-v1.css';
let css = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n') : '';
if (!css.includes('SOCIALBIRD_GLOBAL_CALL_V1')) {
  css += `\n/* SOCIALBIRD_GLOBAL_CALL_V1: route-owned call panels are replaced by GlobalCallOverlay */\n.itbird-call-panel { display: none !important; }\n`;
  fs.writeFileSync(cssFile, css, 'utf8');
}

const voice = fs.readFileSync('src/components/VoiceCallControls.tsx', 'utf8');
const incoming = fs.readFileSync('src/components/RealtimeNotifications.tsx', 'utf8');
for (const expected of ['SOCIALBIRD_GLOBAL_CALL_V1: persistent-call-state', '__itbirdActiveCallState', 'publishGlobalCallState']) {
  if (!voice.includes(expected)) throw new Error(`Global call V3 verification failed: ${expected}`);
}
for (const expected of ['SOCIALBIRD_GLOBAL_CALL_INCOMING_V3: accepted-incoming-overlay', '__itbirdActiveCallState = acceptedState', '__itbirdActiveCallEnd = declineIncomingCall', "direction: 'incoming'"]) {
  if (!incoming.includes(expected)) throw new Error(`Incoming global call V3 verification failed: ${expected}`);
}

console.log('Global call overlay V3 applied: outgoing and accepted incoming calls persist globally with working controls and recursion-safe hangup.');

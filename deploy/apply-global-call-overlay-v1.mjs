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
    /(\s*)const recovered = await recoverMicrophoneTrack\(localStreamRef\.current,\s*micEnabled\);/,
    `$1const desiredMicEnabled = Boolean((window as ActiveCallWindow).__itbirdActiveCallState?.micEnabled ?? micEnabled);$1const recovered = await recoverMicrophoneTrack(localStreamRef.current, desiredMicEnabled);`,
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
    /    setSoundEnabled\(next\);\n    if \(next\) \{/,
    `    setSoundEnabled(next);\n    publishGlobalCallState({ soundEnabled: next });\n    if (next) {`,
  );
  mustRegex(
    'forced sound publish',
    /    setSoundEnabled\(true\);\n    void Promise\.all\(media\.map\(\(element\) => playRemoteMedia\(element\)\)\)\.then\(\(results\) => \{/,
    `    setSoundEnabled(true);\n    publishGlobalCallState({ soundEnabled: true });\n    void Promise.all(media.map((element) => playRemoteMedia(element))).then((results) => {`,
  );

  mustRegex(
    'persistent video source',
    /(  const toggleVideo = async \(\) => \{\n)\s*const next = !videoEnabled;/,
    `$1    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.videoEnabled;\n    const next = !(typeof globalValue === 'boolean' ? globalValue : videoEnabled);`,
  );
  mustRegex(
    'video publish after camera add',
    /        setVideoEnabled\(true\);\n        await Promise\.all\(Object\.keys\(peersRef\.current\)\.map\(\(id\) => renegotiate\(Number\(id\), "video"\)\)\);/,
    `        setVideoEnabled(true);\n        publishGlobalCallState({ videoEnabled: true, callKind: 'video', localStream: localStreamRef.current });\n        await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id), "video")));`,
  );
  mustRegex(
    'video publish normal toggle',
    /    setVideoEnabled\(next\);\n    if \(next\) \{/,
    `    setVideoEnabled(next);\n    publishGlobalCallState({ videoEnabled: next, callKind: next ? 'video' : callKind, localStream: localStreamRef.current });\n    if (next) {`,
  );

  mustRegex(
    'screen stop publish',
    /    setScreenEnabled\(false\);\n    await Promise\.all\(Object\.keys\(peersRef\.current\)\.map\(\(id\) => renegotiate\(Number\(id\)\)\)\);/,
    `    setScreenEnabled(false);\n    publishGlobalCallState({ screenEnabled: false, screenStream: null });\n    await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id))));`,
  );
  mustRegex(
    'persistent screen source',
    /(  const toggleScreenShare = async \(\) => \{\n)\s*if \(screenEnabled\) \{/,
    `$1    const globalValue = (window as ActiveCallWindow).__itbirdActiveCallState?.screenEnabled;\n    const isScreenCurrentlyEnabled = typeof globalValue === 'boolean' ? globalValue : screenEnabled;\n    if (isScreenCurrentlyEnabled) {`,
  );
  mustRegex(
    'screen start publish',
    /      setScreenEnabled\(true\);\n      if \(localScreenVideoRef\.current\) \{/,
    `      setScreenEnabled(true);\n      publishGlobalCallState({ screenEnabled: true, screenStream: stream });\n      if (localScreenVideoRef.current) {`,
  );

  mustRegex(
    'peer leave bridge',
    /    setParticipantSpeaking\(peerId, false\);\n  \};\n\n  const endCall/,
    `    setParticipantSpeaking(peerId, false);\n    window.dispatchEvent(new CustomEvent('itbird-call-peer-left', { detail: { peerId } }));\n  };\n\n  const endCall`,
  );

  mustRegex(
    'global state clear',
    /(    const windowWithCall = window as ActiveCallWindow;\n)(\s*if \(windowWithCall\.__itbirdActiveCallEnd === endCall\) delete windowWithCall\.__itbirdActiveCallEnd;)/,
    `$1    windowWithCall.__itbirdActiveCallState = null;\n    window.dispatchEvent(new CustomEvent('itbird-call-state', { detail: null }));\n$2`,
  );

  mustRegex(
    'active call state bootstrap',
    /    window\.dispatchEvent\(new CustomEvent\("itbird-call-active", \{\s*detail: \{ chatId, mode, title, callKind, targetIds: callTargets, participants: visibleCallParticipants \},\s*\}\)\);/,
    `    const activeState = publishGlobalCallState({\n      micEnabled,\n      soundEnabled,\n      videoEnabled,\n      screenEnabled,\n      localStream: localStreamRef.current,\n      screenStream: screenStreamRef.current,\n    });\n    window.dispatchEvent(new CustomEvent("itbird-call-active", { detail: activeState }));`,
  );

  fs.writeFileSync(file, source, 'utf8');
} else {
  // Normalize CRLF on already-patched files too so future structural checks stay stable.
  fs.writeFileSync(file, source, 'utf8');
}

verifyCurrent();

const cssFile = 'src/styles/chat-platform-v1.css';
let css = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n') : '';
if (!css.includes('SOCIALBIRD_GLOBAL_CALL_V1')) {
  css += `\n/* SOCIALBIRD_GLOBAL_CALL_V1: old route-owned call panel is replaced by GlobalCallOverlay */\n.itbird-call-panel { display: none !important; }\n`;
  fs.writeFileSync(cssFile, css, 'utf8');
}

console.log('Global call overlay integration applied: active calls persist across route changes and remote/local screen video can be fullscreen.');

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

console.log('Global call overlay integration applied: active calls persist across route changes and remote/local screen video can be fullscreen.');

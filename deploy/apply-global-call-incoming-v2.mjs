import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const file = 'src/components/RealtimeNotifications.tsx';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const marker = '// SOCIALBIRD_GLOBAL_CALL_INCOMING_V2: accepted-incoming-overlay';

const replaceOnce = (label, from, to) => {
  if (!source.includes(from)) throw new Error(`Incoming global call patch failed: ${label}`);
  source = source.replace(from, to);
};

if (!source.includes(marker)) {
  replaceOnce(
    'global incoming call window type',
    `type IncomingCall = {\n  senderId: number;\n  targetIds: number[];\n  chatId: number | string;\n  mode: \"private\" | \"group\";\n  title?: string;\n  description?: RTCSessionDescriptionInit;\n  candidate?: RTCIceCandidateInit;\n  callKind?: \"voice\" | \"video\";\n  callerName?: string;\n  isRenegotiation?: boolean;\n  participants?: CallParticipant[];\n};`,
    `type IncomingCall = {\n  senderId: number;\n  targetIds: number[];\n  chatId: number | string;\n  mode: \"private\" | \"group\";\n  title?: string;\n  description?: RTCSessionDescriptionInit;\n  candidate?: RTCIceCandidateInit;\n  callKind?: \"voice\" | \"video\";\n  callerName?: string;\n  isRenegotiation?: boolean;\n  participants?: CallParticipant[];\n};\n\ntype IncomingGlobalCallWindow = typeof window & {\n  __itbirdActiveCallEnd?: () => void;\n  __itbirdActiveCallToggleMic?: () => void;\n  __itbirdActiveCallToggleSound?: () => void;\n  __itbirdActiveCallToggleVideo?: () => void;\n  __itbirdActiveCallToggleScreen?: () => void;\n  __itbirdActiveCallState?: Record<string, unknown> | null;\n};`,
  );

  replaceOnce(
    'cleanup accepted incoming global state',
    `  const cleanupCall = () => {\n    peerWatchdogStopRef.current?.();`,
    `  const cleanupCall = () => {\n    ${marker}\n    const currentActive = activeCallRef.current;\n    if (currentActive && currentActive.senderId !== 0) {\n      const callWindow = window as IncomingGlobalCallWindow;\n      const globalState = (callWindow.__itbirdActiveCallState || {}) as Record<string, unknown>;\n      if (String(globalState.chatId || \"\") === String(currentActive.chatId || \"\")) {\n        callWindow.__itbirdActiveCallState = null;\n        delete callWindow.__itbirdActiveCallEnd;\n        delete callWindow.__itbirdActiveCallToggleMic;\n        delete callWindow.__itbirdActiveCallToggleSound;\n        delete callWindow.__itbirdActiveCallToggleVideo;\n        delete callWindow.__itbirdActiveCallToggleScreen;\n        window.dispatchEvent(new CustomEvent(\"itbird-call-state\", { detail: null }));\n        window.dispatchEvent(new CustomEvent(\"itbird-call-ended\", {\n          detail: { chatId: currentActive.chatId, mode: currentActive.mode, source: \"RealtimeNotifications\" },\n        }));\n      }\n    }\n    peerWatchdogStopRef.current?.();`,
  );

  replaceOnce(
    'incoming remote video bridge',
    `        if (remoteStream.getVideoTracks().length > 0) {\n          const videoRoot = remoteVideoRef.current;`,
    `        if (remoteStream.getVideoTracks().length > 0) {\n          window.dispatchEvent(new CustomEvent(\"itbird-call-remote-stream\", {\n            detail: { peerId: incomingCall.senderId, stream: remoteStream },\n          }));\n          const videoRoot = remoteVideoRef.current;`,
  );

  replaceOnce(
    'accepted incoming global overlay state',
    `      setActiveCall(incomingCall);\n      setIncomingCall(null);\n      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));`,
    `      setActiveCall(incomingCall);\n      setIncomingCall(null);\n\n      const callWindow = window as IncomingGlobalCallWindow;\n      const acceptedState = {\n        chatId: incomingCall.chatId,\n        mode: incomingCall.mode,\n        title: incomingCall.title || incomingCall.callerName || \"Активный звонок\",\n        callKind: incomingCall.callKind || \"voice\",\n        participants: incomingCall.participants || [],\n        micEnabled: true,\n        soundEnabled: true,\n        videoEnabled: wantsVideo,\n        screenEnabled: false,\n        localStream: stream,\n        screenStream: null,\n        direction: \"incoming\",\n      };\n      callWindow.__itbirdActiveCallState = acceptedState;\n      window.dispatchEvent(new CustomEvent(\"itbird-call-active\", { detail: acceptedState }));\n      window.dispatchEvent(new CustomEvent(\"itbird-call-state\", { detail: acceptedState }));\n\n      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));`,
  );

  replaceOnce(
    'incoming global controls effect anchor',
    `  useEffect(() => {\n    if (!activeCall || activeCall.senderId === 0) return;\n    const timer = window.setInterval(() => { void repairIncomingMicrophone(); }, 2500);`,
    `  useEffect(() => {\n    if (!activeCall || activeCall.senderId === 0) return;\n    const callWindow = window as IncomingGlobalCallWindow;\n    callWindow.__itbirdActiveCallEnd = declineIncomingCall;\n    callWindow.__itbirdActiveCallToggleMic = toggleMic;\n    callWindow.__itbirdActiveCallToggleSound = toggleSound;\n    callWindow.__itbirdActiveCallToggleVideo = () => { void toggleVideo(); };\n    callWindow.__itbirdActiveCallToggleScreen = () => { void toggleScreenShare(); };\n\n    const previous = (callWindow.__itbirdActiveCallState || {}) as Record<string, unknown>;\n    const state = {\n      ...previous,\n      chatId: activeCall.chatId,\n      mode: activeCall.mode,\n      title: activeCall.title || activeCall.callerName || \"Активный звонок\",\n      callKind: activeCall.callKind || (videoEnabled ? \"video\" : \"voice\"),\n      participants: activeCall.participants || [],\n      micEnabled,\n      soundEnabled,\n      videoEnabled,\n      screenEnabled,\n      localStream: localStreamRef.current,\n      screenStream: screenStreamRef.current,\n      direction: \"incoming\",\n    };\n    callWindow.__itbirdActiveCallState = state;\n    window.dispatchEvent(new CustomEvent(\"itbird-call-state\", { detail: state }));\n\n    const timer = window.setInterval(() => { void repairIncomingMicrophone(); }, 2500);`,
  );

  replaceOnce(
    'incoming controls effect dependencies',
    `  }, [activeCall?.senderId, micEnabled]);`,
    `  }, [activeCall?.senderId, activeCall?.chatId, activeCall?.callKind, micEnabled, soundEnabled, videoEnabled, screenEnabled]);`,
  );

  fs.writeFileSync(file, source, 'utf8');
}

for (const expected of [
  marker,
  'IncomingGlobalCallWindow',
  'direction: "incoming"',
  '__itbirdActiveCallState = acceptedState',
  '__itbirdActiveCallEnd = declineIncomingCall',
  'itbird-call-remote-stream',
]) {
  if (!source.includes(expected)) throw new Error(`Incoming global call verification failed: ${expected}`);
}

const result = spawnSync(process.execPath, ['--check', 'deploy/apply-global-call-incoming-v2.mjs'], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('Incoming global call patcher syntax check failed');

console.log('Incoming global call V2 applied: accepted incoming calls stay visible in GlobalCallOverlay with working controls until hangup.');

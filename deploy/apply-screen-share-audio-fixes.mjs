import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const patchFile = (relativePath, transform) => {
  const filePath = path.join(root, relativePath);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    console.log(`Applied screen-share fix: ${relativePath}`);
  }
};

const replaceRequired = (source, label, from, to) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Screen-share patch failed: ${label}`);
  return source.replace(from, to);
};

const replaceSection = (source, label, startMarker, endMarker, replacement) => {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Screen-share patch failed: ${label} start`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Screen-share patch failed: ${label} end`);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
};

patchFile('src/components/VoiceCallControls.tsx', (input) => {
  let source = input;
  if (source.includes('SCREEN_SHARE_AUDIO_FIX: outgoing')) return source;

  if (!source.includes('@/lib/screen-share')) {
    const marker = '} from "@/lib/call-audio-reliability";';
    if (!source.includes(marker)) throw new Error('Screen-share patch failed: outgoing import marker');
    source = source.replace(
      marker,
      `${marker}\nimport {\n  getMissingScreenAudioMessage,\n  getScreenShareAvailability,\n  getScreenShareErrorMessage,\n  requestScreenShare,\n} from "@/lib/screen-share";`,
    );
  }

  source = replaceRequired(
    source,
    'outgoing screen audio sender ref',
    '  const screenSendersRef = useRef<Record<number, RTCRtpSender>>({});',
    '  const screenSendersRef = useRef<Record<number, RTCRtpSender>>({});\n  const screenAudioSendersRef = useRef<Record<number, RTCRtpSender[]>>({});',
  );

  source = source.replace(
    '  const remoteAudioTracksRef = useRef<Record<number, MediaStreamTrack>>({});',
    '  const remoteAudioTracksRef = useRef<Record<string, { sourcePeerId: number; track: MediaStreamTrack }>>({});',
  );
  source = source.replace(
    '  const relayAudioSendersRef = useRef<Record<number, Record<number, RTCRtpSender>>>({});',
    '  const relayAudioSendersRef = useRef<Record<number, Record<string, RTCRtpSender>>>({});',
  );

  const relayStart = '  const relayGroupAudioTrack = async (sourcePeerId: number, track: MediaStreamTrack) => {';
  const relayEnd = source.includes('  const relayGroupVideoTrack = async')
    ? '  const relayGroupVideoTrack = async'
    : '  const repairLocalMicrophone = async';
  const newRelay = `  const relayGroupAudioTrack = async (sourcePeerId: number, track: MediaStreamTrack) => {\n    if (mode !== 'group' || track.kind !== 'audio') return;\n    const trackKey = \`\${sourcePeerId}:\${track.id}\`;\n    remoteAudioTracksRef.current[trackKey] = { sourcePeerId, track };\n\n    for (const [targetKey, peer] of Object.entries(peersRef.current)) {\n      const targetPeerId = Number(targetKey);\n      if (targetPeerId === sourcePeerId || peer.signalingState === 'closed') continue;\n      relayAudioSendersRef.current[targetPeerId] ||= {};\n      if (relayAudioSendersRef.current[targetPeerId][trackKey]) continue;\n\n      relayAudioSendersRef.current[targetPeerId][trackKey] = peer.addTrack(track, new MediaStream([track]));\n      sendSignal('CALL_RELAY_TRACK', [targetPeerId], { sourcePeerId, trackId: track.id, kind: 'audio' });\n\n      if (peer.remoteDescription && peer.signalingState === 'stable') {\n        await renegotiate(targetPeerId);\n      } else {\n        relayNeedsRenegotiationRef.current[targetPeerId] = true;\n      }\n    }\n\n    track.addEventListener('ended', () => {\n      delete remoteAudioTracksRef.current[trackKey];\n      for (const [targetKey, senderMap] of Object.entries(relayAudioSendersRef.current)) {\n        const sender = senderMap[trackKey];\n        if (!sender) continue;\n        const targetPeerId = Number(targetKey);\n        const peer = peersRef.current[targetPeerId];\n        if (peer && peer.signalingState !== 'closed') {\n          try { peer.removeTrack(sender); } catch {}\n          if (peer.remoteDescription && peer.signalingState === 'stable') void renegotiate(targetPeerId);\n        }\n        delete senderMap[trackKey];\n      }\n    }, { once: true });\n  };\n\n`;
  source = replaceSection(source, 'multi-track group audio relay', relayStart, relayEnd, newRelay);

  const oldKnownAudio = `      for (const [sourceKey, audioTrack] of Object.entries(remoteAudioTracksRef.current)) {\n        const sourcePeerId = Number(sourceKey);\n        if (sourcePeerId === peerId || audioTrack.readyState !== 'live') continue;\n        relayAudioSendersRef.current[peerId] ||= {};\n        relayAudioSendersRef.current[peerId][sourcePeerId] = peer.addTrack(audioTrack, new MediaStream([audioTrack]));\n        sendSignal('CALL_RELAY_TRACK', [peerId], { sourcePeerId, trackId: audioTrack.id });\n      }`;
  const newKnownAudio = `      for (const [trackKey, entry] of Object.entries(remoteAudioTracksRef.current)) {\n        if (entry.sourcePeerId === peerId || entry.track.readyState !== 'live') continue;\n        relayAudioSendersRef.current[peerId] ||= {};\n        if (relayAudioSendersRef.current[peerId][trackKey]) continue;\n        relayAudioSendersRef.current[peerId][trackKey] = peer.addTrack(entry.track, new MediaStream([entry.track]));\n        sendSignal('CALL_RELAY_TRACK', [peerId], { sourcePeerId: entry.sourcePeerId, trackId: entry.track.id, kind: 'audio' });\n      }`;
  source = replaceRequired(source, 'known group audio tracks', oldKnownAudio, newKnownAudio);
  source = source.replace('        remoteAudioTracksRef.current[peerId] = event.track;\n', '        // SCREEN_SHARE_AUDIO_FIX: relayGroupAudioTrack stores every remote audio track independently.\n');

  source = source.replace(
    '    delete remoteAudioTracksRef.current[peerId];',
    `    Object.entries(remoteAudioTracksRef.current).forEach(([trackKey, entry]) => {\n      if (entry.sourcePeerId === peerId) delete remoteAudioTracksRef.current[trackKey];\n    });`,
  );

  const hasMediaBus = source.includes('publishLocalScreen');
  const screenStart = '  // APP_FIX: removable-screen-track\n  const stopScreenShare = async () => {';
  const screenEnd = '\n  useEffect(() => {';
  const busStop = hasMediaBus ? '    publishLocalScreen(null);\n' : '';
  const busStart = hasMediaBus ? '      publishLocalScreen(videoTrack);\n' : '';
  const replacement = `  // APP_FIX: removable-screen-track\n  // SCREEN_SHARE_AUDIO_FIX: outgoing\n  const stopScreenShare = async () => {\n    for (const [peerId, sender] of Object.entries(screenSendersRef.current)) {\n      const peer = peersRef.current[Number(peerId)];\n      if (peer && peer.signalingState !== 'closed') {\n        try { peer.removeTrack(sender); } catch {}\n      }\n    }\n    for (const [peerId, senders] of Object.entries(screenAudioSendersRef.current)) {\n      const peer = peersRef.current[Number(peerId)];\n      if (!peer || peer.signalingState === 'closed') continue;\n      senders.forEach((sender) => {\n        try { peer.removeTrack(sender); } catch {}\n      });\n    }\n    screenSendersRef.current = {};\n    screenAudioSendersRef.current = {};\n    screenStreamRef.current?.getTracks().forEach((track) => track.stop());\n    screenStreamRef.current = null;\n${busStop}    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;\n    setScreenEnabled(false);\n    await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id))));\n  };\n\n  const toggleScreenShare = async () => {\n    if (screenEnabled) {\n      await stopScreenShare();\n      return;\n    }\n\n    const availability = getScreenShareAvailability();\n    if (!availability.supported) {\n      toast({ title: 'Демонстрация экрана', description: availability.reason, variant: 'destructive' });\n      return;\n    }\n\n    try {\n      const { stream, videoTrack, audioTracks } = await requestScreenShare();\n      screenStreamRef.current = stream;\n      screenSendersRef.current = {};\n      screenAudioSendersRef.current = {};\n\n      for (const [peerId, peer] of Object.entries(peersRef.current)) {\n        const normalizedPeerId = Number(peerId);\n        screenSendersRef.current[normalizedPeerId] = peer.addTrack(videoTrack, stream);\n        screenAudioSendersRef.current[normalizedPeerId] = audioTracks.map((audioTrack) => peer.addTrack(audioTrack, stream));\n      }\n\n      videoTrack.onended = () => { void stopScreenShare(); };\n      setScreenEnabled(true);\n${busStart}      if (localScreenVideoRef.current) {\n        localScreenVideoRef.current.srcObject = stream;\n        localScreenVideoRef.current.play().catch(() => undefined);\n      }\n      await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id))));\n\n      if (audioTracks.length === 0) {\n        toast({ title: 'Звук демонстрации', description: getMissingScreenAudioMessage() });\n      }\n    } catch (error) {\n      toast({ title: 'Демонстрация экрана', description: getScreenShareErrorMessage(error), variant: 'destructive' });\n    }\n  };\n`;
  source = replaceSection(source, 'outgoing screen share lifecycle', screenStart, screenEnd, replacement);

  if (!source.includes('screenAudioSendersRef.current = {};\n    pendingIceByPeerRef.current = {};')) {
    source = source.replace(
      '    screenSendersRef.current = {};\n    pendingIceByPeerRef.current = {};',
      '    screenSendersRef.current = {};\n    screenAudioSendersRef.current = {};\n    pendingIceByPeerRef.current = {};',
    );
  }

  return source;
});

patchFile('src/components/RealtimeNotifications.tsx', (input) => {
  let source = input;
  if (source.includes('SCREEN_SHARE_AUDIO_FIX: incoming')) return source;

  if (!source.includes('@/lib/screen-share')) {
    const marker = '} from "@/lib/call-audio-reliability";';
    if (!source.includes(marker)) throw new Error('Screen-share patch failed: incoming import marker');
    source = source.replace(
      marker,
      `${marker}\nimport {\n  getMissingScreenAudioMessage,\n  getScreenShareAvailability,\n  getScreenShareErrorMessage,\n  requestScreenShare,\n} from "@/lib/screen-share";`,
    );
  }

  source = replaceRequired(
    source,
    'incoming screen audio sender ref',
    '  const screenSenderRef = useRef<RTCRtpSender | null>(null);',
    '  const screenSenderRef = useRef<RTCRtpSender | null>(null);\n  const screenAudioSenderRef = useRef<RTCRtpSender[]>([]);',
  );

  if (!source.includes('screenAudioSenderRef.current = [];\n    localStreamRef.current')) {
    source = source.replace(
      '    screenSenderRef.current = null;\n    localStreamRef.current?.getTracks()',
      '    screenSenderRef.current = null;\n    screenAudioSenderRef.current = [];\n    localStreamRef.current?.getTracks()',
    );
  }

  const hasMediaBus = source.includes('publishLocalScreen');
  const screenStart = '  // APP_FIX: incoming-screen-track-lifecycle\n  const stopIncomingScreenShare = async () => {';
  const screenEnd = '\n  const toggleVideo = async () => {';
  const busStop = hasMediaBus ? '    publishLocalScreen(null);\n' : '';
  const busStart = hasMediaBus ? '      publishLocalScreen(videoTrack);\n' : '';
  const replacement = `  // APP_FIX: incoming-screen-track-lifecycle\n  // SCREEN_SHARE_AUDIO_FIX: incoming\n  const stopIncomingScreenShare = async () => {\n    if (peerRef.current && screenSenderRef.current && peerRef.current.signalingState !== 'closed') {\n      try { peerRef.current.removeTrack(screenSenderRef.current); } catch {}\n    }\n    if (peerRef.current && peerRef.current.signalingState !== 'closed') {\n      screenAudioSenderRef.current.forEach((sender) => {\n        try { peerRef.current?.removeTrack(sender); } catch {}\n      });\n    }\n    screenSenderRef.current = null;\n    screenAudioSenderRef.current = [];\n    screenStreamRef.current?.getTracks().forEach((track) => track.stop());\n    screenStreamRef.current = null;\n${busStop}    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;\n    setScreenEnabled(false);\n    await renegotiateActivePeer();\n  };\n\n  const toggleScreenShare = async () => {\n    if (activeCall?.senderId === 0) {\n      (window as typeof window & { __itbirdActiveCallToggleScreen?: () => void }).__itbirdActiveCallToggleScreen?.();\n      return;\n    }\n\n    if (screenEnabled) {\n      await stopIncomingScreenShare();\n      return;\n    }\n\n    if (!peerRef.current) return;\n    const availability = getScreenShareAvailability();\n    if (!availability.supported) {\n      toast({ title: 'Демонстрация экрана', description: availability.reason, variant: 'destructive' });\n      return;\n    }\n\n    try {\n      const { stream, videoTrack, audioTracks } = await requestScreenShare();\n      screenStreamRef.current = stream;\n      screenSenderRef.current = peerRef.current.addTrack(videoTrack, stream);\n      screenAudioSenderRef.current = audioTracks.map((audioTrack) => peerRef.current?.addTrack(audioTrack, stream)).filter(Boolean) as RTCRtpSender[];\n      videoTrack.onended = () => { void stopIncomingScreenShare(); };\n      setScreenEnabled(true);\n${busStart}      if (localScreenVideoRef.current) {\n        localScreenVideoRef.current.srcObject = stream;\n        localScreenVideoRef.current.play().catch(() => undefined);\n      }\n      await renegotiateActivePeer();\n\n      if (audioTracks.length === 0) {\n        toast({ title: 'Звук демонстрации', description: getMissingScreenAudioMessage() });\n      }\n    } catch (error) {\n      toast({ title: 'Демонстрация экрана', description: getScreenShareErrorMessage(error), variant: 'destructive' });\n    }\n  };\n`;
  source = replaceSection(source, 'incoming screen share lifecycle', screenStart, screenEnd, replacement);

  return source;
});

console.log('Screen-share audio/mobile fixes are current.');

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
    console.log(`Applied screen-share v2 fix: ${relativePath}`);
  }
};

const replaceRequired = (source, label, from, to) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Screen-share v2 patch failed: ${label}`);
  return source.replace(from, to);
};

const replaceSection = (source, label, startMarker, endMarker, replacement) => {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Screen-share v2 patch failed: ${label} start`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Screen-share v2 patch failed: ${label} end`);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
};

const addScreenShareImport = (source, label) => {
  if (source.includes('@/lib/screen-share')) return source;
  const marker = '} from "@/lib/call-audio-reliability";';
  if (!source.includes(marker)) throw new Error(`Screen-share v2 patch failed: ${label} import marker`);
  return source.replace(
    marker,
    `${marker}\nimport {\n  getMissingScreenAudioMessage,\n  getScreenShareAvailability,\n  getScreenShareErrorMessage,\n  requestScreenShare,\n} from "@/lib/screen-share";`,
  );
};

patchFile('src/components/VoiceCallControls.tsx', (input) => {
  let source = input;

  // Refuse to layer v2 over the old invasive patch. The repair updater restores the
  // exact pre-screen-share call files first. CI also reaches this file before any
  // screen-share patch is applied.
  if (source.includes('SCREEN_SHARE_AUDIO_FIX: outgoing') && !source.includes('SCREEN_SHARE_AUDIO_V2: outgoing')) {
    throw new Error('Old invasive screen-share patch detected. Restore the pre-screen-share call backup before applying v2.');
  }
  if (source.includes('SCREEN_SHARE_AUDIO_V2: outgoing')) return source;

  source = addScreenShareImport(source, 'outgoing');

  source = replaceRequired(
    source,
    'outgoing screen audio sender refs',
    '  const screenSendersRef = useRef<Record<number, RTCRtpSender>>({});',
    '  const screenSendersRef = useRef<Record<number, RTCRtpSender>>({});\n  const screenAudioSendersRef = useRef<Record<number, RTCRtpSender[]>>({});\n  const extraRemoteAudioTracksRef = useRef<Record<string, { sourcePeerId: number; track: MediaStreamTrack }>>({});\n  const relayExtraAudioSendersRef = useRef<Record<number, Record<string, RTCRtpSender>>>({});',
  );

  // Keep the proven microphone relay untouched. Extra audio (screen/system sound)
  // gets a separate map so it cannot overwrite the microphone sender or break
  // ordinary PC<->phone calls.
  const relayStart = '  const relayGroupAudioTrack = async (sourcePeerId: number, track: MediaStreamTrack) => {';
  const relayEnd = source.includes('  const relayGroupVideoTrack = async')
    ? '  const relayGroupVideoTrack = async'
    : '  const repairLocalMicrophone = async';
  const safeRelay = `  const relayGroupAudioTrack = async (sourcePeerId: number, track: MediaStreamTrack) => {\n    if (mode !== 'group' || track.kind !== 'audio') return;\n\n    const primaryTrack = remoteAudioTracksRef.current[sourcePeerId];\n    if (!primaryTrack || primaryTrack.id === track.id) {\n      remoteAudioTracksRef.current[sourcePeerId] = track;\n\n      for (const [targetKey, peer] of Object.entries(peersRef.current)) {\n        const targetPeerId = Number(targetKey);\n        if (targetPeerId === sourcePeerId || peer.signalingState === 'closed') continue;\n        relayAudioSendersRef.current[targetPeerId] ||= {};\n        if (relayAudioSendersRef.current[targetPeerId][sourcePeerId]) continue;\n\n        const relayStream = new MediaStream([track]);\n        relayAudioSendersRef.current[targetPeerId][sourcePeerId] = peer.addTrack(track, relayStream);\n        sendSignal('CALL_RELAY_TRACK', [targetPeerId], { sourcePeerId, trackId: track.id, kind: 'audio' });\n\n        if (peer.remoteDescription && peer.signalingState === 'stable') {\n          await renegotiate(targetPeerId);\n        } else {\n          relayNeedsRenegotiationRef.current[targetPeerId] = true;\n        }\n      }\n      return;\n    }\n\n    const extraKey = \`\${sourcePeerId}:\${track.id}\`;\n    extraRemoteAudioTracksRef.current[extraKey] = { sourcePeerId, track };\n\n    for (const [targetKey, peer] of Object.entries(peersRef.current)) {\n      const targetPeerId = Number(targetKey);\n      if (targetPeerId === sourcePeerId || peer.signalingState === 'closed') continue;\n      relayExtraAudioSendersRef.current[targetPeerId] ||= {};\n      if (relayExtraAudioSendersRef.current[targetPeerId][extraKey]) continue;\n\n      relayExtraAudioSendersRef.current[targetPeerId][extraKey] = peer.addTrack(track, new MediaStream([track]));\n      sendSignal('CALL_RELAY_TRACK', [targetPeerId], { sourcePeerId, trackId: track.id, kind: 'audio' });\n\n      if (peer.remoteDescription && peer.signalingState === 'stable') {\n        await renegotiate(targetPeerId);\n      } else {\n        relayNeedsRenegotiationRef.current[targetPeerId] = true;\n      }\n    }\n\n    track.addEventListener('ended', () => {\n      delete extraRemoteAudioTracksRef.current[extraKey];\n      Object.entries(relayExtraAudioSendersRef.current).forEach(([targetKey, senderMap]) => {\n        const sender = senderMap[extraKey];\n        if (!sender) return;\n        const peer = peersRef.current[Number(targetKey)];\n        if (peer && peer.signalingState !== 'closed') {\n          try { peer.removeTrack(sender); } catch {}\n        }\n        delete senderMap[extraKey];\n      });\n    }, { once: true });\n  };\n\n`;
  source = replaceSection(source, 'safe group screen-audio relay', relayStart, relayEnd, safeRelay);

  // A participant joining after screen-share started must also get the extra audio.
  const primaryKnownAudio = `      for (const [sourceKey, audioTrack] of Object.entries(remoteAudioTracksRef.current)) {\n        const sourcePeerId = Number(sourceKey);\n        if (sourcePeerId === peerId || audioTrack.readyState !== 'live') continue;\n        relayAudioSendersRef.current[peerId] ||= {};\n        relayAudioSendersRef.current[peerId][sourcePeerId] = peer.addTrack(audioTrack, new MediaStream([audioTrack]));\n        sendSignal('CALL_RELAY_TRACK', [peerId], { sourcePeerId, trackId: audioTrack.id });\n      }`;
  if (source.includes(primaryKnownAudio) && !source.includes('SCREEN_SHARE_AUDIO_V2: include-extra-audio')) {
    source = source.replace(
      primaryKnownAudio,
      `${primaryKnownAudio}\n\n      // SCREEN_SHARE_AUDIO_V2: include-extra-audio\n      for (const [extraKey, entry] of Object.entries(extraRemoteAudioTracksRef.current)) {\n        if (entry.sourcePeerId === peerId || entry.track.readyState !== 'live') continue;\n        relayExtraAudioSendersRef.current[peerId] ||= {};\n        if (relayExtraAudioSendersRef.current[peerId][extraKey]) continue;\n        relayExtraAudioSendersRef.current[peerId][extraKey] = peer.addTrack(entry.track, new MediaStream([entry.track]));\n        sendSignal('CALL_RELAY_TRACK', [peerId], { sourcePeerId: entry.sourcePeerId, trackId: entry.track.id, kind: 'audio' });\n      }`,
    );
  }

  const hasMediaBus = source.includes('publishLocalScreen');
  const screenStart = '  // APP_FIX: removable-screen-track\n  const stopScreenShare = async () => {';
  const screenEnd = '\n  useEffect(() => {';
  const busStop = hasMediaBus ? '    publishLocalScreen(null);\n' : '';
  const busStart = hasMediaBus ? '      publishLocalScreen(videoTrack);\n' : '';
  const replacement = `  // APP_FIX: removable-screen-track\n  // SCREEN_SHARE_AUDIO_V2: outgoing\n  const stopScreenShare = async () => {\n    for (const [peerId, sender] of Object.entries(screenSendersRef.current)) {\n      const peer = peersRef.current[Number(peerId)];\n      if (peer && peer.signalingState !== 'closed') {\n        try { peer.removeTrack(sender); } catch {}\n      }\n    }\n    for (const [peerId, senders] of Object.entries(screenAudioSendersRef.current)) {\n      const peer = peersRef.current[Number(peerId)];\n      if (!peer || peer.signalingState === 'closed') continue;\n      senders.forEach((sender) => {\n        try { peer.removeTrack(sender); } catch {}\n      });\n    }\n    screenSendersRef.current = {};\n    screenAudioSendersRef.current = {};\n    screenStreamRef.current?.getTracks().forEach((track) => track.stop());\n    screenStreamRef.current = null;\n${busStop}    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;\n    setScreenEnabled(false);\n    await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id))));\n  };\n\n  const toggleScreenShare = async () => {\n    if (screenEnabled) {\n      await stopScreenShare();\n      return;\n    }\n\n    const availability = getScreenShareAvailability();\n    if (!availability.supported) {\n      toast({ title: 'Демонстрация экрана', description: availability.reason, variant: 'destructive' });\n      return;\n    }\n\n    try {\n      const { stream, videoTrack, audioTracks } = await requestScreenShare();\n      screenStreamRef.current = stream;\n      screenSendersRef.current = {};\n      screenAudioSendersRef.current = {};\n\n      // Do not bundle screen video + screen audio in one remote MediaStream. Some\n      // browsers emit ontrack once per track with the same stream, which previously\n      // made the UI render the same demonstration two/three times.\n      const videoOnlyStream = new MediaStream([videoTrack]);\n      for (const [peerId, peer] of Object.entries(peersRef.current)) {\n        const normalizedPeerId = Number(peerId);\n        screenSendersRef.current[normalizedPeerId] = peer.addTrack(videoTrack, videoOnlyStream);\n        screenAudioSendersRef.current[normalizedPeerId] = audioTracks.map((audioTrack) =>\n          peer.addTrack(audioTrack, new MediaStream([audioTrack]))\n        );\n      }\n\n      videoTrack.onended = () => { void stopScreenShare(); };\n      setScreenEnabled(true);\n${busStart}      if (localScreenVideoRef.current) {\n        localScreenVideoRef.current.srcObject = new MediaStream([videoTrack]);\n        localScreenVideoRef.current.play().catch(() => undefined);\n      }\n      await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id))));\n\n      if (audioTracks.length === 0) {\n        toast({ title: 'Звук демонстрации', description: getMissingScreenAudioMessage() });\n      }\n    } catch (error) {\n      toast({ title: 'Демонстрация экрана', description: getScreenShareErrorMessage(error), variant: 'destructive' });\n    }\n  };\n`;
  source = replaceSection(source, 'outgoing screen lifecycle', screenStart, screenEnd, replacement);

  source = source.replace(
    '    screenSendersRef.current = {};\n    pendingIceByPeerRef.current = {};',
    '    screenSendersRef.current = {};\n    screenAudioSendersRef.current = {};\n    extraRemoteAudioTracksRef.current = {};\n    relayExtraAudioSendersRef.current = {};\n    pendingIceByPeerRef.current = {};',
  );

  return source;
});

patchFile('src/components/RealtimeNotifications.tsx', (input) => {
  let source = input;
  if (source.includes('SCREEN_SHARE_AUDIO_FIX: incoming') && !source.includes('SCREEN_SHARE_AUDIO_V2: incoming')) {
    throw new Error('Old invasive screen-share patch detected in RealtimeNotifications. Restore the pre-screen-share call backup before applying v2.');
  }
  if (source.includes('SCREEN_SHARE_AUDIO_V2: incoming')) return source;

  source = addScreenShareImport(source, 'incoming');

  source = replaceRequired(
    source,
    'incoming screen audio sender ref',
    '  const screenSenderRef = useRef<RTCRtpSender | null>(null);',
    '  const screenSenderRef = useRef<RTCRtpSender | null>(null);\n  const screenAudioSenderRef = useRef<RTCRtpSender[]>([]);',
  );

  source = source.replace(
    '    screenSenderRef.current = null;\n    localStreamRef.current?.getTracks()',
    '    screenSenderRef.current = null;\n    screenAudioSenderRef.current = [];\n    localStreamRef.current?.getTracks()',
  );

  const hasMediaBus = source.includes('publishLocalScreen');
  const screenStart = '  // APP_FIX: incoming-screen-track-lifecycle\n  const stopIncomingScreenShare = async () => {';
  const screenEnd = '\n  const toggleVideo = async () => {';
  const busStop = hasMediaBus ? '    publishLocalScreen(null);\n' : '';
  const busStart = hasMediaBus ? '      publishLocalScreen(videoTrack);\n' : '';
  const replacement = `  // APP_FIX: incoming-screen-track-lifecycle\n  // SCREEN_SHARE_AUDIO_V2: incoming\n  const stopIncomingScreenShare = async () => {\n    if (peerRef.current && screenSenderRef.current && peerRef.current.signalingState !== 'closed') {\n      try { peerRef.current.removeTrack(screenSenderRef.current); } catch {}\n    }\n    if (peerRef.current && peerRef.current.signalingState !== 'closed') {\n      screenAudioSenderRef.current.forEach((sender) => {\n        try { peerRef.current?.removeTrack(sender); } catch {}\n      });\n    }\n    screenSenderRef.current = null;\n    screenAudioSenderRef.current = [];\n    screenStreamRef.current?.getTracks().forEach((track) => track.stop());\n    screenStreamRef.current = null;\n${busStop}    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;\n    setScreenEnabled(false);\n    await renegotiateActivePeer();\n  };\n\n  const toggleScreenShare = async () => {\n    if (activeCall?.senderId === 0) {\n      (window as typeof window & { __itbirdActiveCallToggleScreen?: () => void }).__itbirdActiveCallToggleScreen?.();\n      // Keep the global panel in sync with the actual outgoing call. The previous\n      // patch stopped updating this state, so repeated taps started multiple shares.\n      setScreenEnabled((current) => !current);\n      return;\n    }\n\n    if (screenEnabled) {\n      await stopIncomingScreenShare();\n      return;\n    }\n\n    if (!peerRef.current) return;\n    const availability = getScreenShareAvailability();\n    if (!availability.supported) {\n      toast({ title: 'Демонстрация экрана', description: availability.reason, variant: 'destructive' });\n      return;\n    }\n\n    try {\n      const { stream, videoTrack, audioTracks } = await requestScreenShare();\n      screenStreamRef.current = stream;\n      screenSenderRef.current = peerRef.current.addTrack(videoTrack, new MediaStream([videoTrack]));\n      screenAudioSenderRef.current = audioTracks.map((audioTrack) =>\n        peerRef.current?.addTrack(audioTrack, new MediaStream([audioTrack]))\n      ).filter(Boolean) as RTCRtpSender[];\n      videoTrack.onended = () => { void stopIncomingScreenShare(); };\n      setScreenEnabled(true);\n${busStart}      if (localScreenVideoRef.current) {\n        localScreenVideoRef.current.srcObject = new MediaStream([videoTrack]);\n        localScreenVideoRef.current.play().catch(() => undefined);\n      }\n      await renegotiateActivePeer();\n\n      if (audioTracks.length === 0) {\n        toast({ title: 'Звук демонстрации', description: getMissingScreenAudioMessage() });\n      }\n    } catch (error) {\n      toast({ title: 'Демонстрация экрана', description: getScreenShareErrorMessage(error), variant: 'destructive' });\n    }\n  };\n`;
  source = replaceSection(source, 'incoming screen lifecycle', screenStart, screenEnd, replacement);

  return source;
});

console.log('Screen-share audio v2 fixes are current.');

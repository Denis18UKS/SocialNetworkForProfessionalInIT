import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(deployDirectory, '..');

const patch = (relativePath, transform) => {
  const filePath = path.join(root, relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  const initial = source;
  source = transform(source);
  if (source !== initial) {
    fs.writeFileSync(filePath, source, 'utf8');
    console.log(`Applied call reliability fixes: ${relativePath}`);
  }
};

const replaceRequired = (source, label, from, to) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Call reliability fix failed: ${label}`);
  return source.replace(from, to);
};

patch('src/components/VoiceCallControls.tsx', (input) => {
  let source = input;

  if (!source.includes('@/lib/call-audio-reliability')) {
    source = source.replace(
      'import { createReconnectingWebSocket } from "@/lib/reconnecting-websocket";',
      `import { createReconnectingWebSocket } from "@/lib/reconnecting-websocket";\nimport {\n  attachPersistentAudioTrack,\n  createSpeakingMonitor,\n  recoverMicrophoneTrack,\n  watchPeerConnection,\n} from "@/lib/call-audio-reliability";`
    );
  }

  source = replaceRequired(
    source,
    'outgoing reliability refs',
    '  const pendingIceByPeerRef = useRef<Record<number, RTCIceCandidateInit[]>>({});',
    `  const pendingIceByPeerRef = useRef<Record<number, RTCIceCandidateInit[]>>({});\n  // CALL_RELIABILITY: persistent-audio-and-health\n  const localAudioSendersRef = useRef<Record<number, RTCRtpSender>>({});\n  const remoteAudioTracksRef = useRef<Record<number, MediaStreamTrack>>({});\n  const relayAudioSendersRef = useRef<Record<number, Record<number, RTCRtpSender>>>({});\n  const relayNeedsRenegotiationRef = useRef<Record<number, boolean>>({});\n  const peerWatchdogStopsRef = useRef<Record<number, () => void>>({});\n  const speakingMonitorStopsRef = useRef<Record<string, () => void>>({});\n  const remoteAudioPlaybackStopsRef = useRef<Record<string, () => void>>({});\n  const blockedAudioKeysRef = useRef<Set<string>>(new Set());`
  );

  source = replaceRequired(
    source,
    'outgoing speaking state',
    '  const [soundNeedsTap, setSoundNeedsTap] = useState(false);',
    `  const [soundNeedsTap, setSoundNeedsTap] = useState(false);\n  const [speakingUserIds, setSpeakingUserIds] = useState<number[]>([]);`
  );

  const previewEffect = `  // APP_FIX: local-preview-sync\n  useEffect(() => {\n    if (localVideoRef.current) {\n      localVideoRef.current.srcObject = localStreamRef.current;\n      localVideoRef.current.play().catch(() => undefined);\n    }\n    if (localScreenVideoRef.current) {\n      localScreenVideoRef.current.srcObject = screenStreamRef.current;\n      localScreenVideoRef.current.play().catch(() => undefined);\n    }\n  }, [isCalling, videoEnabled, screenEnabled]);`;

  const reliabilityHelpers = `${previewEffect}\n\n  // CALL_RELIABILITY: Discord-like speaking state and persistent remote audio.\n  const setParticipantSpeaking = (userId: number, speaking: boolean) => {\n    if (!Number.isFinite(Number(userId))) return;\n    setSpeakingUserIds((current) => {\n      const normalized = Number(userId);\n      if (speaking) return current.includes(normalized) ? current : [...current, normalized];\n      return current.filter((id) => id !== normalized);\n    });\n    window.dispatchEvent(new CustomEvent('itbird-call-speaking', {\n      detail: { chatId, mode, userId: Number(userId), speaking },\n    }));\n  };\n\n  const monitorSpeaking = (key: string, userId: number, stream: MediaStream) => {\n    if (stream.getAudioTracks().length === 0) return;\n    speakingMonitorStopsRef.current[key]?.();\n    speakingMonitorStopsRef.current[key] = createSpeakingMonitor(stream, (speaking) => {\n      setParticipantSpeaking(userId, speaking);\n    });\n  };\n\n  const setRemotePlaybackBlocked = (key: string, blocked: boolean) => {\n    if (blocked) blockedAudioKeysRef.current.add(key);\n    else blockedAudioKeysRef.current.delete(key);\n    setSoundNeedsTap(blockedAudioKeysRef.current.size > 0);\n  };`;

  source = replaceRequired(source, 'outgoing reliability helpers', previewEffect, reliabilityHelpers);

  source = replaceRequired(
    source,
    'local speaking monitor',
    `    if (localVideoRef.current) {\n      localVideoRef.current.srcObject = localStreamRef.current;\n    }\n\n    return localStreamRef.current;`,
    `    if (localVideoRef.current) {\n      localVideoRef.current.srcObject = localStreamRef.current;\n    }\n\n    const audioTrack = localStreamRef.current.getAudioTracks()[0];\n    if (audioTrack && currentUserId) {\n      const localSpeakingKey = \`local:\${audioTrack.id}\`;\n      if (!speakingMonitorStopsRef.current[localSpeakingKey]) {\n        monitorSpeaking(localSpeakingKey, currentUserId, new MediaStream([audioTrack]));\n      }\n    }\n\n    return localStreamRef.current;`
  );

  const oldAttach = `  const attachRemoteStream = (peerId: number, stream: MediaStream) => {\n    const container = remoteMediaRef.current || getGlobalMediaRoot();\n    const media = attachMediaElement(container, peerId, stream, !soundEnabled);\n    void playRemoteMedia(media).then((playing) => setSoundNeedsTap(!playing));\n  };`;

  const newAttach = `  const attachRemoteStream = (peerId: number, stream: MediaStream) => {\n    const audioTrack = stream.getAudioTracks()[0];\n    if (audioTrack) {\n      const key = \`remote:\${peerId}:\${audioTrack.id}\`;\n      if (!remoteAudioPlaybackStopsRef.current[key]) {\n        const binding = attachPersistentAudioTrack({\n          root: getGlobalMediaRoot(),\n          key,\n          track: audioTrack,\n          muted: !soundEnabled,\n          outputDeviceId: readSettings().audioOutputDeviceId,\n          onPlaybackBlocked: (blocked) => setRemotePlaybackBlocked(key, blocked),\n        });\n        remoteAudioPlaybackStopsRef.current[key] = binding.dispose;\n      } else {\n        const audio = Array.from(getGlobalMediaRoot().querySelectorAll<HTMLAudioElement>('audio[data-call-audio-key]'))\n          .find((element) => element.dataset.callAudioKey === key);\n        if (audio) {\n          audio.muted = !soundEnabled;\n          void playRemoteMedia(audio).then((playing) => setRemotePlaybackBlocked(key, !playing));\n        }\n      }\n\n      const speakingKey = \`speaking:\${peerId}:\${audioTrack.id}\`;\n      if (!speakingMonitorStopsRef.current[speakingKey]) {\n        monitorSpeaking(speakingKey, peerId, new MediaStream([audioTrack]));\n      }\n    }\n\n    if (stream.getVideoTracks().length > 0 && remoteMediaRef.current) {\n      // Audio has a dedicated persistent element, so video is intentionally muted.\n      attachMediaElement(remoteMediaRef.current, peerId, new MediaStream(stream.getVideoTracks()), true);\n    }\n  };\n\n  const relayGroupAudioTrack = async (sourcePeerId: number, track: MediaStreamTrack) => {\n    if (mode !== 'group' || track.kind !== 'audio') return;\n    remoteAudioTracksRef.current[sourcePeerId] = track;\n\n    for (const [targetKey, peer] of Object.entries(peersRef.current)) {\n      const targetPeerId = Number(targetKey);\n      if (targetPeerId === sourcePeerId || peer.signalingState === 'closed') continue;\n      relayAudioSendersRef.current[targetPeerId] ||= {};\n      if (relayAudioSendersRef.current[targetPeerId][sourcePeerId]) continue;\n\n      const relayStream = new MediaStream([track]);\n      relayAudioSendersRef.current[targetPeerId][sourcePeerId] = peer.addTrack(track, relayStream);\n      sendSignal('CALL_RELAY_TRACK', [targetPeerId], { sourcePeerId, trackId: track.id });\n\n      if (peer.remoteDescription && peer.signalingState === 'stable') {\n        await renegotiate(targetPeerId);\n      } else {\n        relayNeedsRenegotiationRef.current[targetPeerId] = true;\n      }\n    }\n  };\n\n  const repairLocalMicrophone = async () => {\n    if (!isCallingRef.current && !liveCallRef.current) return;\n    try {\n      const recovered = await recoverMicrophoneTrack(localStreamRef.current, micEnabled);\n      localStreamRef.current = recovered.stream;\n      if (!recovered.recovered) return;\n\n      for (const [peerKey, peer] of Object.entries(peersRef.current)) {\n        const peerId = Number(peerKey);\n        const sender = localAudioSendersRef.current[peerId];\n        if (sender) {\n          await sender.replaceTrack(recovered.track);\n        } else if (peer.signalingState !== 'closed') {\n          localAudioSendersRef.current[peerId] = peer.addTrack(recovered.track, recovered.stream);\n          if (peer.remoteDescription && peer.signalingState === 'stable') await renegotiate(peerId);\n        }\n      }\n\n      if (currentUserId) {\n        Object.keys(speakingMonitorStopsRef.current)\n          .filter((key) => key.startsWith('local:'))\n          .forEach((key) => { speakingMonitorStopsRef.current[key]?.(); delete speakingMonitorStopsRef.current[key]; });\n        monitorSpeaking(\`local:\${recovered.track.id}\`, currentUserId, new MediaStream([recovered.track]));\n      }\n    } catch {\n      // The next watchdog pass retries. Browser permission errors are still surfaced when starting a call.\n    }\n  };`;

  source = replaceRequired(source, 'persistent outgoing remote audio', oldAttach, newAttach);

  const oldCreatePeer = `  const createPeer = async (peerId: number, kind: CallKind) => {\n    if (peersRef.current[peerId]) return peersRef.current[peerId];\n\n    // APP_FIX: keep-initial-video-enabled\n    const stream = await ensureLocalStream(kind, kind === 'video' ? true : videoEnabled);\n    const peer = new RTCPeerConnection(iceServers);\n    stream.getTracks().forEach((track) => peer.addTrack(track, stream));\n\n    peer.ontrack = (event) => attachRemoteStream(peerId, event.streams[0]);\n    peer.onicecandidate = (event) => {\n      if (event.candidate) sendSignal("CALL_ICE", [peerId], { candidate: event.candidate });\n    };\n\n    peersRef.current[peerId] = peer;\n    return peer;\n  };`;

  const newCreatePeer = `  const createPeer = async (peerId: number, kind: CallKind) => {\n    if (peersRef.current[peerId]) return peersRef.current[peerId];\n\n    // APP_FIX: keep-initial-video-enabled\n    const stream = await ensureLocalStream(kind, kind === 'video' ? true : videoEnabled);\n    const peer = new RTCPeerConnection(iceServers);\n    stream.getTracks().forEach((track) => {\n      const sender = peer.addTrack(track, stream);\n      if (track.kind === 'audio') localAudioSendersRef.current[peerId] = sender;\n    });\n\n    // CALL_RELIABILITY: when a new group peer joins, include audio already received from other peers.\n    if (mode === 'group') {\n      for (const [sourceKey, audioTrack] of Object.entries(remoteAudioTracksRef.current)) {\n        const sourcePeerId = Number(sourceKey);\n        if (sourcePeerId === peerId || audioTrack.readyState !== 'live') continue;\n        relayAudioSendersRef.current[peerId] ||= {};\n        relayAudioSendersRef.current[peerId][sourcePeerId] = peer.addTrack(audioTrack, new MediaStream([audioTrack]));\n        sendSignal('CALL_RELAY_TRACK', [peerId], { sourcePeerId, trackId: audioTrack.id });\n      }\n    }\n\n    peer.ontrack = (event) => {\n      const remoteStream = event.streams[0] || new MediaStream([event.track]);\n      attachRemoteStream(peerId, remoteStream);\n      if (event.track.kind === 'audio') {\n        event.track.enabled = true;\n        remoteAudioTracksRef.current[peerId] = event.track;\n        const handleUnmute = () => attachRemoteStream(peerId, event.streams[0] || new MediaStream([event.track]));\n        event.track.addEventListener('unmute', handleUnmute);\n        void relayGroupAudioTrack(peerId, event.track);\n      }\n    };\n    peer.onicecandidate = (event) => {\n      if (event.candidate) sendSignal("CALL_ICE", [peerId], { candidate: event.candidate });\n    };\n\n    peersRef.current[peerId] = peer;\n    peerWatchdogStopsRef.current[peerId]?.();\n    peerWatchdogStopsRef.current[peerId] = watchPeerConnection(peer, async () => {\n      if (peer.signalingState === 'stable') await renegotiate(peerId);\n      await repairLocalMicrophone();\n    });\n    return peer;\n  };`;

  source = replaceRequired(source, 'outgoing peer health and group relay', oldCreatePeer, newCreatePeer);

  source = replaceRequired(
    source,
    'relay renegotiation after answer',
    `          delete pendingIceByPeerRef.current[data.senderId];\n        }\n      }`,
    `          delete pendingIceByPeerRef.current[data.senderId];\n          if (relayNeedsRenegotiationRef.current[data.senderId] && peer.signalingState === 'stable') {\n            relayNeedsRenegotiationRef.current[data.senderId] = false;\n            await renegotiate(data.senderId);\n          }\n        }\n      }`
  );

  const deviceEffectEnd = `  }, [isCalling, micEnabled, soundEnabled]);\n\n  const endCall = () => {`;
  const watchdogEffect = `  }, [isCalling, micEnabled, soundEnabled]);\n\n  useEffect(() => {\n    if (!isCalling) return;\n    const timer = window.setInterval(() => { void repairLocalMicrophone(); }, 2500);\n    const handleDeviceChange = () => { void repairLocalMicrophone(); };\n    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);\n    return () => {\n      window.clearInterval(timer);\n      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);\n    };\n  }, [isCalling, micEnabled]);\n\n  const removeGroupPeer = (peerId: number) => {\n    peerWatchdogStopsRef.current[peerId]?.();\n    delete peerWatchdogStopsRef.current[peerId];\n    peersRef.current[peerId]?.close();\n    delete peersRef.current[peerId];\n    delete localAudioSendersRef.current[peerId];\n    delete remoteAudioTracksRef.current[peerId];\n    delete relayAudioSendersRef.current[peerId];\n    delete relayNeedsRenegotiationRef.current[peerId];\n    delete pendingIceByPeerRef.current[peerId];\n    setParticipantSpeaking(peerId, false);\n  };\n\n  const endCall = () => {`;
  source = replaceRequired(source, 'microphone watchdog and peer removal', deviceEffectEnd, watchdogEffect);

  source = replaceRequired(
    source,
    'group hangup marker',
    '    if (targetIds.length > 0) sendSignal("CALL_HANGUP", targetIds, {});',
    '    if (targetIds.length > 0) sendSignal("CALL_HANGUP", targetIds, { endForAll: true });'
  );

  source = replaceRequired(
    source,
    'reliability cleanup',
    `    peersRef.current = {};\n    screenSendersRef.current = {};\n    pendingIceByPeerRef.current = {};`,
    `    peersRef.current = {};\n    Object.values(peerWatchdogStopsRef.current).forEach((stop) => stop());\n    peerWatchdogStopsRef.current = {};\n    Object.values(speakingMonitorStopsRef.current).forEach((stop) => stop());\n    speakingMonitorStopsRef.current = {};\n    Object.values(remoteAudioPlaybackStopsRef.current).forEach((stop) => stop());\n    remoteAudioPlaybackStopsRef.current = {};\n    blockedAudioKeysRef.current.clear();\n    localAudioSendersRef.current = {};\n    remoteAudioTracksRef.current = {};\n    relayAudioSendersRef.current = {};\n    relayNeedsRenegotiationRef.current = {};\n    screenSendersRef.current = {};\n    pendingIceByPeerRef.current = {};`
  );

  source = replaceRequired(
    source,
    'clear speaking state on end',
    `    setIsCalling(false);\n    setVideoEnabled(false);`,
    `    setIsCalling(false);\n    setSpeakingUserIds([]);\n    setSoundNeedsTap(false);\n    setVideoEnabled(false);`
  );

  source = replaceRequired(
    source,
    'outgoing group participant leaves without killing call',
    `      if (payload.type === "CALL_HANGUP") {\n        endCall();\n      }`,
    `      if (payload.type === "CALL_HANGUP") {\n        if (mode === 'group' && !data.endForAll) {\n          removeGroupPeer(Number(data.senderId));\n        } else {\n          endCall();\n        }\n      }`
  );

  const oldAvatar = `                <div key={participant.id} className="flex flex-col items-center gap-1">\n                  <img\n                    src={getAvatarUrl(participant.avatar)}\n                    alt={participant.username}\n                    className="h-12 w-12 rounded-full border-2 border-white/20 bg-gray-800 object-cover"\n                  />\n                  <span className="max-w-16 truncate text-[11px] text-white/70">{participant.username}</span>\n                </div>`;
  const newAvatar = `                <div key={participant.id} className="flex flex-col items-center gap-1">\n                  <div className="relative">\n                    <img\n                      src={getAvatarUrl(participant.avatar)}\n                      alt={participant.username}\n                      className={\`h-12 w-12 rounded-full border-2 bg-gray-800 object-cover transition-all \${speakingUserIds.includes(Number(participant.id)) ? 'border-emerald-400 ring-4 ring-emerald-400/35 shadow-[0_0_18px_rgba(52,211,153,0.45)]' : 'border-white/20'}\`}\n                    />\n                    {speakingUserIds.includes(Number(participant.id)) && (\n                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-semibold text-black">Говорит</span>\n                    )}\n                  </div>\n                  <span className="max-w-16 truncate text-[11px] text-white/70">{participant.username}</span>\n                </div>`;
  source = replaceRequired(source, 'outgoing speaking indicator', oldAvatar, newAvatar);

  return source;
});

patch('src/components/RealtimeNotifications.tsx', (input) => {
  let source = input;

  if (!source.includes('@/lib/call-audio-reliability')) {
    source = source.replace(
      'import { useAuth } from "@/pages/AuthContext";',
      `import { useAuth } from "@/pages/AuthContext";\nimport {\n  attachPersistentAudioTrack,\n  createSpeakingMonitor,\n  recoverMicrophoneTrack,\n  watchPeerConnection,\n} from "@/lib/call-audio-reliability";`
    );
  }

  source = replaceRequired(
    source,
    'incoming reliability refs',
    '  const activeCallRef = useRef<IncomingCall | null>(null);',
    `  const activeCallRef = useRef<IncomingCall | null>(null);\n  // CALL_RELIABILITY: incoming audio health and speaker attribution.\n  const currentUserIdRef = useRef<number | null>(null);\n  const peerWatchdogStopRef = useRef<(() => void) | null>(null);\n  const localAudioSenderRef = useRef<RTCRtpSender | null>(null);\n  const speakingMonitorStopsRef = useRef<Record<string, () => void>>({});\n  const remoteAudioPlaybackStopsRef = useRef<Record<string, () => void>>({});\n  const blockedAudioKeysRef = useRef<Set<string>>(new Set());\n  const relayedTrackSourceRef = useRef<Record<string, number>>({});`
  );

  source = replaceRequired(
    source,
    'incoming speaking state',
    '  const [soundNeedsTap, setSoundNeedsTap] = useState(false);',
    `  const [soundNeedsTap, setSoundNeedsTap] = useState(false);\n  const [speakingUserIds, setSpeakingUserIds] = useState<number[]>([]);`
  );

  const activeRefEffect = `  useEffect(() => {\n    activeCallRef.current = activeCall;\n  }, [activeCall]);`;
  const speakingHelpers = `${activeRefEffect}\n\n  const setParticipantSpeaking = (userId: number, speaking: boolean) => {\n    if (!Number.isFinite(Number(userId))) return;\n    setSpeakingUserIds((current) => {\n      const normalized = Number(userId);\n      if (speaking) return current.includes(normalized) ? current : [...current, normalized];\n      return current.filter((id) => id !== normalized);\n    });\n  };\n\n  const monitorSpeaking = (key: string, resolveUserId: () => number, stream: MediaStream) => {\n    if (stream.getAudioTracks().length === 0) return;\n    speakingMonitorStopsRef.current[key]?.();\n    speakingMonitorStopsRef.current[key] = createSpeakingMonitor(stream, (speaking) => {\n      setParticipantSpeaking(resolveUserId(), speaking);\n    });\n  };\n\n  const setRemotePlaybackBlocked = (key: string, blocked: boolean) => {\n    if (blocked) blockedAudioKeysRef.current.add(key);\n    else blockedAudioKeysRef.current.delete(key);\n    setSoundNeedsTap(blockedAudioKeysRef.current.size > 0);\n  };`;
  source = replaceRequired(source, 'incoming speaking helpers', activeRefEffect, speakingHelpers);

  source = replaceRequired(
    source,
    'outgoing speaking event mirror',
    `    const handleLocalCallEnded = () => setActiveCall(null);\n    window.addEventListener("itbird-call-active", handleLocalCallActive);\n    window.addEventListener("itbird-call-ended", handleLocalCallEnded);`,
    `    const handleLocalCallEnded = () => { setActiveCall(null); setSpeakingUserIds([]); };\n    const handleLocalSpeaking = (event: Event) => {\n      const detail = (event as CustomEvent<{ userId?: number; speaking?: boolean }>).detail || {};\n      if (detail.userId !== undefined) setParticipantSpeaking(Number(detail.userId), Boolean(detail.speaking));\n    };\n    window.addEventListener("itbird-call-active", handleLocalCallActive);\n    window.addEventListener("itbird-call-ended", handleLocalCallEnded);\n    window.addEventListener("itbird-call-speaking", handleLocalSpeaking);`
  );
  source = replaceRequired(
    source,
    'outgoing speaking event cleanup',
    `      window.removeEventListener("itbird-call-active", handleLocalCallActive);\n      window.removeEventListener("itbird-call-ended", handleLocalCallEnded);`,
    `      window.removeEventListener("itbird-call-active", handleLocalCallActive);\n      window.removeEventListener("itbird-call-ended", handleLocalCallEnded);\n      window.removeEventListener("itbird-call-speaking", handleLocalSpeaking);`
  );

  source = replaceRequired(
    source,
    'incoming cleanup health',
    `    peerRef.current?.close();\n    peerRef.current = null;\n    pendingIceCandidatesRef.current = [];`,
    `    peerWatchdogStopRef.current?.();\n    peerWatchdogStopRef.current = null;\n    peerRef.current?.close();\n    peerRef.current = null;\n    localAudioSenderRef.current = null;\n    pendingIceCandidatesRef.current = [];\n    Object.values(speakingMonitorStopsRef.current).forEach((stop) => stop());\n    speakingMonitorStopsRef.current = {};\n    Object.values(remoteAudioPlaybackStopsRef.current).forEach((stop) => stop());\n    remoteAudioPlaybackStopsRef.current = {};\n    blockedAudioKeysRef.current.clear();\n    relayedTrackSourceRef.current = {};`
  );
  source = replaceRequired(
    source,
    'incoming cleanup speaking state',
    `    setSoundNeedsTap(false);\n    setVideoEnabled(false);`,
    `    setSoundNeedsTap(false);\n    setSpeakingUserIds([]);\n    setVideoEnabled(false);`
  );

  const oldAcceptPeer = `      const peer = new RTCPeerConnection(getPeerConnectionConfig());\n      peerRef.current = peer;\n      stream.getTracks().forEach((track) => peer.addTrack(track, stream));\n      peer.ontrack = (event) => {\n        if (!remoteAudioRef.current) return;\n        // APP_FIX: incoming-per-stream-media\n        const remoteStream = event.streams[0];\n        const hasVideo = remoteStream?.getVideoTracks().length > 0;\n        const streamId = remoteStream?.id || (hasVideo ? 'remote-video' : 'remote-audio');\n        let media = remoteAudioRef.current.querySelector<HTMLMediaElement>(\n          \`\${hasVideo ? 'video' : 'audio'}[data-call-stream-id="\${streamId}"]\`\n        );\n        if (!media) {\n          media = document.createElement(hasVideo ? "video" : "audio");\n          media.dataset.callMedia = 'remote';\n          media.dataset.callStreamId = streamId;\n          media.autoplay = true;\n          if (hasVideo) {\n            (media as HTMLVideoElement).playsInline = true;\n            media.className = "mt-3 h-28 w-44 rounded-lg bg-black object-cover";\n          } else {\n            media.className = "hidden";\n          }\n          remoteAudioRef.current.appendChild(media);\n        }\n        media.muted = !soundEnabled;\n        media.srcObject = remoteStream;\n        void playRemoteMedia(media).then((playing) => setSoundNeedsTap(!playing));\n      };`;

  const newAcceptPeer = `      const peer = new RTCPeerConnection(getPeerConnectionConfig());\n      peerRef.current = peer;\n      stream.getTracks().forEach((track) => {\n        const sender = peer.addTrack(track, stream);\n        if (track.kind === 'audio') localAudioSenderRef.current = sender;\n      });\n\n      const localAudioTrack = stream.getAudioTracks()[0];\n      const currentUserId = currentUserIdRef.current;\n      if (localAudioTrack && currentUserId) {\n        monitorSpeaking(\`local:\${localAudioTrack.id}\`, () => currentUserId, new MediaStream([localAudioTrack]));\n      }\n\n      peer.ontrack = (event) => {\n        if (!remoteAudioRef.current) return;\n        const remoteStream = event.streams[0] || new MediaStream([event.track]);\n\n        if (event.track.kind === 'audio') {\n          event.track.enabled = true;\n          const key = \`incoming:\${event.track.id}\`;\n          if (!remoteAudioPlaybackStopsRef.current[key]) {\n            const binding = attachPersistentAudioTrack({\n              root: remoteAudioRef.current,\n              key,\n              track: event.track,\n              muted: !soundEnabled,\n              outputDeviceId: readSettings().audioOutputDeviceId,\n              onPlaybackBlocked: (blocked) => setRemotePlaybackBlocked(key, blocked),\n            });\n            remoteAudioPlaybackStopsRef.current[key] = binding.dispose;\n          }\n\n          const speakingKey = \`speaking:\${event.track.id}\`;\n          if (!speakingMonitorStopsRef.current[speakingKey]) {\n            monitorSpeaking(\n              speakingKey,\n              () => relayedTrackSourceRef.current[event.track.id] || incomingCall.senderId,\n              new MediaStream([event.track]),\n            );\n          }\n          event.track.addEventListener('unmute', () => {\n            const audio = Array.from(remoteAudioRef.current?.querySelectorAll<HTMLAudioElement>('audio[data-call-audio-key]') || [])\n              .find((element) => element.dataset.callAudioKey === key);\n            if (audio) void playRemoteMedia(audio).then((playing) => setRemotePlaybackBlocked(key, !playing));\n          });\n        }\n\n        if (remoteStream.getVideoTracks().length > 0) {\n          const streamId = remoteStream.id || \`remote-video-\${event.track.id}\`;\n          let video = remoteAudioRef.current.querySelector<HTMLVideoElement>(\`video[data-call-stream-id="\${streamId}"]\`);\n          if (!video) {\n            video = document.createElement('video');\n            video.dataset.callMedia = 'remote';\n            video.dataset.callStreamId = streamId;\n            video.autoplay = true;\n            video.playsInline = true;\n            video.muted = true;\n            video.className = 'mt-3 h-28 w-44 rounded-lg bg-black object-cover';\n            remoteAudioRef.current.appendChild(video);\n          }\n          video.srcObject = new MediaStream(remoteStream.getVideoTracks());\n          void video.play().catch(() => undefined);\n        }\n      };\n\n      peerWatchdogStopRef.current?.();\n      peerWatchdogStopRef.current = watchPeerConnection(peer, async () => {\n        if (peer.signalingState === 'stable') await renegotiateActivePeer();\n        await repairIncomingMicrophone();\n      });`;
  source = replaceRequired(source, 'incoming persistent audio and health', oldAcceptPeer, newAcceptPeer);

  const forceSoundEnd = `  const forceEnableRemoteSound = () => {\n    const media = Array.from(remoteAudioRef.current?.querySelectorAll<HTMLMediaElement>("audio, video") || []);\n    media.forEach((element) => { element.muted = false; });\n    setSoundEnabled(true);\n    void Promise.all(media.map((element) => playRemoteMedia(element))).then((results) => {\n      setSoundNeedsTap(results.some((playing) => !playing));\n    });\n  };`;
  const forceSoundWithRepair = `${forceSoundEnd}\n\n  const repairIncomingMicrophone = async () => {\n    if (!activeCallRef.current || activeCallRef.current.senderId === 0 || !peerRef.current) return;\n    try {\n      const recovered = await recoverMicrophoneTrack(localStreamRef.current, micEnabled);\n      localStreamRef.current = recovered.stream;\n      if (!recovered.recovered) return;\n\n      if (localAudioSenderRef.current) {\n        await localAudioSenderRef.current.replaceTrack(recovered.track);\n      } else {\n        localAudioSenderRef.current = peerRef.current.addTrack(recovered.track, recovered.stream);\n        if (peerRef.current.remoteDescription && peerRef.current.signalingState === 'stable') {\n          await renegotiateActivePeer();\n        }\n      }\n\n      const currentUserId = currentUserIdRef.current;\n      if (currentUserId) {\n        Object.keys(speakingMonitorStopsRef.current)\n          .filter((key) => key.startsWith('local:'))\n          .forEach((key) => { speakingMonitorStopsRef.current[key]?.(); delete speakingMonitorStopsRef.current[key]; });\n        monitorSpeaking(\`local:\${recovered.track.id}\`, () => currentUserId, new MediaStream([recovered.track]));\n      }\n    } catch {\n      // Retry on the next watchdog/device-change event.\n    }\n  };`;
  source = replaceRequired(source, 'incoming microphone recovery helper', forceSoundEnd, forceSoundWithRepair);

  source = replaceRequired(
    source,
    'remember incoming user id',
    `      currentUserId = jwtDecode<DecodedToken>(token).id;`,
    `      currentUserId = jwtDecode<DecodedToken>(token).id;\n      currentUserIdRef.current = currentUserId;`
  );

  const groupSignalMarker = `      if (notification.type === "CALL_INVITE") {`;
  const groupSignalHandlers = `      if (notification.type === 'CALL_RELAY_TRACK') {\n        const call = notification.data as IncomingCall & { sourcePeerId?: number; trackId?: string };\n        if (call.senderId === currentUserId) return;\n        if (!call.targetIds?.includes(currentUserId)) return;\n        if (call.trackId && call.sourcePeerId) {\n          relayedTrackSourceRef.current[call.trackId] = Number(call.sourcePeerId);\n        }\n        return;\n      }\n\n${groupSignalMarker}`;
  source = replaceRequired(source, 'group relay source mapping', groupSignalMarker, groupSignalHandlers);

  source = replaceRequired(
    source,
    'incoming group leave semantics',
    `      if (notification.type === "CALL_HANGUP") {\n        const call = notification.data as IncomingCall;\n        if (call.senderId === currentUserId) return;\n        if (!call.targetIds?.includes(currentUserId)) return;\n        cleanupCall();\n      }`,
    `      if (notification.type === "CALL_HANGUP") {\n        const call = notification.data as IncomingCall & { endForAll?: boolean };\n        if (call.senderId === currentUserId) return;\n        if (!call.targetIds?.includes(currentUserId)) return;\n        if (call.mode !== 'group' || call.endForAll || call.senderId === activeCallRef.current?.senderId) {\n          cleanupCall();\n        } else {\n          setParticipantSpeaking(Number(call.senderId), false);\n        }\n      }`
  );

  source = replaceRequired(
    source,
    'participant leaves group marker',
    `    if (activeCall?.senderId) sendCallSignal("CALL_HANGUP", [activeCall.senderId], activeCall);`,
    `    if (activeCall?.senderId) sendCallSignal("CALL_HANGUP", [activeCall.senderId], { ...activeCall, participantLeft: activeCall.mode === 'group' });`
  );

  const effectBeforeParticipants = `  }, [isAuthenticated, navigate, toast]);\n\n  const activeParticipants = activeCall?.participants?.length`;
  const micWatchdogEffect = `  }, [isAuthenticated, navigate, toast]);\n\n  useEffect(() => {\n    if (!activeCall || activeCall.senderId === 0) return;\n    const timer = window.setInterval(() => { void repairIncomingMicrophone(); }, 2500);\n    const handleDeviceChange = () => { void repairIncomingMicrophone(); };\n    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);\n    return () => {\n      window.clearInterval(timer);\n      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);\n    };\n  }, [activeCall?.senderId, micEnabled]);\n\n  const activeParticipants = activeCall?.participants?.length`;
  source = replaceRequired(source, 'incoming microphone watchdog', effectBeforeParticipants, micWatchdogEffect);

  const oldIncomingAvatar = `                <div key={participant.id || participant.username} className="flex flex-col items-center gap-1">\n                  <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/30 bg-white/90">\n                    <img\n                      src={getAvatarUrl(participant.avatar)}\n                      alt={participant.username}\n                      className="h-12 w-12 rounded-full object-cover"\n                    />\n                  </div>\n                  <span className="max-w-24 truncate text-xs text-white/70">{participant.username}</span>\n                </div>`;
  const newIncomingAvatar = `                <div key={participant.id || participant.username} className="flex flex-col items-center gap-1">\n                  <div className={\`relative flex h-14 w-14 items-center justify-center rounded-full border-2 bg-white/90 transition-all \${speakingUserIds.includes(Number(participant.id)) ? 'border-emerald-400 ring-4 ring-emerald-400/35 shadow-[0_0_18px_rgba(52,211,153,0.45)]' : 'border-white/30'}\`}>\n                    <img\n                      src={getAvatarUrl(participant.avatar)}\n                      alt={participant.username}\n                      className="h-12 w-12 rounded-full object-cover"\n                    />\n                    {speakingUserIds.includes(Number(participant.id)) && (\n                      <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-semibold text-black">Говорит</span>\n                    )}\n                  </div>\n                  <span className="max-w-24 truncate text-xs text-white/70">{participant.username}</span>\n                </div>`;
  source = replaceRequired(source, 'incoming speaking indicator', oldIncomingAvatar, newIncomingAvatar);

  return source;
});

console.log('Call reliability fixes are current.');

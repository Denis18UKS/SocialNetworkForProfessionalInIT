import fs from 'node:fs';

const file = 'src/components/call/CallProvider.tsx';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const marker = '// SOCIALBIRD_CALL_SYSTEM_V8: dedicated-camera-transport';

if (!source.includes(marker)) {
  if (!source.includes('// SOCIALBIRD_CALL_SYSTEM_V7: receiver-reconciliation')) {
    throw new Error('Call V8 requires Call V7 first');
  }

  const peerTypeAnchor = `type AudioBinding = ReturnType<typeof attachPersistentAudioTrack>;`;
  if (!source.includes(peerTypeAnchor)) throw new Error('Call V8 patch failed: type anchor');
  source = source.replace(peerTypeAnchor, `type CameraAuxTransport = {\n  peerId: number;\n  transportId: string;\n  pc: RTCPeerConnection;\n  sender: RTCRtpSender | null;\n};\n\n${peerTypeAnchor}`);

  const candidateAnchor = `  candidate?: RTCIceCandidateInit;\n`;
  if (!source.includes(candidateAnchor)) throw new Error('Call V8 patch failed: signal candidate anchor');
  source = source.replace(candidateAnchor, `${candidateAnchor}  transportId?: string;\n`);

  const refsAnchor = `  const remoteVideoResyncAtRef = useRef<Record<number, number>>({});\n`;
  if (!source.includes(refsAnchor)) throw new Error('Call V8 patch failed: V7 refs anchor');
  source = source.replace(refsAnchor, `${refsAnchor}  // SOCIALBIRD_CALL_SYSTEM_V8: dedicated-camera-transport\n  const cameraAuxOutgoingRef = useRef<Record<number, CameraAuxTransport>>({});\n  const cameraAuxIncomingRef = useRef<Record<string, CameraAuxTransport>>({});\n  const cameraAuxPendingIceRef = useRef<Record<string, RTCIceCandidateInit[]>>({});\n`);

  const stopResourcesAnchor = `    peersRef.current = {};\n`;
  if (!source.includes(stopResourcesAnchor)) throw new Error('Call V8 patch failed: stop resources anchor');
  source = source.replace(stopResourcesAnchor, `${stopResourcesAnchor}    Object.values(cameraAuxOutgoingRef.current).forEach((transport) => { try { transport.pc.close(); } catch {} });\n    Object.values(cameraAuxIncomingRef.current).forEach((transport) => { try { transport.pc.close(); } catch {} });\n    cameraAuxOutgoingRef.current = {};\n    cameraAuxIncomingRef.current = {};\n    cameraAuxPendingIceRef.current = {};\n`);

  const startCallIndex = source.indexOf('\n\n  const startCall = useCallback(');
  if (startCallIndex < 0) throw new Error('Call V8 patch failed: startCall insertion anchor');
  const cameraTransportBlock = `\n\n  const closeOutgoingCameraTransport = useCallback((peerId: number, snapshot?: CallSnapshot | null, broadcast = false) => {\n    const current = cameraAuxOutgoingRef.current[peerId];\n    if (current) {\n      try { current.pc.close(); } catch {}\n      delete cameraAuxOutgoingRef.current[peerId];\n    }\n    if (broadcast && snapshot) {\n      sendSignal("CALL_VIDEO_STOP", [peerId], { ...snapshot, transportId: current?.transportId });\n    }\n  }, [sendSignal]);\n\n  const startOutgoingCameraTransport = useCallback(async (snapshot: CallSnapshot, peerId: number, track: MediaStreamTrack) => {\n    if (!Number.isFinite(peerId) || peerId <= 0 || track.readyState !== "live") return;\n    const existing = cameraAuxOutgoingRef.current[peerId];\n    if (existing && existing.pc.signalingState !== "closed") {\n      if (existing.sender) await existing.sender.replaceTrack(track).catch(() => undefined);\n      return;\n    }\n\n    const selfId = currentUserIdRef.current;\n    if (!selfId) return;\n    const transportId = snapshot.callId + ":camera:" + selfId + ":" + peerId + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);\n    const pc = new RTCPeerConnection(getPeerConnectionConfig());\n    const cameraStream = new MediaStream([track]);\n    const sender = pc.addTrack(track, cameraStream);\n    const transport: CameraAuxTransport = { peerId, transportId, pc, sender };\n    cameraAuxOutgoingRef.current[peerId] = transport;\n\n    pc.onicecandidate = (event) => {\n      if (!event.candidate || cameraAuxOutgoingRef.current[peerId]?.transportId !== transportId) return;\n      sendSignal("CALL_VIDEO_ICE", [peerId], {\n        ...snapshot,\n        transportId,\n        candidate: event.candidate.toJSON(),\n      });\n    };\n\n    const offer = await pc.createOffer();\n    await pc.setLocalDescription(offer);\n    sendSignal("CALL_VIDEO_OFFER", [peerId], {\n      ...snapshot,\n      transportId,\n      cameraEnabled: true,\n      description: offer,\n    });\n  }, [sendSignal]);\n\n  const syncOutgoingCameraTransports = useCallback(async (snapshot: CallSnapshot, track: MediaStreamTrack | null) => {\n    const peerIds = allOtherParticipantIds(snapshot);\n    if (!track) {\n      const existingPeerIds = Object.keys(cameraAuxOutgoingRef.current).map(Number);\n      existingPeerIds.forEach((peerId) => closeOutgoingCameraTransport(peerId, snapshot, true));\n      return;\n    }\n    for (const peerId of peerIds) {\n      await startOutgoingCameraTransport(snapshot, peerId, track);\n    }\n  }, [allOtherParticipantIds, closeOutgoingCameraTransport, startOutgoingCameraTransport]);\n\n  const flushAuxCameraIce = useCallback(async (transportId: string, pc: RTCPeerConnection) => {\n    const candidates = cameraAuxPendingIceRef.current[transportId] || [];\n    delete cameraAuxPendingIceRef.current[transportId];\n    for (const candidate of candidates) {\n      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);\n    }\n  }, []);\n\n  const handleAuxCameraSignal = useCallback(async (type: string, signal: CallSignal) => {\n    const peerId = Number(signal.senderId);\n    const transportId = String(signal.transportId || "");\n    if (!peerId || !transportId) return;\n\n    if (type === "CALL_VIDEO_OFFER") {\n      if (!signal.description) return;\n      const previous = cameraAuxIncomingRef.current[transportId];\n      if (previous) { try { previous.pc.close(); } catch {} }\n\n      const pc = new RTCPeerConnection(getPeerConnectionConfig());\n      const transport: CameraAuxTransport = { peerId, transportId, pc, sender: null };\n      cameraAuxIncomingRef.current[transportId] = transport;\n\n      pc.onicecandidate = (event) => {\n        if (!event.candidate || cameraAuxIncomingRef.current[transportId]?.pc !== pc) return;\n        const active = callRef.current;\n        if (!active) return;\n        sendSignal("CALL_VIDEO_ICE", [peerId], {\n          ...active,\n          transportId,\n          candidate: event.candidate.toJSON(),\n        });\n      };\n      pc.ontrack = (event) => {\n        if (event.track.kind !== "video") return;\n        const cameraStream = new MediaStream([event.track]);\n        remoteCameraExpectedRef.current[peerId] = true;\n        setRemoteMedia((current) => {\n          const previousMedia = current[peerId] || {};\n          return { ...current, [peerId]: { ...previousMedia, camera: cameraStream } };\n        });\n        const restore = () => {\n          if (event.track.readyState !== "live") return;\n          setRemoteMedia((current) => {\n            const previousMedia = current[peerId] || {};\n            return { ...current, [peerId]: { ...previousMedia, camera: cameraStream } };\n          });\n        };\n        event.track.addEventListener("unmute", restore);\n        event.track.addEventListener("ended", () => {\n          setRemoteMedia((current) => {\n            const previousMedia = current[peerId];\n            if (!previousMedia?.camera?.getTracks().some((item) => item.id === event.track.id)) return current;\n            const next = { ...previousMedia };\n            delete next.camera;\n            return { ...current, [peerId]: next };\n          });\n        }, { once: true });\n      };\n\n      await pc.setRemoteDescription(new RTCSessionDescription(signal.description));\n      await flushAuxCameraIce(transportId, pc);\n      const answer = await pc.createAnswer();\n      await pc.setLocalDescription(answer);\n      const active = callRef.current;\n      if (!active) return;\n      sendSignal("CALL_VIDEO_ANSWER", [peerId], { ...active, transportId, description: answer });\n      return;\n    }\n\n    if (type === "CALL_VIDEO_ANSWER") {\n      if (!signal.description) return;\n      const outgoing = Object.values(cameraAuxOutgoingRef.current).find((item) => item.transportId === transportId);\n      if (!outgoing || outgoing.pc.signalingState === "closed") return;\n      await outgoing.pc.setRemoteDescription(new RTCSessionDescription(signal.description)).catch(() => undefined);\n      await flushAuxCameraIce(transportId, outgoing.pc);\n      return;\n    }\n\n    if (type === "CALL_VIDEO_ICE") {\n      if (!signal.candidate) return;\n      const outgoing = Object.values(cameraAuxOutgoingRef.current).find((item) => item.transportId === transportId);\n      const incoming = cameraAuxIncomingRef.current[transportId];\n      const pc = outgoing?.pc || incoming?.pc;\n      if (pc?.remoteDescription) {\n        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => undefined);\n      } else {\n        cameraAuxPendingIceRef.current[transportId] ||= [];\n        cameraAuxPendingIceRef.current[transportId].push(signal.candidate);\n      }\n      return;\n    }\n\n    if (type === "CALL_VIDEO_STOP") {\n      Object.entries(cameraAuxIncomingRef.current).forEach(([id, transport]) => {\n        if (transport.peerId !== peerId) return;\n        try { transport.pc.close(); } catch {}\n        delete cameraAuxIncomingRef.current[id];\n      });\n      remoteCameraExpectedRef.current[peerId] = false;\n      setRemoteMedia((current) => {\n        const previousMedia = current[peerId];\n        if (!previousMedia) return current;\n        const next = { ...previousMedia };\n        delete next.camera;\n        return { ...current, [peerId]: next };\n      });\n    }\n  }, [flushAuxCameraIce, sendSignal]);`;
  source = source.slice(0, startCallIndex) + cameraTransportBlock + source.slice(startCallIndex);

  // Accepted video calls establish an auxiliary one-way video transport in each direction.
  const acceptSignal = `      sendSignal("CALL_ACCEPT", targetIds, snapshot);`;
  if (!source.includes(acceptSignal)) throw new Error('Call V8 patch failed: accept signal anchor');
  source = source.replace(acceptSignal, `${acceptSignal}\n      const acceptedCameraTrack = stream.getVideoTracks().find((item) => item.readyState === "live") || null;\n      if (acceptedCameraTrack) await syncOutgoingCameraTransports(snapshot, acceptedCameraTrack);`);

  const acceptDeps = `  }, [ensureLocalMedia, finishCallLocally, handleOffer, makeOffer, publishActive, sendSignal, stopRingtone]);`;
  if (!source.includes(acceptDeps)) throw new Error('Call V8 patch failed: accept deps anchor');
  source = source.replace(acceptDeps, `  }, [ensureLocalMedia, finishCallLocally, handleOffer, makeOffer, publishActive, sendSignal, stopRingtone, syncOutgoingCameraTransports]);`);

  // Every camera toggle/switch synchronizes the dedicated transport as the primary video path.
  const renegotiateStart = `  const renegotiateCamera = useCallback(async (snapshot: CallSnapshot, track: MediaStreamTrack | null) => {\n    // SOCIALBIRD_CALL_SYSTEM_V6: add-remove-camera-track`;
  if (!source.includes(renegotiateStart)) throw new Error('Call V8 patch failed: V6 renegotiation anchor');
  source = source.replace(renegotiateStart, `  const renegotiateCamera = useCallback(async (snapshot: CallSnapshot, track: MediaStreamTrack | null) => {\n    // SOCIALBIRD_CALL_SYSTEM_V8: auxiliary-camera-sync\n    await syncOutgoingCameraTransports(snapshot, track);\n    // SOCIALBIRD_CALL_SYSTEM_V6: add-remove-camera-track`);
  const renegotiateDeps = `  }, [allOtherParticipantIds, makeOffer, sendSignal]);`;
  if (!source.includes(renegotiateDeps)) throw new Error('Call V8 patch failed: renegotiation deps');
  source = source.replace(renegotiateDeps, `  }, [allOtherParticipantIds, makeOffer, sendSignal, syncOutgoingCameraTransports]);`);

  // Route auxiliary camera signaling before legacy camera-state healing.
  const cameraStateAnchor = `    // SOCIALBIRD_CALL_SYSTEM_V5: remote-camera-resync\n    if (type === "CALL_CAMERA_STATE") {`;
  if (!source.includes(cameraStateAnchor)) throw new Error('Call V8 patch failed: signal routing anchor');
  source = source.replace(cameraStateAnchor, `    if (type === "CALL_VIDEO_OFFER" || type === "CALL_VIDEO_ANSWER" || type === "CALL_VIDEO_ICE" || type === "CALL_VIDEO_STOP") {\n      await handleAuxCameraSignal(type, signal);\n      return;\n    }\n\n${cameraStateAnchor}`);

  const acceptBranchNeedle = `      // V5: CALL_ACCEPT only starts/refreshes negotiation; real WebRTC connected marks active.\n      return;`;
  if (!source.includes(acceptBranchNeedle)) throw new Error('Call V8 patch failed: CALL_ACCEPT branch anchor');
  source = source.replace(acceptBranchNeedle, `      // SOCIALBIRD_CALL_SYSTEM_V8: accepted-peer-camera-start\n      const localCamera = localStreamRef.current?.getVideoTracks().find((item) => item.readyState === "live") || null;\n      if (active.cameraEnabled && localCamera) await startOutgoingCameraTransport(active, peerId, localCamera);\n      // V5: CALL_ACCEPT only starts/refreshes negotiation; real WebRTC connected marks active.\n      return;`);

  const callSignalDeps = `  }, [acceptIncoming, declineIncoming, finishCallLocally, handleAnswer, handleOffer, makeOffer, processIncomingInvite, reconcileRemoteVideo, removePeer]);`;
  if (!source.includes(callSignalDeps)) throw new Error('Call V8 patch failed: call signal deps anchor');
  source = source.replace(callSignalDeps, `  }, [acceptIncoming, declineIncoming, finishCallLocally, handleAnswer, handleAuxCameraSignal, handleOffer, makeOffer, processIncomingInvite, reconcileRemoteVideo, removePeer, startOutgoingCameraTransport]);`);

  fs.writeFileSync(file, source, 'utf8');
}

for (const required of [
  marker,
  'CALL_VIDEO_OFFER',
  'CALL_VIDEO_ANSWER',
  'CALL_VIDEO_ICE',
  'CALL_VIDEO_STOP',
  'SOCIALBIRD_CALL_SYSTEM_V8: auxiliary-camera-sync',
  'SOCIALBIRD_CALL_SYSTEM_V8: accepted-peer-camera-start',
  'cameraAuxOutgoingRef',
  'cameraAuxIncomingRef',
]) {
  if (!source.includes(required)) throw new Error(`Call V8 invariant missing: ${required}`);
}

console.log('Call System V8 camera transport is current: camera has an independent one-way WebRTC path per participant with dedicated offer/answer/ICE.');

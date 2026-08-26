import fs from 'node:fs';

const file = 'src/components/call/CallProvider.tsx';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const marker = '// SOCIALBIRD_CALL_SYSTEM_V7: receiver-reconciliation';

if (!source.includes(marker)) {
  if (!source.includes('// SOCIALBIRD_CALL_SYSTEM_V6: real-camera-sender')) {
    throw new Error('Call V7 patch requires Call V6 first');
  }

  const refAnchor = '  const cameraResyncTimersRef = useRef<Record<number, number>>({});\n';
  if (!source.includes(refAnchor)) throw new Error('Call V7 patch failed: refs anchor');
  source = source.replace(refAnchor, `${refAnchor}  // SOCIALBIRD_CALL_SYSTEM_V7: receiver-reconciliation\n  const remoteCameraExpectedRef = useRef<Record<number, boolean>>({});\n  const remoteVideoTrackStreamsRef = useRef<Record<string, MediaStream>>({});\n  const remoteVideoResyncAtRef = useRef<Record<number, number>>({});\n`);

  const classifyBlock = `  const classifyRemoteVideo = useCallback((peerId: number, stream: MediaStream) => {\n    remoteStreamByIdRef.current[stream.id] = { peerId, stream };\n    const expectedScreen = expectedScreenStreamRef.current[peerId];\n    setRemoteMedia((current) => {\n      const existing = current[peerId] || {};\n      if (expectedScreen && stream.id === expectedScreen) {\n        return { ...current, [peerId]: { ...existing, screen: stream } };\n      }\n      return { ...current, [peerId]: { ...existing, camera: stream } };\n    });\n  }, []);`;
  if (!source.includes(classifyBlock)) throw new Error('Call V7 patch failed: classify block');
  const classifyReplacement = `${classifyBlock}\n\n  const reconcileRemoteVideo = useCallback((peerId: number, pc: RTCPeerConnection) => {\n    if (!Number.isFinite(peerId) || peerId <= 0 || pc.signalingState === "closed") return;\n\n    const expectedScreen = expectedScreenStreamRef.current[peerId];\n    const cameraExpected = remoteCameraExpectedRef.current[peerId];\n    const receivers = pc.getReceivers().filter((receiver) =>\n      receiver.track?.kind === "video" && receiver.track.readyState === "live",\n    );\n\n    let cameraStream: MediaStream | undefined;\n    let screenStream: MediaStream | undefined;\n\n    for (const receiver of receivers) {\n      const track = receiver.track;\n      if (!track) continue;\n      const originalStream = Object.values(remoteStreamByIdRef.current).find((entry) =>\n        entry.peerId === peerId && entry.stream.getVideoTracks().some((candidate) => candidate.id === track.id),\n      )?.stream;\n\n      if (expectedScreen && originalStream?.id === expectedScreen) {\n        screenStream = originalStream;\n        continue;\n      }\n\n      if (cameraExpected === false || cameraStream) continue;\n      const key = "peer:" + peerId + ":" + track.id;\n      let dedicated = remoteVideoTrackStreamsRef.current[key];\n      if (!dedicated) {\n        dedicated = new MediaStream([track]);\n        remoteVideoTrackStreamsRef.current[key] = dedicated;\n      } else if (!dedicated.getTracks().some((candidate) => candidate.id === track.id)) {\n        dedicated.addTrack(track);\n      }\n      cameraStream = dedicated;\n    }\n\n    if (expectedScreen && !screenStream) {\n      const known = remoteStreamByIdRef.current[expectedScreen];\n      if (known?.peerId === peerId && known.stream.getVideoTracks().some((track) => track.readyState === "live")) {\n        screenStream = known.stream;\n      }\n    }\n\n    setRemoteMedia((current) => {\n      const previous = current[peerId] || {};\n      const next = { ...previous };\n      if (cameraStream) next.camera = cameraStream;\n      else if (cameraExpected === false) delete next.camera;\n      if (screenStream) next.screen = screenStream;\n      if (previous.camera === next.camera && previous.screen === next.screen) return current;\n      return { ...current, [peerId]: next };\n    });\n  }, []);`;
  source = source.replace(classifyBlock, classifyReplacement);

  const oldOnTrack = `      if (event.track.kind === "audio") attachRemoteAudio(peerId, stream, event.track);\n      if (event.track.kind === "video") {\n        // SOCIALBIRD_CALL_SYSTEM_V6: remote-video-unmute-refresh\n        classifyRemoteVideo(peerId, stream);\n        const refreshVideo = () => classifyRemoteVideo(peerId, stream);\n        event.track.addEventListener("unmute", refreshVideo);\n      }\n      event.track.addEventListener("ended", () => {`;
  const newOnTrack = `      if (event.track.kind === "audio") attachRemoteAudio(peerId, stream, event.track);\n      if (event.track.kind === "video") {\n        // SOCIALBIRD_CALL_SYSTEM_V7: dedicated-camera-track-stream\n        // Keep the original WebRTC stream id for screen-share classification, but bind\n        // webcam rendering to a dedicated MediaStream containing the actual receiver track.\n        remoteStreamByIdRef.current[stream.id] = { peerId, stream };\n        const expectedScreen = expectedScreenStreamRef.current[peerId];\n        if (expectedScreen && stream.id === expectedScreen) {\n          classifyRemoteVideo(peerId, stream);\n        } else {\n          const key = "peer:" + peerId + ":" + event.track.id;\n          const cameraStream = remoteVideoTrackStreamsRef.current[key] || new MediaStream([event.track]);\n          remoteVideoTrackStreamsRef.current[key] = cameraStream;\n          setRemoteMedia((current) => {\n            const previous = current[peerId] || {};\n            return previous.camera === cameraStream\n              ? current\n              : { ...current, [peerId]: { ...previous, camera: cameraStream } };\n          });\n        }\n        const refreshVideo = () => reconcileRemoteVideo(peerId, pc);\n        event.track.addEventListener("unmute", refreshVideo);\n        window.setTimeout(refreshVideo, 0);\n      }\n      event.track.addEventListener("ended", () => {`;
  if (!source.includes(oldOnTrack)) throw new Error('Call V7 patch failed: V6 ontrack block');
  source = source.replace(oldOnTrack, newOnTrack);

  const stopAnchor = `    remoteStreamByIdRef.current = {};\n`;
  if (!source.includes(stopAnchor)) throw new Error('Call V7 patch failed: stop resources anchor');
  source = source.replace(stopAnchor, `${stopAnchor}    remoteCameraExpectedRef.current = {};\n    remoteVideoTrackStreamsRef.current = {};\n    remoteVideoResyncAtRef.current = {};\n`);

  const removeAnchor = `    delete expectedScreenStreamRef.current[peerId];\n`;
  if (!source.includes(removeAnchor)) throw new Error('Call V7 patch failed: remove peer anchor');
  source = source.replace(removeAnchor, `${removeAnchor}    delete remoteCameraExpectedRef.current[peerId];\n    delete remoteVideoResyncAtRef.current[peerId];\n    Object.keys(remoteVideoTrackStreamsRef.current)\n      .filter((key) => key.startsWith("peer:" + peerId + ":"))\n      .forEach((key) => { delete remoteVideoTrackStreamsRef.current[key]; });\n`);

  const markConnectionAnchor = `    const markRealConnection = () => {\n      if (pc.connectionState !== "connected") return;`;
  if (!source.includes(markConnectionAnchor)) throw new Error('Call V7 patch failed: connected-state anchor');
  source = source.replace(markConnectionAnchor, `    const markRealConnection = () => {\n      if (pc.connectionState !== "connected") return;\n      reconcileRemoteVideo(peerId, pc);`);

  const createDeps = `  }, [attachRemoteAudio, classifyRemoteVideo, sendSignal]);`;
  if (!source.includes(createDeps)) throw new Error('Call V7 patch failed: createPeer deps');
  source = source.replace(createDeps, `  }, [attachRemoteAudio, classifyRemoteVideo, reconcileRemoteVideo, sendSignal]);`);

  const handleOfferRemote = `    await pc.setRemoteDescription(new RTCSessionDescription(signal.description));\n    await flushPendingIce(Number(signal.senderId), pc);`;
  if (!source.includes(handleOfferRemote)) throw new Error('Call V7 patch failed: offer remote-description anchor');
  source = source.replace(handleOfferRemote, `    await pc.setRemoteDescription(new RTCSessionDescription(signal.description));\n    reconcileRemoteVideo(Number(signal.senderId), pc);\n    window.setTimeout(() => reconcileRemoteVideo(Number(signal.senderId), pc), 150);\n    await flushPendingIce(Number(signal.senderId), pc);`);

  const handleOfferDeps = `  }, [createPeer, flushPendingIce, sendSignal]);`;
  if (!source.includes(handleOfferDeps)) throw new Error('Call V7 patch failed: handleOffer deps');
  source = source.replace(handleOfferDeps, `  }, [createPeer, flushPendingIce, reconcileRemoteVideo, sendSignal]);`);

  const handleAnswerRemote = `    await bundle.pc.setRemoteDescription(new RTCSessionDescription(signal.description)).catch(() => undefined);\n    await flushPendingIce(Number(signal.senderId), bundle.pc);`;
  if (!source.includes(handleAnswerRemote)) throw new Error('Call V7 patch failed: answer remote-description anchor');
  source = source.replace(handleAnswerRemote, `    await bundle.pc.setRemoteDescription(new RTCSessionDescription(signal.description)).catch(() => undefined);\n    reconcileRemoteVideo(Number(signal.senderId), bundle.pc);\n    window.setTimeout(() => reconcileRemoteVideo(Number(signal.senderId), bundle.pc), 150);\n    await flushPendingIce(Number(signal.senderId), bundle.pc);`);

  const handleAnswerDeps = `  }, [flushPendingIce]);`;
  if (!source.includes(handleAnswerDeps)) throw new Error('Call V7 patch failed: handleAnswer deps');
  source = source.replace(handleAnswerDeps, `  }, [flushPendingIce, reconcileRemoteVideo]);`);

  const signalStart = `  const handleCallSignal = useCallback(async (type: string, signal: CallSignal) => {\n    const selfId = currentUserIdRef.current;\n    if (!selfId || Number(signal.senderId) === selfId) return;\n    if (Array.isArray(signal.targetIds) && !signal.targetIds.map(Number).includes(selfId)) return;`;
  if (!source.includes(signalStart)) throw new Error('Call V7 patch failed: signal start');
  source = source.replace(signalStart, `${signalStart}\n\n    const remotePeerId = Number(signal.senderId);\n    if (remotePeerId > 0 && typeof signal.cameraEnabled === "boolean") {\n      remoteCameraExpectedRef.current[remotePeerId] = signal.cameraEnabled;\n      const peer = peersRef.current[remotePeerId];\n      if (peer) reconcileRemoteVideo(remotePeerId, peer.pc);\n    }`);

  const cameraStateStart = `    if (type === "CALL_CAMERA_STATE") {\n      const peerId = Number(signal.senderId);\n      if (cameraResyncTimersRef.current[peerId]) window.clearTimeout(cameraResyncTimersRef.current[peerId]);`;
  if (!source.includes(cameraStateStart)) throw new Error('Call V7 patch failed: camera state anchor');
  source = source.replace(cameraStateStart, `    if (type === "CALL_CAMERA_STATE") {\n      const peerId = Number(signal.senderId);\n      remoteCameraExpectedRef.current[peerId] = Boolean(signal.cameraEnabled);\n      const cameraPeer = peersRef.current[peerId];\n      if (cameraPeer) reconcileRemoteVideo(peerId, cameraPeer.pc);\n      if (cameraResyncTimersRef.current[peerId]) window.clearTimeout(cameraResyncTimersRef.current[peerId]);`);

  const callSignalDeps = `  }, [acceptIncoming, declineIncoming, finishCallLocally, handleAnswer, handleOffer, makeOffer, processIncomingInvite, removePeer]);`;
  if (!source.includes(callSignalDeps)) throw new Error('Call V7 patch failed: handleCallSignal deps');
  source = source.replace(callSignalDeps, `  }, [acceptIncoming, declineIncoming, finishCallLocally, handleAnswer, handleOffer, makeOffer, processIncomingInvite, reconcileRemoteVideo, removePeer]);`);

  const micRecoveryEffect = `  useEffect(() => {\n    const timer = window.setInterval(() => {\n      const active = callRef.current;\n      if (!active) return;\n      const audio = localStreamRef.current?.getAudioTracks().find((track) => track.readyState === "live");`;
  if (!source.includes(micRecoveryEffect)) throw new Error('Call V7 patch failed: interval insertion anchor');
  const receiverEffect = `  // SOCIALBIRD_CALL_SYSTEM_V7: desktop-receiver-watchdog\n  useEffect(() => {\n    const timer = window.setInterval(() => {\n      const active = callRef.current;\n      if (!active) return;\n      const now = Date.now();\n      Object.values(peersRef.current).forEach((bundle) => {\n        reconcileRemoteVideo(bundle.peerId, bundle.pc);\n        if (remoteCameraExpectedRef.current[bundle.peerId] !== true) return;\n\n        const screenId = expectedScreenStreamRef.current[bundle.peerId];\n        const hasCameraReceiver = bundle.pc.getReceivers().some((receiver) => {\n          const track = receiver.track;\n          if (!track || track.kind !== "video" || track.readyState !== "live") return false;\n          const original = Object.values(remoteStreamByIdRef.current).find((entry) =>\n            entry.peerId === bundle.peerId && entry.stream.getVideoTracks().some((candidate) => candidate.id === track.id),\n          )?.stream;\n          return !screenId || !original || original.id !== screenId;\n        });\n\n        if (hasCameraReceiver) return;\n        const last = remoteVideoResyncAtRef.current[bundle.peerId] || 0;\n        if (now - last < 2200) return;\n        remoteVideoResyncAtRef.current[bundle.peerId] = now;\n        sendSignal("CALL_CAMERA_RESYNC", [bundle.peerId], {\n          ...active,\n          cameraEnabled: true,\n          reason: "receiver-watchdog",\n        });\n      });\n    }, 700);\n    return () => window.clearInterval(timer);\n  }, [reconcileRemoteVideo, sendSignal]);\n\n`;
  source = source.replace(micRecoveryEffect, `${receiverEffect}${micRecoveryEffect}`);

  // Remove accidental duplicate assignments accumulated by older generated patches.
  source = source.replace(/(\n\s*pendingPushAnswerRef\.current = true;){2,}/g, '\n      pendingPushAnswerRef.current = true;');

  fs.writeFileSync(file, source, 'utf8');
}

for (const required of [
  marker,
  'SOCIALBIRD_CALL_SYSTEM_V7: dedicated-camera-track-stream',
  'SOCIALBIRD_CALL_SYSTEM_V7: desktop-receiver-watchdog',
  'remoteVideoTrackStreamsRef',
  'pc.getReceivers()',
  'receiver-watchdog',
]) {
  if (!source.includes(required)) throw new Error(`Call V7 invariant missing: ${required}`);
}

console.log('Call System V7 remote video is current: dedicated receiver streams, getReceivers reconciliation and desktop camera watchdog.');

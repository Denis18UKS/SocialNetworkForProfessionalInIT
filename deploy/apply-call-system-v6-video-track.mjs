import fs from 'node:fs';

const file = 'src/components/call/CallProvider.tsx';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const marker = '// SOCIALBIRD_CALL_SYSTEM_V6: real-camera-sender';

if (!source.includes(marker)) {
  if (!source.includes('  cameraSender: RTCRtpSender;')) {
    throw new Error('Call V6 patch failed: cameraSender type anchor');
  }
  source = source.replace(
    '  cameraSender: RTCRtpSender;',
    '  cameraSender: RTCRtpSender | null;',
  );

  const oldCreate = `    const cameraTrack = local?.getVideoTracks().find((track) => track.readyState === "live");\n    const cameraTransceiver = cameraTrack\n      ? pc.addTransceiver(cameraTrack, { direction: "sendrecv", streams: local ? [local] : [] })\n      : pc.addTransceiver("video", { direction: "sendrecv" });\n\n    const bundle: PeerBundle = {\n      peerId,\n      pc,\n      cameraSender: cameraTransceiver.sender,`;
  const newCreate = `    // SOCIALBIRD_CALL_SYSTEM_V6: real-camera-sender\n    // Do not pre-create an empty video transceiver for voice calls. Some browsers/WebViews\n    // keep that receiver muted forever after replaceTrack(). A real addTrack() guarantees\n    // a negotiated video m-line and a fresh remote ontrack event when video is enabled.\n    const cameraTrack = local?.getVideoTracks().find((track) => track.readyState === "live");\n    const cameraSender = cameraTrack && local ? pc.addTrack(cameraTrack, local) : null;\n\n    const bundle: PeerBundle = {\n      peerId,\n      pc,\n      cameraSender,`;
  if (!source.includes(oldCreate)) throw new Error('Call V6 patch failed: createPeer camera anchor');
  source = source.replace(oldCreate, newCreate);

  const renegotiateStart = source.indexOf('  const renegotiateCamera = useCallback(');
  const renegotiateEnd = source.indexOf('\n\n  const toggleCamera = useCallback(', renegotiateStart);
  if (renegotiateStart < 0 || renegotiateEnd < 0) {
    throw new Error('Call V6 patch failed: renegotiateCamera block');
  }
  const renegotiate = `  const renegotiateCamera = useCallback(async (snapshot: CallSnapshot, track: MediaStreamTrack | null) => {\n    // SOCIALBIRD_CALL_SYSTEM_V6: add-remove-camera-track\n    const local = localStreamRef.current;\n    const peerIds = Object.keys(peersRef.current).map(Number);\n    for (const peerId of peerIds) {\n      const bundle = peersRef.current[peerId];\n      if (!bundle || bundle.pc.signalingState === "closed") continue;\n\n      if (track && local) {\n        if (!bundle.cameraSender) {\n          bundle.cameraSender = bundle.pc.addTrack(track, local);\n        } else {\n          try {\n            if (typeof bundle.cameraSender.setStreams === "function") bundle.cameraSender.setStreams(local);\n          } catch {}\n          await bundle.cameraSender.replaceTrack(track).catch(() => undefined);\n        }\n      } else if (bundle.cameraSender) {\n        try { bundle.pc.removeTrack(bundle.cameraSender); } catch {\n          await bundle.cameraSender.replaceTrack(null).catch(() => undefined);\n        }\n        bundle.cameraSender = null;\n      }\n    }\n\n    sendSignal("CALL_CAMERA_STATE", allOtherParticipantIds(snapshot), {\n      ...snapshot,\n      cameraEnabled: Boolean(track),\n      cameraFacing: snapshot.cameraFacing,\n    });\n    for (const peerId of peerIds) await makeOffer(peerId, true);\n  }, [allOtherParticipantIds, makeOffer, sendSignal]);`;
  source = `${source.slice(0, renegotiateStart)}${renegotiate}${source.slice(renegotiateEnd)}`;

  const oldOnTrack = `      if (event.track.kind === "audio") attachRemoteAudio(peerId, stream, event.track);\n      if (event.track.kind === "video") classifyRemoteVideo(peerId, stream);\n      event.track.addEventListener("ended", () => {`;
  const newOnTrack = `      if (event.track.kind === "audio") attachRemoteAudio(peerId, stream, event.track);\n      if (event.track.kind === "video") {\n        // SOCIALBIRD_CALL_SYSTEM_V6: remote-video-unmute-refresh\n        classifyRemoteVideo(peerId, stream);\n        const refreshVideo = () => classifyRemoteVideo(peerId, stream);\n        event.track.addEventListener("unmute", refreshVideo);\n      }\n      event.track.addEventListener("ended", () => {`;
  if (!source.includes(oldOnTrack)) throw new Error('Call V6 patch failed: ontrack anchor');
  source = source.replace(oldOnTrack, newOnTrack);

  const cameraStateNeedle = `      if (!signal.cameraEnabled) {\n        setRemoteMedia((current) => {\n          const previous = current[peerId];\n          if (!previous) return current;\n          const next = { ...previous };\n          delete next.camera;\n          return { ...current, [peerId]: next };\n        });\n        return;\n      }\n      cameraResyncTimersRef.current[peerId] = window.setTimeout(() => {`;
  const cameraStateReplacement = `      if (!signal.cameraEnabled) {\n        setRemoteMedia((current) => {\n          const previous = current[peerId];\n          if (!previous) return current;\n          const next = { ...previous };\n          delete next.camera;\n          return { ...current, [peerId]: next };\n        });\n        return;\n      }\n\n      // SOCIALBIRD_CALL_SYSTEM_V6: restore-existing-unmuted-camera\n      // Re-enabling a previously negotiated sender may unmute the same receiver track\n      // without firing ontrack again. Restore that known stream immediately.\n      const screenId = expectedScreenStreamRef.current[peerId];\n      const knownCamera = Object.values(remoteStreamByIdRef.current).find((entry) =>\n        entry.peerId === peerId\n        && entry.stream.id !== screenId\n        && entry.stream.getVideoTracks().some((track) => track.readyState === "live" && !track.muted),\n      );\n      if (knownCamera) {\n        setRemoteMedia((current) => {\n          const previous = current[peerId] || {};\n          return { ...current, [peerId]: { ...previous, camera: knownCamera.stream } };\n        });\n      }\n\n      cameraResyncTimersRef.current[peerId] = window.setTimeout(() => {`;
  if (!source.includes(cameraStateNeedle)) throw new Error('Call V6 patch failed: camera state restore anchor');
  source = source.replace(cameraStateNeedle, cameraStateReplacement);

  const resyncStart = source.indexOf('    if (type === "CALL_CAMERA_RESYNC") {');
  const resyncEnd = source.indexOf('\n\n    if (type === "CALL_SCREEN_START") {', resyncStart);
  if (resyncStart < 0 || resyncEnd < 0) throw new Error('Call V6 patch failed: camera resync block');
  const resync = `    if (type === "CALL_CAMERA_RESYNC") {\n      const active = callRef.current;\n      const peerId = Number(signal.senderId);\n      const track = localStreamRef.current?.getVideoTracks().find((item) => item.readyState === "live") || null;\n      const bundle = peersRef.current[peerId];\n      if (active?.cameraEnabled && bundle && track && localStreamRef.current) {\n        // SOCIALBIRD_CALL_SYSTEM_V6: resync-real-camera-sender\n        if (!bundle.cameraSender) {\n          bundle.cameraSender = bundle.pc.addTrack(track, localStreamRef.current);\n        } else {\n          try {\n            if (typeof bundle.cameraSender.setStreams === "function") bundle.cameraSender.setStreams(localStreamRef.current);\n          } catch {}\n          await bundle.cameraSender.replaceTrack(track).catch(() => undefined);\n        }\n        await makeOffer(peerId, true);\n      }\n      return;\n    }`;
  source = `${source.slice(0, resyncStart)}${resync}${source.slice(resyncEnd)}`;

  fs.writeFileSync(file, source, 'utf8');
}

for (const required of [
  marker,
  'cameraSender: RTCRtpSender | null',
  'bundle.pc.addTrack(track, local)',
  'CALL_CAMERA_RESYNC',
  'remote-video-unmute-refresh',
  'restore-existing-unmuted-camera',
]) {
  if (!source.includes(required)) throw new Error(`Call V6 invariant missing: ${required}`);
}

console.log('Call System V6 video receiving is current: real camera senders, addTrack renegotiation, unmute refresh and camera resync.');

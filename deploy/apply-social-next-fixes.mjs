import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const patch = (relativePath, transform) => {
  const filePath = path.join(root, relativePath);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    console.log(`Applied social-next fixes: ${relativePath}`);
  }
};

const replaceRequired = (source, label, from, to) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Social-next patch failed: ${label}`);
  return source.replace(from, to);
};

patch('backend/server.js', (input) => {
  let source = input;

  if (!source.includes("require('./social-next-features')")) {
    source = replaceRequired(
      source,
      'backend social-next imports',
      "const { runSandboxedCompilerJob } = require('./compiler-client');",
      "const { runSandboxedCompilerJob } = require('./compiler-client');\nconst { registerSocialNextFeatures } = require('./social-next-features');\nconst { registerOfflineCallQueue } = require('./offline-call-queue');",
    );
  }

  if (!source.includes('SOCIAL_NEXT: offline-call-function-refs')) {
    source = replaceRequired(
      source,
      'offline call function refs',
      'const isUserOnline = (userId) => onlineUsers.has(Number(userId));',
      `const isUserOnline = (userId) => onlineUsers.has(Number(userId));\n// SOCIAL_NEXT: offline-call-function-refs\nlet sendOfflineCallPush = async () => {};\nlet queueOfflineCallSignal = async () => {};\nlet deliverPendingCallSignals = async () => {};`,
    );
  }

  if (!source.includes('SOCIAL_NEXT: replay-offline-call-signals')) {
    source = replaceRequired(
      source,
      'replay pending call signals',
      '                addOnlineSocket(decoded.id, ws);',
      `                addOnlineSocket(decoded.id, ws);\n                // SOCIAL_NEXT: replay-offline-call-signals\n                void deliverPendingCallSignals(decoded.id, ws);`,
    );
  }

  if (!source.includes('SOCIAL_NEXT: queue-and-push-offline-call')) {
    const callNotify = `                notifyClients({\n                    type: payload.type,\n                    data: {\n                        ...payload.data,\n                        senderId: Number(ws.userId),\n                        targetIds,\n                    },\n                });`;
    source = replaceRequired(
      source,
      'queue and push offline call',
      callNotify,
      `${callNotify}\n                // SOCIAL_NEXT: queue-and-push-offline-call\n                void queueOfflineCallSignal(payload.type, targetIds, payload.data || {}, Number(ws.userId));\n                if (payload.type === 'CALL_INVITE') {\n                    void sendOfflineCallPush(targetIds, payload.data || {}, Number(ws.userId));\n                }`,
    );
  }

  if (!source.includes('SOCIAL_NEXT: register-features')) {
    const marker = '// PRODUCTION_HARDENING: sandboxed-compiler-route';
    if (!source.includes(marker)) throw new Error('Social-next patch failed: backend registration marker');
    const registration = `// SOCIAL_NEXT: register-features\n({ sendOfflineCallPush } = registerSocialNextFeatures({ app, db, verifyToken, notifyClients, isUserOnline }));\n({ queueOfflineCallSignal, deliverPendingCallSignals } = registerOfflineCallQueue({ db, isUserOnline }));\n\n${marker}`;
    source = source.replace(marker, registration);
  }

  return source;
});

patch('src/pages/Settings.tsx', (input) => {
  let source = input;
  if (!source.includes('value="auto"')) {
    source = replaceRequired(
      source,
      'automatic language selector',
      '<Select value={settings.appLanguage} onValueChange={(value) => update({ appLanguage: value as AppSettings["appLanguage"] })}>',
      '<Select value={settings.appLanguage} onValueChange={(value) => update({ appLanguage: value as AppSettings["appLanguage"], languagePreferenceExplicit: true })}>',
    );
    source = replaceRequired(
      source,
      'automatic language option',
      '                <SelectContent>\n                  <SelectItem value="ru">{t("russian")}</SelectItem>',
      '                <SelectContent>\n                  <SelectItem value="auto">{t("browserLanguage")}</SelectItem>\n                  <SelectItem value="ru">{t("russian")}</SelectItem>',
    );
  }
  return source;
});

patch('src/pages/MyProfile.tsx', (input) => {
  let source = input;
  if (!source.includes('@/components/FriendQrTools')) {
    source = replaceRequired(
      source,
      'friend QR import',
      'import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";',
      'import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";\nimport FriendQrTools from "@/components/FriendQrTools";',
    );
  }
  if (!source.includes('<FriendQrTools />')) {
    source = replaceRequired(
      source,
      'friend QR profile actions',
      '              <div className="flex flex-wrap gap-3">\n                <LiquidButton',
      '              <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-3">\n                <FriendQrTools />\n                <LiquidButton',
    );
  }
  return source;
});

patch('src/lib/webrtc.ts', (input) => {
  let source = input;
  if (!source.includes('requestNextCameraTrack')) {
    const marker = 'export const playRemoteMedia = async (media: HTMLMediaElement) => {';
    if (!source.includes(marker)) throw new Error('Social-next patch failed: webrtc camera marker');
    const helper = `export const requestNextCameraTrack = async (currentTrack?: MediaStreamTrack | null) => {\n  const currentSettings = currentTrack?.getSettings?.() || {};\n  const currentDeviceId = currentSettings.deviceId;\n  const currentFacingMode = currentSettings.facingMode;\n  const devices = await navigator.mediaDevices.enumerateDevices();\n  const cameras = devices.filter((device) => device.kind === "videoinput" && device.deviceId);\n\n  let constraints: MediaTrackConstraints;\n  if (cameras.length > 1) {\n    const currentIndex = cameras.findIndex((device) => device.deviceId === currentDeviceId);\n    const nextCamera = cameras[(currentIndex >= 0 ? currentIndex + 1 : 0) % cameras.length];\n    constraints = buildVideoConstraints(nextCamera.deviceId);\n  } else {\n    constraints = {\n      ...buildVideoConstraints(),\n      facingMode: { ideal: currentFacingMode === "environment" ? "user" : "environment" },\n    };\n  }\n\n  let stream: MediaStream;\n  try {\n    stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });\n  } catch {\n    stream = await navigator.mediaDevices.getUserMedia({\n      video: {\n        width: { ideal: 1280 },\n        height: { ideal: 720 },\n        facingMode: { ideal: currentFacingMode === "environment" ? "user" : "environment" },\n      },\n      audio: false,\n    });\n  }\n\n  const track = stream.getVideoTracks()[0];\n  if (!track) {\n    stream.getTracks().forEach((item) => item.stop());\n    throw new DOMException("Camera track is unavailable", "NotFoundError");\n  }\n  track.enabled = true;\n  return { stream, track };\n};\n\n${marker}`;
    source = source.replace(marker, helper);
  }
  return source;
});

patch('src/components/VoiceCallControls.tsx', (input) => {
  let source = input;

  if (!source.includes('Maximize2,')) {
    source = source.replace('  Headphones,\n', '  Headphones,\n  Maximize2,\n  PictureInPicture2,\n');
    source = source.replace('  VideoOff,\n', '  VideoOff,\n  SwitchCamera,\n');
  }
  source = source.replace(
    'import { getPeerConnectionConfig, playRemoteMedia, requestCallMedia, requestCameraTrack } from "@/lib/webrtc";',
    'import { getPeerConnectionConfig, playRemoteMedia, requestCallMedia, requestCameraTrack, requestNextCameraTrack } from "@/lib/webrtc";'
  );
  if (!source.includes('@/lib/call-media-bus')) {
    source = source.replace(
      '} from "@/lib/call-audio-reliability";',
      `} from "@/lib/call-audio-reliability";\nimport {\n  clearCallMedia,\n  publishLocalCamera,\n  publishLocalScreen,\n  publishRemoteVideo,\n  removeRemoteVideoUser,\n} from "@/lib/call-media-bus";`,
    );
  }

  if (!source.includes('__itbirdActiveCallSwitchCamera')) {
    source = source.replace(
      '  __itbirdActiveCallToggleScreen?: () => void;\n};',
      '  __itbirdActiveCallToggleScreen?: () => void;\n  __itbirdActiveCallSwitchCamera?: () => void;\n};',
    );
  }

  if (!source.includes('const panelRef = useRef<HTMLDivElement')) {
    source = source.replace(
      '  const remoteMediaRef = useRef<HTMLDivElement | null>(null);',
      '  const remoteMediaRef = useRef<HTMLDivElement | null>(null);\n  const panelRef = useRef<HTMLDivElement | null>(null);',
    );
  }
  if (!source.includes('remoteVideoTracksRef')) {
    source = source.replace(
      '  const relayAudioSendersRef = useRef<Record<number, Record<number, RTCRtpSender>>>({});',
      `  const relayAudioSendersRef = useRef<Record<number, Record<number, RTCRtpSender>>>({});\n  // SOCIAL_NEXT: relay participant video through the current group-call host.\n  const remoteVideoTracksRef = useRef<Record<string, { sourcePeerId: number; track: MediaStreamTrack }>>({});\n  const relayVideoSendersRef = useRef<Record<number, Record<string, RTCRtpSender>>>({});`,
    );
  }

  if (!source.includes('SOCIAL_NEXT: publish-local-camera')) {
    source = replaceRequired(
      source,
      'publish local camera',
      `    localStreamRef.current.getVideoTracks().forEach((track) => {\n      track.enabled = kind === "video" && forceVideoEnabled;\n    });`,
      `    localStreamRef.current.getVideoTracks().forEach((track) => {\n      track.enabled = kind === "video" && forceVideoEnabled;\n    });\n    // SOCIAL_NEXT: publish-local-camera\n    publishLocalCamera(localStreamRef.current.getVideoTracks()[0] || null);`,
    );
  }

  if (!source.includes('SOCIAL_NEXT: publish-remote-video')) {
    source = replaceRequired(
      source,
      'publish remote video',
      `    if (stream.getVideoTracks().length > 0 && remoteMediaRef.current) {\n      // Audio has a dedicated persistent element, so video is intentionally muted.\n      attachMediaElement(remoteMediaRef.current, peerId, new MediaStream(stream.getVideoTracks()), true);\n    }`,
      `    if (stream.getVideoTracks().length > 0) {\n      // SOCIAL_NEXT: publish-remote-video\n      stream.getVideoTracks().forEach((track) => publishRemoteVideo(peerId, track, 'camera'));\n      if (remoteMediaRef.current) {\n        // Audio has a dedicated persistent element, so video is intentionally muted.\n        attachMediaElement(remoteMediaRef.current, peerId, new MediaStream(stream.getVideoTracks()), true);\n      }\n    }`,
    );
  }

  if (!source.includes('const relayGroupVideoTrack = async')) {
    const marker = '  const repairLocalMicrophone = async () => {';
    if (!source.includes(marker)) throw new Error('Social-next patch failed: group video relay marker');
    const helper = `  const relayGroupVideoTrack = async (sourcePeerId: number, track: MediaStreamTrack) => {\n    if (mode !== 'group' || track.kind !== 'video') return;\n    remoteVideoTracksRef.current[track.id] = { sourcePeerId, track };\n\n    for (const [targetKey, peer] of Object.entries(peersRef.current)) {\n      const targetPeerId = Number(targetKey);\n      if (targetPeerId === sourcePeerId || peer.signalingState === 'closed') continue;\n      relayVideoSendersRef.current[targetPeerId] ||= {};\n      if (relayVideoSendersRef.current[targetPeerId][track.id]) continue;\n      relayVideoSendersRef.current[targetPeerId][track.id] = peer.addTrack(track, new MediaStream([track]));\n      sendSignal('CALL_RELAY_TRACK', [targetPeerId], { sourcePeerId, trackId: track.id, kind: 'video' });\n      if (peer.remoteDescription && peer.signalingState === 'stable') {\n        await renegotiate(targetPeerId);\n      } else {\n        relayNeedsRenegotiationRef.current[targetPeerId] = true;\n      }\n    }\n  };\n\n${marker}`;
    source = source.replace(marker, helper);
  }

  if (!source.includes('SOCIAL_NEXT: include-known-video-tracks')) {
    const marker = `    // CALL_RELIABILITY: when a new group peer joins, include audio already received from other peers.\n    if (mode === 'group') {\n      for (const [sourceKey, audioTrack] of Object.entries(remoteAudioTracksRef.current)) {\n        const sourcePeerId = Number(sourceKey);\n        if (sourcePeerId === peerId || audioTrack.readyState !== 'live') continue;\n        relayAudioSendersRef.current[peerId] ||= {};\n        relayAudioSendersRef.current[peerId][sourcePeerId] = peer.addTrack(audioTrack, new MediaStream([audioTrack]));\n        sendSignal('CALL_RELAY_TRACK', [peerId], { sourcePeerId, trackId: audioTrack.id });\n      }\n    }`;
    const replacement = `${marker}\n\n    // SOCIAL_NEXT: include-known-video-tracks\n    if (mode === 'group') {\n      for (const [trackId, entry] of Object.entries(remoteVideoTracksRef.current)) {\n        if (entry.sourcePeerId === peerId || entry.track.readyState !== 'live') continue;\n        relayVideoSendersRef.current[peerId] ||= {};\n        if (relayVideoSendersRef.current[peerId][trackId]) continue;\n        relayVideoSendersRef.current[peerId][trackId] = peer.addTrack(entry.track, new MediaStream([entry.track]));\n        sendSignal('CALL_RELAY_TRACK', [peerId], { sourcePeerId: entry.sourcePeerId, trackId, kind: 'video' });\n      }\n    }`;
    source = replaceRequired(source, 'known group video tracks', marker, replacement);
  }

  if (!source.includes('void relayGroupVideoTrack(peerId, event.track);')) {
    source = replaceRequired(
      source,
      'relay incoming group video',
      `      if (event.track.kind === 'audio') {\n        event.track.enabled = true;\n        remoteAudioTracksRef.current[peerId] = event.track;\n        const handleUnmute = () => attachRemoteStream(peerId, event.streams[0] || new MediaStream([event.track]));\n        event.track.addEventListener('unmute', handleUnmute);\n        void relayGroupAudioTrack(peerId, event.track);\n      }`,
      `      if (event.track.kind === 'audio') {\n        event.track.enabled = true;\n        remoteAudioTracksRef.current[peerId] = event.track;\n        const handleUnmute = () => attachRemoteStream(peerId, event.streams[0] || new MediaStream([event.track]));\n        event.track.addEventListener('unmute', handleUnmute);\n        void relayGroupAudioTrack(peerId, event.track);\n      }\n      if (event.track.kind === 'video') {\n        publishRemoteVideo(peerId, event.track, 'camera');\n        void relayGroupVideoTrack(peerId, event.track);\n      }`,
    );
  }

  if (!source.includes('publishLocalCamera(videoTrack);')) {
    source = replaceRequired(
      source,
      'publish added camera',
      `    localStreamRef.current.addTrack(videoTrack);\n    Object.values(peersRef.current).forEach((peer) => peer.addTrack(videoTrack, localStreamRef.current as MediaStream));`,
      `    localStreamRef.current.addTrack(videoTrack);\n    publishLocalCamera(videoTrack);\n    Object.values(peersRef.current).forEach((peer) => peer.addTrack(videoTrack, localStreamRef.current as MediaStream));`,
    );
  }

  if (!source.includes('const switchCamera = async () =>')) {
    const marker = '  // APP_FIX: removable-screen-track';
    if (!source.includes(marker)) throw new Error('Social-next patch failed: switch camera marker');
    const helpers = `  const switchCamera = async () => {\n    const stream = localStreamRef.current;\n    const currentTrack = stream?.getVideoTracks()[0];\n    if (!stream || !currentTrack) {\n      toast({ title: 'Камера', description: 'Сначала включите камеру.' });\n      return;\n    }\n    try {\n      const { track: nextTrack } = await requestNextCameraTrack(currentTrack);\n      nextTrack.enabled = videoEnabled;\n      for (const peer of Object.values(peersRef.current)) {\n        const sender = peer.getSenders().find((item) => item.track === currentTrack);\n        if (sender) await sender.replaceTrack(nextTrack);\n      }\n      stream.removeTrack(currentTrack);\n      stream.addTrack(nextTrack);\n      publishLocalCamera(nextTrack);\n      currentTrack.stop();\n      if (localVideoRef.current) {\n        localVideoRef.current.srcObject = stream;\n        void localVideoRef.current.play().catch(() => undefined);\n      }\n    } catch (error) {\n      toast({ title: 'Камера', description: getMediaErrorMessage(error), variant: 'destructive' });\n    }\n  };\n\n  const toggleFullscreen = async () => {\n    const panel = panelRef.current;\n    if (!panel) return;\n    try {\n      if (document.fullscreenElement) await document.exitFullscreen();\n      else await panel.requestFullscreen();\n    } catch {\n      toast({ title: 'Полный экран', description: 'Браузер не разрешил полноэкранный режим.' });\n    }\n  };\n\n  const openPictureInPicture = async () => {\n    const video = remoteMediaRef.current?.querySelector<HTMLVideoElement>('video') || localVideoRef.current;\n    if (!video || !(document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled || !('requestPictureInPicture' in video)) {\n      toast({ title: 'Отдельное окно', description: 'Picture-in-Picture не поддерживается этим браузером.' });\n      return;\n    }\n    try {\n      await (video as HTMLVideoElement & { requestPictureInPicture: () => Promise<unknown> }).requestPictureInPicture();\n    } catch {\n      toast({ title: 'Отдельное окно', description: 'Не удалось вынести видео в отдельное окно.' });\n    }\n  };\n\n${marker}`;
    source = source.replace(marker, helpers);
  }

  if (!source.includes('publishLocalScreen(null);')) {
    source = source.replace(
      '    screenStreamRef.current = null;\n    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;',
      '    screenStreamRef.current = null;\n    publishLocalScreen(null);\n    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;',
    );
  }
  if (!source.includes('publishLocalScreen(track);')) {
    source = source.replace(
      '      screenStreamRef.current = stream;\n      screenSendersRef.current = {};',
      '      screenStreamRef.current = stream;\n      publishLocalScreen(track);\n      screenSendersRef.current = {};',
    );
  }

  if (!source.includes('removeRemoteVideoUser(peerId);')) {
    source = source.replace(
      '    delete relayAudioSendersRef.current[peerId];\n    delete relayNeedsRenegotiationRef.current[peerId];',
      `    delete relayAudioSendersRef.current[peerId];\n    delete relayVideoSendersRef.current[peerId];\n    Object.entries(remoteVideoTracksRef.current).forEach(([trackId, entry]) => {\n      if (entry.sourcePeerId === peerId) delete remoteVideoTracksRef.current[trackId];\n    });\n    removeRemoteVideoUser(peerId);\n    delete relayNeedsRenegotiationRef.current[peerId];`,
    );
  }

  if (!source.includes('remoteVideoTracksRef.current = {};')) {
    source = source.replace(
      '    relayAudioSendersRef.current = {};\n    relayNeedsRenegotiationRef.current = {};',
      '    relayAudioSendersRef.current = {};\n    remoteVideoTracksRef.current = {};\n    relayVideoSendersRef.current = {};\n    relayNeedsRenegotiationRef.current = {};',
    );
  }
  if (!source.includes('clearCallMedia();')) {
    source = source.replace(
      '    document.getElementById("itbird-global-call-media")?.replaceChildren();\n    setIsCalling(false);',
      '    document.getElementById("itbird-global-call-media")?.replaceChildren();\n    clearCallMedia();\n    setIsCalling(false);',
    );
  }

  if (!source.includes('delete windowWithCall.__itbirdActiveCallSwitchCamera;')) {
    source = source.replace(
      '    delete windowWithCall.__itbirdActiveCallToggleScreen;\n    const targetIds',
      '    delete windowWithCall.__itbirdActiveCallToggleScreen;\n    delete windowWithCall.__itbirdActiveCallSwitchCamera;\n    const targetIds',
    );
    source = source.replace(
      '        delete windowWithCall.__itbirdActiveCallToggleScreen;\n      }',
      '        delete windowWithCall.__itbirdActiveCallToggleScreen;\n        delete windowWithCall.__itbirdActiveCallSwitchCamera;\n      }',
    );
  }
  if (!source.includes('windowWithCall.__itbirdActiveCallSwitchCamera')) {
    source = source.replace(
      `    windowWithCall.__itbirdActiveCallToggleScreen = () => {\n      void toggleScreenShare();\n    };`,
      `    windowWithCall.__itbirdActiveCallToggleScreen = () => {\n      void toggleScreenShare();\n    };\n    windowWithCall.__itbirdActiveCallSwitchCamera = () => {\n      void switchCamera();\n    };`,
    );
  }

  if (!source.includes('ref={panelRef}')) {
    source = source.replace(
      '<div className="itbird-call-panel fixed inset-x-0 z-50',
      '<div ref={panelRef} className="itbird-call-panel fixed inset-x-0 z-50',
    );
  }

  if (!source.includes('title="Повернуть камеру"')) {
    const screenButton = `            <Button variant="ghost" size="sm" onClick={toggleScreenShare} className="bg-white/10 text-white hover:bg-white/15 hover:text-white">\n              {screenEnabled ? <ScreenShareOff className="h-4 w-4" /> : <ScreenShare className="h-4 w-4" />}\n            </Button>`;
    const enhanced = `${screenButton}\n\n            {videoEnabled && (\n              <Button variant="ghost" size="sm" onClick={() => void switchCamera()} className="bg-white/10 text-white hover:bg-white/15 hover:text-white" title="Повернуть камеру">\n                <SwitchCamera className="h-4 w-4" />\n              </Button>\n            )}\n\n            <Button variant="ghost" size="sm" onClick={() => void toggleFullscreen()} className="bg-white/10 text-white hover:bg-white/15 hover:text-white" title="На весь экран">\n              <Maximize2 className="h-4 w-4" />\n            </Button>\n\n            <Button variant="ghost" size="sm" onClick={() => void openPictureInPicture()} className="bg-white/10 text-white hover:bg-white/15 hover:text-white" title="Отдельное окно поверх программ">\n              <PictureInPicture2 className="h-4 w-4" />\n            </Button>`;
    source = replaceRequired(source, 'outgoing fullscreen/pip/camera buttons', screenButton, enhanced);
  }

  return source;
});

patch('src/components/RealtimeNotifications.tsx', (input) => {
  let source = input;

  if (!source.includes('Maximize2')) {
    source = source.replace(
      'import { ChevronDown, Headphones, Mic, MicOff, Minus, PhoneCall, PhoneOff, Pin, ScreenShare, ScreenShareOff, Video, VideoOff, Volume2, VolumeX } from "lucide-react";',
      'import { ChevronDown, Headphones, Maximize2, Mic, MicOff, Minus, PhoneCall, PhoneOff, PictureInPicture2, Pin, ScreenShare, ScreenShareOff, SwitchCamera, Video, VideoOff, Volume2, VolumeX } from "lucide-react";'
    );
  }
  source = source.replace(
    'import { getPeerConnectionConfig, playRemoteMedia, requestCallMedia, requestCameraTrack } from "@/lib/webrtc";',
    'import { getPeerConnectionConfig, playRemoteMedia, requestCallMedia, requestCameraTrack, requestNextCameraTrack } from "@/lib/webrtc";'
  );
  if (!source.includes('@/lib/call-media-bus')) {
    source = source.replace(
      '} from "@/lib/call-audio-reliability";',
      `} from "@/lib/call-audio-reliability";\nimport { clearCallMedia, getCallMediaSnapshot, publishLocalCamera, publishRemoteVideo, subscribeCallMedia } from "@/lib/call-media-bus";\nimport CallTrackVideo from "@/components/CallTrackVideo";`,
    );
  }

  if (!source.includes('const panelRef = useRef<HTMLDivElement')) {
    source = source.replace(
      '  const remoteVideoRef = useRef<HTMLDivElement | null>(null);',
      '  const remoteVideoRef = useRef<HTMLDivElement | null>(null);\n  const panelRef = useRef<HTMLDivElement | null>(null);',
    );
  }
  if (!source.includes('callMediaSnapshot')) {
    source = source.replace(
      '  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null);',
      '  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null);\n  const [callMediaSnapshot, setCallMediaSnapshot] = useState(getCallMediaSnapshot);',
    );
    source = source.replace(
      '  useEffect(() => {\n    activeCallRef.current = activeCall;\n  }, [activeCall]);',
      `  useEffect(() => {\n    activeCallRef.current = activeCall;\n  }, [activeCall]);\n\n  useEffect(() => subscribeCallMedia(setCallMediaSnapshot), []);`,
    );
  }

  if (!source.includes('clearCallMedia();')) {
    source = source.replace(
      '    remoteVideoRef.current?.replaceChildren();\n    pendingOfferRef.current = null;',
      '    remoteVideoRef.current?.replaceChildren();\n    clearCallMedia();\n    pendingOfferRef.current = null;',
    );
  }

  if (!source.includes('const switchActiveCamera = async')) {
    const marker = '  const handlePanelPointerDown = (event: PointerEvent<HTMLDivElement>) => {';
    if (!source.includes(marker)) throw new Error('Social-next patch failed: incoming call controls marker');
    const helpers = `  const switchActiveCamera = async () => {\n    if (activeCall?.senderId === 0) {\n      (window as typeof window & { __itbirdActiveCallSwitchCamera?: () => void }).__itbirdActiveCallSwitchCamera?.();\n      return;\n    }\n    const peer = peerRef.current;\n    const stream = localStreamRef.current;\n    const currentTrack = stream?.getVideoTracks()[0];\n    if (!peer || !stream || !currentTrack) return;\n    try {\n      const { track: nextTrack } = await requestNextCameraTrack(currentTrack);\n      nextTrack.enabled = videoEnabled;\n      const sender = peer.getSenders().find((item) => item.track === currentTrack);\n      if (sender) await sender.replaceTrack(nextTrack);\n      else peer.addTrack(nextTrack, stream);\n      stream.removeTrack(currentTrack);\n      stream.addTrack(nextTrack);\n      publishLocalCamera(nextTrack);\n      currentTrack.stop();\n      if (localVideoRef.current) {\n        localVideoRef.current.srcObject = stream;\n        void localVideoRef.current.play().catch(() => undefined);\n      }\n    } catch (error) {\n      toast({ title: 'Камера', description: getMicrophoneErrorMessage(error), variant: 'destructive' });\n    }\n  };\n\n  const toggleCallFullscreen = async () => {\n    const panel = panelRef.current;\n    if (!panel) return;\n    try {\n      if (document.fullscreenElement) await document.exitFullscreen();\n      else await panel.requestFullscreen();\n    } catch {\n      toast({ title: 'Полный экран', description: 'Браузер не разрешил полноэкранный режим.' });\n    }\n  };\n\n  const openCallPictureInPicture = async () => {\n    const video = remoteVideoRef.current?.querySelector<HTMLVideoElement>('video') || localVideoRef.current;\n    if (!video || !(document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled || !('requestPictureInPicture' in video)) {\n      toast({ title: 'Отдельное окно', description: 'Picture-in-Picture не поддерживается этим браузером.' });\n      return;\n    }\n    try {\n      await (video as HTMLVideoElement & { requestPictureInPicture: () => Promise<unknown> }).requestPictureInPicture();\n    } catch {\n      toast({ title: 'Отдельное окно', description: 'Не удалось вынести видео в отдельное окно.' });\n    }\n  };\n\n${marker}`;
    source = source.replace(marker, helpers);
  }

  if (!source.includes('SOCIAL_NEXT: publish-incoming-video')) {
    source = source.replace(
      `        if (remoteStream.getVideoTracks().length > 0) {\n          const videoRoot = remoteVideoRef.current;`,
      `        if (remoteStream.getVideoTracks().length > 0) {\n          // SOCIAL_NEXT: publish-incoming-video\n          const sourceUserId = relayedTrackSourceRef.current[event.track.id] || incomingCall.senderId;\n          remoteStream.getVideoTracks().forEach((track) => publishRemoteVideo(sourceUserId, track, 'camera'));\n          const videoRoot = remoteVideoRef.current;`,
    );
  }

  if (!source.includes('ref={panelRef}')) {
    source = source.replace(
      '        <div\n          className={`${panelPosition ?',
      '        <div\n          ref={panelRef}\n          className={`${panelPosition ?',
    );
  }

  if (!source.includes('callMediaSnapshot.localCamera')) {
    const oldPreview = `          {/* APP_FIX: incoming-self-preview-ui */}\n          {(videoEnabled || screenEnabled) && activeCall.senderId !== 0 && (\n            <div className="flex w-full flex-wrap justify-center gap-3">\n              {videoEnabled && (\n                <div className="space-y-1 text-center">\n                  <div className="text-[11px] text-white/60">Вы — камера</div>\n                  <video ref={localVideoRef} autoPlay muted playsInline className="h-28 w-44 rounded-lg bg-gray-950 object-cover" />\n                </div>\n              )}\n              {screenEnabled && (\n                <div className="space-y-1 text-center">\n                  <div className="text-[11px] text-white/60">Вы — демонстрация экрана</div>\n                  <video ref={localScreenVideoRef} autoPlay muted playsInline className="h-28 w-44 rounded-lg bg-gray-950 object-contain" />\n                </div>\n              )}\n            </div>\n          )}\n\n          <div ref={remoteVideoRef} className="grid w-full min-w-0 grid-cols-1 place-items-center gap-2 sm:grid-cols-2" />`;
    const newPreview = `          {/* APP_FIX: incoming-self-preview-ui */}\n          {activeCall.senderId !== 0 && (videoEnabled || screenEnabled) && (\n            <div className="flex w-full flex-wrap justify-center gap-3">\n              {videoEnabled && (\n                <div className="space-y-1 text-center">\n                  <div className="text-[11px] text-white/60">Вы — камера</div>\n                  <video ref={localVideoRef} autoPlay muted playsInline className="h-28 w-44 rounded-lg bg-gray-950 object-cover" />\n                </div>\n              )}\n              {screenEnabled && (\n                <div className="space-y-1 text-center">\n                  <div className="text-[11px] text-white/60">Вы — демонстрация экрана</div>\n                  <video ref={localScreenVideoRef} autoPlay muted playsInline className="h-28 w-44 rounded-lg bg-gray-950 object-contain" />\n                </div>\n              )}\n            </div>\n          )}\n\n          {activeCall.senderId === 0 && callMediaSnapshot.localCamera && videoEnabled && (\n            <div className="w-full text-center">\n              <div className="mb-1 text-[11px] text-white/60">Вы — камера</div>\n              <CallTrackVideo track={callMediaSnapshot.localCamera} className="mx-auto h-28 w-44 rounded-lg bg-gray-950 object-cover" />\n            </div>\n          )}\n\n          <div ref={remoteVideoRef} className="grid w-full min-w-0 grid-cols-1 place-items-center gap-2 sm:grid-cols-2 lg:grid-cols-3">\n            {activeCall.senderId === 0 && callMediaSnapshot.remoteVideos.map((entry) => (\n              <CallTrackVideo key={entry.key} track={entry.track} className="itbird-call-remote-video rounded-lg bg-black object-cover shadow-xl" />\n            ))}\n          </div>`;
    source = replaceRequired(source, 'persistent outgoing video panel', oldPreview, newPreview);
  }

  if (!source.includes('title="Повернуть камеру"')) {
    const screenButton = `            <Button variant="ghost" size="sm" onClick={toggleScreenShare} className="bg-white/10 text-white hover:bg-white/15 hover:text-white">\n              {screenEnabled ? <ScreenShareOff className="h-4 w-4" /> : <ScreenShare className="h-4 w-4" />}\n            </Button>`;
    const enhanced = `${screenButton}\n\n            {videoEnabled && (\n              <Button variant="ghost" size="sm" onClick={() => void switchActiveCamera()} className="bg-white/10 text-white hover:bg-white/15 hover:text-white" title="Повернуть камеру">\n                <SwitchCamera className="h-4 w-4" />\n              </Button>\n            )}\n\n            <Button variant="ghost" size="sm" onClick={() => void toggleCallFullscreen()} className="bg-white/10 text-white hover:bg-white/15 hover:text-white" title="На весь экран">\n              <Maximize2 className="h-4 w-4" />\n            </Button>\n\n            <Button variant="ghost" size="sm" onClick={() => void openCallPictureInPicture()} className="bg-white/10 text-white hover:bg-white/15 hover:text-white" title="Отдельное окно поверх программ">\n              <PictureInPicture2 className="h-4 w-4" />\n            </Button>`;
    source = replaceRequired(source, 'global call controls', screenButton, enhanced);
  }

  return source;
});

patch('src/index.css', (input) => {
  let source = input;
  if (!source.includes('SOCIAL_NEXT: fullscreen-call')) {
    source += `\n/* SOCIAL_NEXT: fullscreen-call */\n.itbird-call-panel:fullscreen {\n  width: 100vw !important;\n  max-width: none !important;\n  height: 100vh !important;\n  max-height: none !important;\n  inset: 0 !important;\n  margin: 0 !important;\n  border-radius: 0 !important;\n  padding: max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px)) !important;\n}\n.itbird-call-panel:fullscreen .itbird-call-remote-video {\n  width: 100% !important;\n  height: auto !important;\n  max-height: calc(100vh - 220px) !important;\n  object-fit: contain !important;\n}\n@media (max-width: 640px) {\n  .itbird-call-panel {\n    max-width: calc(100vw - 12px) !important;\n  }\n  .itbird-call-participants {\n    max-width: 58vw;\n    overflow-x: auto;\n    flex-wrap: nowrap !important;\n    justify-content: flex-start !important;\n    padding-bottom: 2px;\n  }\n}\n`;
  }
  return source;
});

patch('deploy/install.sh', (input) => {
  let source = input;
  if (!source.includes('qrencode zbar-tools')) {
    source = source.replace(
      '  build-essential python3 make g++',
      '  build-essential python3 make g++ qrencode zbar-tools',
    );
  }

  if (!source.includes('VAPID_PUBLIC_KEY=')) {
    const envMarker = 'JSON_BODY_LIMIT=2mb';
    if (source.includes(envMarker)) {
      source = source.replace(
        envMarker,
        `VAPID_PUBLIC_KEY=\nVAPID_PRIVATE_KEY=\nVAPID_SUBJECT=\n${envMarker}`,
      );
    }
  }

  if (!source.includes('ensure-vapid.mjs')) {
    const envDone = 'chown root:"$APP_GROUP" "$BACKEND_ENV"';
    if (source.includes(envDone)) {
      source = source.replace(envDone, `${envDone}\nnode "${APP_DIRECTORY}/deploy/ensure-vapid.mjs"`);
    }
  }

  if (!source.includes('apply-social-next-fixes.mjs')) {
    const preferred = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-mail-recovery-fixes.mjs"';
    const fallback = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/harden-source.mjs"';
    const call = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-social-next-fixes.mjs"';
    if (source.includes(preferred)) source = source.replace(preferred, `${preferred}\n${call}`);
    else if (source.includes(fallback)) source = source.replace(fallback, `${call}\n${fallback}`);
  }
  return source;
});

console.log('Social-next fixes are current.');

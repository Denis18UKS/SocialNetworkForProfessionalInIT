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
    console.log(`Applied mobile call audio fixes: ${relativePath}`);
  }
};

const replaceRequired = (source, label, from, to) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Mobile call audio fix failed: ${label}`);
  return source.replace(from, to);
};

patch('src/components/VoiceCallControls.tsx', (input) => {
  let source = input;

  source = replaceRequired(
    source,
    'WebRTC helpers import',
    'import { getIceServers } from "@/lib/webrtc";',
    'import { getPeerConnectionConfig, playRemoteMedia, requestCallMedia, requestCameraTrack } from "@/lib/webrtc";'
  );

  source = replaceRequired(
    source,
    'peer config',
    'const iceServers: RTCConfiguration = { iceServers: getIceServers() };',
    'const iceServers: RTCConfiguration = getPeerConnectionConfig();'
  );

  source = replaceRequired(
    source,
    'remote media playback',
    '  media.muted = muted;\n  media.srcObject = stream;',
    '  media.muted = muted;\n  media.srcObject = stream;\n  void playRemoteMedia(media);'
  );

  source = replaceRequired(
    source,
    'outgoing ICE queue ref',
    '  const screenSendersRef = useRef<Record<number, RTCRtpSender>>({});',
    '  const screenSendersRef = useRef<Record<number, RTCRtpSender>>({});\n  const pendingIceByPeerRef = useRef<Record<number, RTCIceCandidateInit[]>>({});'
  );

  source = replaceRequired(
    source,
    'mobile audio state',
    '  const [soundEnabled, setSoundEnabled] = useState(true);',
    '  const [soundEnabled, setSoundEnabled] = useState(true);\n  const [soundNeedsTap, setSoundNeedsTap] = useState(false);'
  );

  source = replaceRequired(
    source,
    'media acquisition',
    `    const settings = readSettings();\n    if (!localStreamRef.current) {\n      try {\n        localStreamRef.current = await navigator.mediaDevices.getUserMedia({\n          audio: {\n            ...(settings.microphoneDeviceId ? { deviceId: { exact: settings.microphoneDeviceId } } : {}),\n            echoCancellation: settings.noiseSuppressionMode === "krisp",\n            noiseSuppression: settings.noiseSuppressionMode === "krisp",\n            autoGainControl: settings.noiseSuppressionMode === "krisp",\n          },\n          video: kind === "video"\n            ? settings.cameraDeviceId\n              ? { deviceId: { exact: settings.cameraDeviceId } }\n              : true\n            : false,\n        });\n      } catch (error) {\n        toast({ title: "Ошибка звонка", description: getMediaErrorMessage(error), variant: "destructive" });\n        throw error;\n      }\n    }`,
    `    if (!localStreamRef.current) {\n      try {\n        localStreamRef.current = await requestCallMedia({ video: kind === "video" });\n      } catch (error) {\n        toast({ title: "Ошибка звонка", description: getMediaErrorMessage(error), variant: "destructive" });\n        throw error;\n      }\n    }`
  );

  source = replaceRequired(
    source,
    'remote stream single playback target',
    `  const attachRemoteStream = (peerId: number, stream: MediaStream) => {\n    if (remoteMediaRef.current) {\n      attachMediaElement(remoteMediaRef.current, peerId, stream, !soundEnabled);\n    }\n    attachMediaElement(getGlobalMediaRoot(), peerId, stream, !soundEnabled);\n  };`,
    `  const attachRemoteStream = (peerId: number, stream: MediaStream) => {\n    const container = remoteMediaRef.current || getGlobalMediaRoot();\n    const media = attachMediaElement(container, peerId, stream, !soundEnabled);\n    void playRemoteMedia(media).then((playing) => setSoundNeedsTap(!playing));\n  };`
  );

  source = replaceRequired(
    source,
    'attach media return',
    `  if (outputId && "setSinkId" in media) {\n    (media as HTMLMediaElement & { setSinkId: (sinkId: string) => Promise<void> })\n      .setSinkId(outputId)\n      .catch(() => undefined);\n  }\n};`,
    `  if (outputId && "setSinkId" in media) {\n    (media as HTMLMediaElement & { setSinkId: (sinkId: string) => Promise<void> })\n      .setSinkId(outputId)\n      .catch(() => undefined);\n  }\n  return media;\n};`
  );

  source = replaceRequired(
    source,
    'camera fallback',
    `  const addCameraTrack = async () => {\n    const settings = readSettings();\n    const cameraStream = await navigator.mediaDevices.getUserMedia({\n      video: settings.cameraDeviceId ? { deviceId: { exact: settings.cameraDeviceId } } : true,\n      audio: false,\n    });\n    const [videoTrack] = cameraStream.getVideoTracks();\n    if (!videoTrack) return;`,
    `  const addCameraTrack = async () => {\n    const { stream: cameraStream, track: videoTrack } = await requestCameraTrack();`
  );

  source = replaceRequired(
    source,
    'sound toggle playback retry',
    `  const toggleSound = () => {\n    const next = !soundEnabled;\n    remoteMediaRef.current?.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {\n      media.muted = !next;\n    });\n    getGlobalMediaRoot().querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {\n      media.muted = !next;\n    });\n    setSoundEnabled(next);\n  };`,
    `  const toggleSound = () => {\n    const next = !soundEnabled;\n    const media = [\n      ...Array.from(remoteMediaRef.current?.querySelectorAll<HTMLMediaElement>("audio, video") || []),\n      ...Array.from(getGlobalMediaRoot().querySelectorAll<HTMLMediaElement>("audio, video")),\n    ];\n    media.forEach((element) => { element.muted = !next; });\n    setSoundEnabled(next);\n    if (next) {\n      void Promise.all(media.map((element) => playRemoteMedia(element))).then((results) => {\n        setSoundNeedsTap(results.some((playing) => !playing));\n      });\n    }\n  };\n\n  const forceEnableRemoteSound = () => {\n    const media = [\n      ...Array.from(remoteMediaRef.current?.querySelectorAll<HTMLMediaElement>("audio, video") || []),\n      ...Array.from(getGlobalMediaRoot().querySelectorAll<HTMLMediaElement>("audio, video")),\n    ];\n    media.forEach((element) => { element.muted = false; });\n    setSoundEnabled(true);\n    void Promise.all(media.map((element) => playRemoteMedia(element))).then((results) => {\n      setSoundNeedsTap(results.some((playing) => !playing));\n    });\n  };`
  );

  source = replaceRequired(
    source,
    'answer ICE flush',
    `      if (payload.type === "CALL_ANSWER") {\n        const peer = peersRef.current[data.senderId];\n        if (peer) await peer.setRemoteDescription(new RTCSessionDescription(data.description));\n      }`,
    `      if (payload.type === "CALL_ANSWER") {\n        const peer = peersRef.current[data.senderId];\n        if (peer && data.description) {\n          await peer.setRemoteDescription(new RTCSessionDescription(data.description));\n          for (const candidate of pendingIceByPeerRef.current[data.senderId] || []) {\n            await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);\n          }\n          delete pendingIceByPeerRef.current[data.senderId];\n        }\n      }`
  );

  source = replaceRequired(
    source,
    'early outgoing ICE queue',
    `      if (payload.type === "CALL_ICE") {\n        const peer = peersRef.current[data.senderId];\n        if (peer && data.candidate) await peer.addIceCandidate(new RTCIceCandidate(data.candidate));\n      }`,
    `      if (payload.type === "CALL_ICE") {\n        const peer = peersRef.current[data.senderId];\n        if (peer && data.candidate) {\n          if (peer.remoteDescription) {\n            await peer.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => undefined);\n          } else {\n            pendingIceByPeerRef.current[data.senderId] ||= [];\n            pendingIceByPeerRef.current[data.senderId].push(data.candidate);\n          }\n        }\n      }`
  );

  source = replaceRequired(
    source,
    'clear pending ICE',
    '    screenSendersRef.current = {};\n    localStreamRef.current?.getTracks().forEach((track) => track.stop());',
    '    screenSendersRef.current = {};\n    pendingIceByPeerRef.current = {};\n    localStreamRef.current?.getTracks().forEach((track) => track.stop());'
  );

  source = replaceRequired(
    source,
    'sound autoplay banner',
    `          <div className="flex flex-wrap items-center justify-center gap-2">`,
    `          {soundNeedsTap && (\n            <Button type="button" variant="secondary" size="sm" onClick={forceEnableRemoteSound} className="w-full sm:w-auto">\n              Нажмите, чтобы включить звук собеседника\n            </Button>\n          )}\n\n          <div className="flex flex-wrap items-center justify-center gap-2">`
  );

  return source;
});

patch('src/components/RealtimeNotifications.tsx', (input) => {
  let source = input;

  source = replaceRequired(
    source,
    'incoming WebRTC helpers import',
    'import { getIceServers } from "@/lib/webrtc";',
    'import { getPeerConnectionConfig, playRemoteMedia, requestCallMedia, requestCameraTrack } from "@/lib/webrtc";'
  );

  source = replaceRequired(
    source,
    'incoming sound state',
    '  const [soundEnabled, setSoundEnabled] = useState(true);',
    '  const [soundEnabled, setSoundEnabled] = useState(true);\n  const [soundNeedsTap, setSoundNeedsTap] = useState(false);'
  );

  source = replaceRequired(
    source,
    'incoming media acquisition',
    `      const settings = readSettings();\n      const wantsVideo = incomingCall.callKind === "video";\n      const stream = await navigator.mediaDevices.getUserMedia({\n        audio: {\n          ...(settings.microphoneDeviceId ? { deviceId: { exact: settings.microphoneDeviceId } } : {}),\n          echoCancellation: settings.noiseSuppressionMode === "krisp",\n          noiseSuppression: settings.noiseSuppressionMode === "krisp",\n          autoGainControl: settings.noiseSuppressionMode === "krisp",\n        },\n        video: wantsVideo\n          ? settings.cameraDeviceId\n            ? { deviceId: { exact: settings.cameraDeviceId } }\n            : true\n          : false,\n      });`,
    `      const wantsVideo = incomingCall.callKind === "video";\n      const stream = await requestCallMedia({ video: wantsVideo });`
  );

  source = replaceRequired(
    source,
    'incoming peer config',
    '      const peer = new RTCPeerConnection({ iceServers: getIceServers() });',
    '      const peer = new RTCPeerConnection(getPeerConnectionConfig());'
  );

  source = replaceRequired(
    source,
    'incoming remote playback',
    '        media.srcObject = remoteStream;',
    '        media.muted = !soundEnabled;\n        media.srcObject = remoteStream;\n        void playRemoteMedia(media).then((playing) => setSoundNeedsTap(!playing));'
  );

  source = replaceRequired(
    source,
    'incoming camera fallback',
    `        const settings = readSettings();\n        const camera = await navigator.mediaDevices.getUserMedia({\n          video: settings.cameraDeviceId ? { deviceId: { exact: settings.cameraDeviceId } } : true,\n          audio: false,\n        });\n        const [track] = camera.getVideoTracks();\n        if (!track) return;`,
    `        const { track } = await requestCameraTrack();`
  );

  source = replaceRequired(
    source,
    'incoming sound retry',
    `    const next = !soundEnabled;\n    remoteAudioRef.current?.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {\n      media.muted = !next;\n    });\n    setSoundEnabled(next);`,
    `    const next = !soundEnabled;\n    const media = Array.from(remoteAudioRef.current?.querySelectorAll<HTMLMediaElement>("audio, video") || []);\n    media.forEach((element) => { element.muted = !next; });\n    setSoundEnabled(next);\n    if (next) {\n      void Promise.all(media.map((element) => playRemoteMedia(element))).then((results) => {\n        setSoundNeedsTap(results.some((playing) => !playing));\n      });\n    }`
  );

  source = replaceRequired(
    source,
    'incoming force sound helper',
    `  const renegotiateActivePeer = async () => {`,
    `  const forceEnableRemoteSound = () => {\n    const media = Array.from(remoteAudioRef.current?.querySelectorAll<HTMLMediaElement>("audio, video") || []);\n    media.forEach((element) => { element.muted = false; });\n    setSoundEnabled(true);\n    void Promise.all(media.map((element) => playRemoteMedia(element))).then((results) => {\n      setSoundNeedsTap(results.some((playing) => !playing));\n    });\n  };\n\n  const renegotiateActivePeer = async () => {`
  );

  source = replaceRequired(
    source,
    'reset sound tap state',
    '    setSoundEnabled(true);\n    setVideoEnabled(false);',
    '    setSoundEnabled(true);\n    setSoundNeedsTap(false);\n    setVideoEnabled(false);'
  );

  source = replaceRequired(
    source,
    'incoming sound banner',
    `          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/5 pt-5">`,
    `          {soundNeedsTap && (\n            <Button type="button" variant="secondary" size="sm" onClick={forceEnableRemoteSound} className="w-full sm:w-auto">\n              Нажмите, чтобы включить звук собеседника\n            </Button>\n          )}\n\n          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/5 pt-5">`
  );

  return source;
});

console.log('Mobile call audio fixes are current.');

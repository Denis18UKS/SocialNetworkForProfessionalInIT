import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(deployDirectory, '..');

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, value) => fs.writeFileSync(path.join(root, relativePath), value, 'utf8');

const replaceRequired = (source, label, pattern, replacement) => {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Application fix failed: ${label}`);
  return next;
};

const patchBackend = () => {
  const file = 'backend/server.js';
  let source = read(file);
  const initial = source;

  if (!source.includes('APP_FIX: friendship-status-bidirectional')) {
    source = replaceRequired(
      source,
      'bidirectional friendship status',
      /\n\s*\/\/ Получаем статус дружбы для каждого пользователя[\s\S]*?\n\s*res\.json\(usersWithStatus\);/,
      `\n        // APP_FIX: friendship-status-bidirectional\n        const [friendships] = await db.query(\n            \`SELECT\n                CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END AS other_user_id,\n                f.status\n             FROM friends f\n             WHERE f.user_id = ? OR f.friend_id = ?\`,\n            [userId, userId, userId]\n        );\n\n        const friendshipByUserId = new Map(\n            friendships.map((friendship) => [Number(friendship.other_user_id), friendship.status])\n        );\n\n        const usersWithStatus = users.map((user) => ({\n            ...user,\n            friendshipStatus: friendshipByUserId.get(Number(user.id)) || 'none',\n        }));\n\n        res.json(usersWithStatus);`
    );
  }

  if (!source.includes('APP_FIX: remove-friend-route')) {
    const marker = '\n// Получение заявки в друзья';
    const index = source.indexOf(marker);
    if (index < 0) throw new Error('Application fix failed: friend request marker');
    const route = `\n// APP_FIX: remove-friend-route\napp.delete('/friends/:friendId', verifyToken, async (req, res) => {\n    const userId = Number(req.user.id);\n    const friendId = Number(req.params.friendId);\n\n    if (!friendId || friendId === userId) {\n        return res.status(400).json({ message: 'Некорректный пользователь' });\n    }\n\n    try {\n        const [result] = await db.query(\n            \`DELETE FROM friends\n             WHERE status = 'accepted'\n               AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))\`,\n            [userId, friendId, friendId, userId]\n        );\n\n        if (result.affectedRows === 0) {\n            return res.status(404).json({ message: 'Дружба не найдена' });\n        }\n\n        notifyClients({\n            type: 'FRIENDSHIP_CHANGED',\n            data: { targetIds: [userId, friendId], userId, friendId, status: 'none' },\n        });\n        res.json({ message: 'Пользователь удален из друзей', friendshipStatus: 'none' });\n    } catch (error) {\n        console.error('Ошибка при удалении из друзей:', error);\n        res.status(500).json({ message: 'Ошибка сервера' });\n    }\n});\n`;
    source = source.slice(0, index) + route + source.slice(index);
  }

  if (!source.includes('APP_FIX: friend-accept-notification')) {
    source = replaceRequired(
      source,
      'accepted friendship notification',
      '        res.json({ message: "Заявка принята" });',
      `        // APP_FIX: friend-accept-notification\n        notifyClients({\n            type: 'FRIENDSHIP_CHANGED',\n            data: {\n                targetIds: [Number(userId), Number(friendId)],\n                userId: Number(userId),\n                friendId: Number(friendId),\n                status: 'accepted',\n            },\n        });\n\n        res.json({ message: "Заявка принята", friendshipStatus: 'accepted' });`
    );
    source = source.replace(
      `"UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ? OR user_id = ? AND friend_id = ?"`,
      `"UPDATE friends SET status = 'accepted' WHERE status = 'pending' AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))"`
    );
  }

  if (!source.includes('APP_FIX: hackathons-safe-browser')) {
    const start = source.indexOf("app.get('/hackathons'");
    const end = source.indexOf('// Получение репозиториев пользователя', start);
    if (start < 0 || end < 0) throw new Error('Application fix failed: hackathons route bounds');
    let route = source.slice(start, end);

    route = replaceRequired(
      route,
      'safe Puppeteer launch',
      /    const browser = await puppeteer\.launch\(\{\n        headless: true,\n        args: \['--no-sandbox', '--disable-setuid-sandbox'\],\n    \}\);\n    const page = await browser\.newPage\(\);\n\n    try \{/,
      `    // APP_FIX: hackathons-safe-browser\n    let browser = null;\n\n    try {\n        browser = await puppeteer.launch({\n            headless: true,\n            args: ['--no-sandbox', '--disable-setuid-sandbox'],\n        });\n        const page = await browser.newPage();`
    );

    route = replaceRequired(
      route,
      'safe Puppeteer close',
      `    } finally {\n        await browser.close();\n    }`,
      `    } finally {\n        if (browser) await browser.close().catch(() => undefined);\n    }`
    );

    route = route.replace(
      `        res.status(500).json({ message: 'Ошибка при загрузке данных' });`,
      `        const browserUnavailable = /Could not find Chrome|Failed to launch|browser executable/i.test(String(err?.message || err));\n        res.status(browserUnavailable ? 503 : 500).json({\n            message: browserUnavailable\n                ? 'Сервис хакатонов временно недоступен: браузер-парсер не установлен.'\n                : 'Ошибка при загрузке данных',\n            code: browserUnavailable ? 'HACKATHON_BROWSER_UNAVAILABLE' : 'HACKATHON_FETCH_FAILED',\n        });`
    );

    source = source.slice(0, start) + route + source.slice(end);
  }

  if (source !== initial) {
    write(file, source);
    console.log(`Applied application fixes: ${file}`);
  }
};

const patchVoiceCalls = () => {
  const file = 'src/components/VoiceCallControls.tsx';
  let source = read(file);
  const initial = source;

  if (!source.includes('APP_FIX: per-stream-media-elements')) {
    source = replaceRequired(
      source,
      'per-stream remote media',
      `  const hasVideo = stream.getVideoTracks().length > 0;\n  const selector = hasVideo ? \`video[data-peer-id="\${peerId}"]\` : \`audio[data-peer-id="\${peerId}"]\`;`,
      `  // APP_FIX: per-stream-media-elements\n  const hasVideo = stream.getVideoTracks().length > 0;\n  const streamId = stream.id || \`peer-\${peerId}-\${hasVideo ? 'video' : 'audio'}\`;\n  const selector = \`\${hasVideo ? 'video' : 'audio'}[data-peer-id="\${peerId}"][data-stream-id="\${streamId}"]\`;`
    );
    source = source.replace(
      `    media.dataset.peerId = String(peerId);\n    media.autoplay = true;`,
      `    media.dataset.peerId = String(peerId);\n    media.dataset.streamId = streamId;\n    media.autoplay = true;`
    );
  }

  if (!source.includes('screenSendersRef')) {
    source = replaceRequired(
      source,
      'screen sharing refs',
      `  const localVideoRef = useRef<HTMLVideoElement | null>(null);`,
      `  const localVideoRef = useRef<HTMLVideoElement | null>(null);\n  const localScreenVideoRef = useRef<HTMLVideoElement | null>(null);\n  const screenSendersRef = useRef<Record<number, RTCRtpSender>>({});`
    );
  }

  if (!source.includes('APP_FIX: explicit-call-kind-wins')) {
    source = replaceRequired(
      source,
      'call signal metadata ordering',
      `      data: { ...data, chatId, mode, title, callKind, callerName: self?.username, participants: callParticipants },`,
      `      // APP_FIX: explicit-call-kind-wins\n      data: { chatId, mode, title, callKind, callerName: self?.username, participants: callParticipants, ...data },`
    );
  }

  if (!source.includes('APP_FIX: keep-initial-video-enabled')) {
    source = replaceRequired(
      source,
      'initial video enabled while peer is created',
      `    const stream = await ensureLocalStream(kind);\n    const peer = new RTCPeerConnection(iceServers);`,
      `    // APP_FIX: keep-initial-video-enabled\n    const stream = await ensureLocalStream(kind, kind === 'video' ? true : videoEnabled);\n    const peer = new RTCPeerConnection(iceServers);`
    );
  }

  if (!source.includes('APP_FIX: local-preview-sync')) {
    source = replaceRequired(
      source,
      'local preview effect',
      `  useEffect(() => {\n    isCallingRef.current = isCalling;\n  }, [isCalling]);`,
      `  useEffect(() => {\n    isCallingRef.current = isCalling;\n  }, [isCalling]);\n\n  // APP_FIX: local-preview-sync\n  useEffect(() => {\n    if (localVideoRef.current) {\n      localVideoRef.current.srcObject = localStreamRef.current;\n      localVideoRef.current.play().catch(() => undefined);\n    }\n    if (localScreenVideoRef.current) {\n      localScreenVideoRef.current.srcObject = screenStreamRef.current;\n      localScreenVideoRef.current.play().catch(() => undefined);\n    }\n  }, [isCalling, videoEnabled, screenEnabled]);`
    );
  }

  if (!source.includes('APP_FIX: removable-screen-track')) {
    source = replaceRequired(
      source,
      'screen share lifecycle',
      /  const toggleScreenShare = async \(\) => \{[\s\S]*?\n  \};\n\n  useEffect\(\(\) => \{\n    const handleDeviceTestStart/,
      `  // APP_FIX: removable-screen-track\n  const stopScreenShare = async () => {\n    const senders = screenSendersRef.current;\n    for (const [peerId, sender] of Object.entries(senders)) {\n      const peer = peersRef.current[Number(peerId)];\n      if (peer && peer.signalingState !== 'closed') {\n        try { peer.removeTrack(sender); } catch {}\n      }\n    }\n    screenSendersRef.current = {};\n    screenStreamRef.current?.getTracks().forEach((track) => track.stop());\n    screenStreamRef.current = null;\n    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;\n    setScreenEnabled(false);\n    await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id))));\n  };\n\n  const toggleScreenShare = async () => {\n    if (screenEnabled) {\n      await stopScreenShare();\n      return;\n    }\n\n    try {\n      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });\n      const [track] = stream.getVideoTracks();\n      if (!track) return;\n      screenStreamRef.current = stream;\n      screenSendersRef.current = {};\n\n      for (const [peerId, peer] of Object.entries(peersRef.current)) {\n        screenSendersRef.current[Number(peerId)] = peer.addTrack(track, stream);\n      }\n\n      track.onended = () => { void stopScreenShare(); };\n      setScreenEnabled(true);\n      if (localScreenVideoRef.current) {\n        localScreenVideoRef.current.srcObject = stream;\n        localScreenVideoRef.current.play().catch(() => undefined);\n      }\n      await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id))));\n    } catch {\n      toast({ title: 'Демонстрация экрана', description: 'Не удалось начать демонстрацию экрана', variant: 'destructive' });\n    }\n  };\n\n  useEffect(() => {\n    const handleDeviceTestStart`
    );
  }

  if (!source.includes('APP_FIX: self-video-and-screen-preview')) {
    source = replaceRequired(
      source,
      'self camera and screen preview UI',
      `          {callKind === "video" && (\n            <video ref={localVideoRef} autoPlay muted playsInline className="h-28 w-44 rounded-lg bg-gray-950 object-cover" />\n          )}`,
      `          {/* APP_FIX: self-video-and-screen-preview */}\n          {(videoEnabled || screenEnabled) && (\n            <div className="flex w-full flex-wrap justify-center gap-3">\n              {videoEnabled && (\n                <div className="space-y-1 text-center">\n                  <div className="text-[11px] text-white/60">Вы — камера</div>\n                  <video ref={localVideoRef} autoPlay muted playsInline className="h-28 w-44 rounded-lg bg-gray-950 object-cover" />\n                </div>\n              )}\n              {screenEnabled && (\n                <div className="space-y-1 text-center">\n                  <div className="text-[11px] text-white/60">Вы — демонстрация экрана</div>\n                  <video ref={localScreenVideoRef} autoPlay muted playsInline className="h-28 w-44 rounded-lg bg-gray-950 object-contain" />\n                </div>\n              )}\n            </div>\n          )}`
    );
  }

  if (!source.includes('screenSendersRef.current = {};\n    localStreamRef.current?.getTracks()')) {
    source = source.replace(
      `    peersRef.current = {};\n    localStreamRef.current?.getTracks().forEach((track) => track.stop());`,
      `    peersRef.current = {};\n    screenSendersRef.current = {};\n    localStreamRef.current?.getTracks().forEach((track) => track.stop());`
    );
  }

  if (source !== initial) {
    write(file, source);
    console.log(`Applied application fixes: ${file}`);
  }
};

const patchRealtimeCalls = () => {
  const file = 'src/components/RealtimeNotifications.tsx';
  let source = read(file);
  const initial = source;

  if (!source.includes('VideoOff')) {
    source = source.replace('ScreenShareOff, Video, Volume2', 'ScreenShareOff, Video, VideoOff, Volume2');
  }

  if (!source.includes('pendingIceCandidatesRef')) {
    source = replaceRequired(
      source,
      'incoming call refs',
      `  const peerRef = useRef<RTCPeerConnection | null>(null);\n  const remoteAudioRef = useRef<HTMLDivElement | null>(null);`,
      `  const peerRef = useRef<RTCPeerConnection | null>(null);\n  const remoteAudioRef = useRef<HTMLDivElement | null>(null);\n  const localVideoRef = useRef<HTMLVideoElement | null>(null);\n  const localScreenVideoRef = useRef<HTMLVideoElement | null>(null);\n  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);\n  const screenSenderRef = useRef<RTCRtpSender | null>(null);`
    );
  }

  if (!source.includes('const [videoEnabled')) {
    source = source.replace(
      `  const [soundEnabled, setSoundEnabled] = useState(true);\n  const [screenEnabled, setScreenEnabled] = useState(false);`,
      `  const [soundEnabled, setSoundEnabled] = useState(true);\n  const [videoEnabled, setVideoEnabled] = useState(false);\n  const [screenEnabled, setScreenEnabled] = useState(false);`
    );
  }

  if (!source.includes('APP_FIX: outgoing-call-video-state')) {
    source = replaceRequired(
      source,
      'outgoing video state sync',
      `        participants: detail.participants || [],\n      });\n    };`,
      `        participants: detail.participants || [],\n      });\n      // APP_FIX: outgoing-call-video-state\n      setVideoEnabled(detail.callKind === 'video');\n    };`
    );
  }

  if (!source.includes('pendingIceCandidatesRef.current = [];')) {
    source = source.replace(
      `    peerRef.current = null;\n    localStreamRef.current?.getTracks().forEach((track) => track.stop());`,
      `    peerRef.current = null;\n    pendingIceCandidatesRef.current = [];\n    screenSenderRef.current = null;\n    localStreamRef.current?.getTracks().forEach((track) => track.stop());`
    );
    source = source.replace(
      `    setSoundEnabled(true);\n    setScreenEnabled(false);`,
      `    setSoundEnabled(true);\n    setVideoEnabled(false);\n    setScreenEnabled(false);`
    );
  }

  if (!source.includes('APP_FIX: incoming-local-preview-sync')) {
    source = replaceRequired(
      source,
      'incoming local preview effect',
      `  const toggleMic = () => {`,
      `  // APP_FIX: incoming-local-preview-sync\n  useEffect(() => {\n    if (localVideoRef.current) {\n      localVideoRef.current.srcObject = localStreamRef.current;\n      localVideoRef.current.play().catch(() => undefined);\n    }\n    if (localScreenVideoRef.current) {\n      localScreenVideoRef.current.srcObject = screenStreamRef.current;\n      localScreenVideoRef.current.play().catch(() => undefined);\n    }\n  }, [activeCall, videoEnabled, screenEnabled]);\n\n  const toggleMic = () => {`
    );
  }

  if (!source.includes('APP_FIX: incoming-screen-track-lifecycle')) {
    source = replaceRequired(
      source,
      'incoming screen and video controls',
      /  const toggleScreenShare = async \(\) => \{[\s\S]*?\n  const handlePanelPointerDown/,
      `  // APP_FIX: incoming-screen-track-lifecycle\n  const stopIncomingScreenShare = async () => {\n    if (peerRef.current && screenSenderRef.current && peerRef.current.signalingState !== 'closed') {\n      try { peerRef.current.removeTrack(screenSenderRef.current); } catch {}\n    }\n    screenSenderRef.current = null;\n    screenStreamRef.current?.getTracks().forEach((track) => track.stop());\n    screenStreamRef.current = null;\n    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;\n    setScreenEnabled(false);\n    await renegotiateActivePeer();\n  };\n\n  const toggleScreenShare = async () => {\n    if (activeCall?.senderId === 0) {\n      (window as typeof window & { __itbirdActiveCallToggleScreen?: () => void }).__itbirdActiveCallToggleScreen?.();\n      setScreenEnabled((current) => !current);\n      return;\n    }\n\n    if (screenEnabled) {\n      await stopIncomingScreenShare();\n      return;\n    }\n\n    if (!peerRef.current) return;\n\n    try {\n      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });\n      const [track] = stream.getVideoTracks();\n      if (!track) return;\n      screenStreamRef.current = stream;\n      screenSenderRef.current = peerRef.current.addTrack(track, stream);\n      track.onended = () => { void stopIncomingScreenShare(); };\n      setScreenEnabled(true);\n      if (localScreenVideoRef.current) {\n        localScreenVideoRef.current.srcObject = stream;\n        localScreenVideoRef.current.play().catch(() => undefined);\n      }\n      await renegotiateActivePeer();\n    } catch {\n      toast({ title: 'Демонстрация экрана', description: 'Не удалось начать демонстрацию экрана', variant: 'destructive' });\n    }\n  };\n\n  const toggleVideo = async () => {\n    if (activeCall?.senderId === 0) {\n      (window as typeof window & { __itbirdActiveCallToggleVideo?: () => void }).__itbirdActiveCallToggleVideo?.();\n      setVideoEnabled((current) => !current);\n      setActiveCall((current) => current ? { ...current, callKind: 'video' } : current);\n      return;\n    }\n\n    if (!peerRef.current || !localStreamRef.current) return;\n    const next = !videoEnabled;\n    let videoTracks = localStreamRef.current.getVideoTracks();\n\n    if (next && videoTracks.length === 0) {\n      try {\n        const settings = readSettings();\n        const camera = await navigator.mediaDevices.getUserMedia({\n          video: settings.cameraDeviceId ? { deviceId: { exact: settings.cameraDeviceId } } : true,\n          audio: false,\n        });\n        const [track] = camera.getVideoTracks();\n        if (!track) return;\n        localStreamRef.current.addTrack(track);\n        peerRef.current.addTrack(track, localStreamRef.current);\n        videoTracks = [track];\n        await renegotiateActivePeer();\n      } catch (error) {\n        toast({ title: 'Камера', description: getMicrophoneErrorMessage(error), variant: 'destructive' });\n        return;\n      }\n    }\n\n    videoTracks.forEach((track) => { track.enabled = next; });\n    setVideoEnabled(next);\n    if (next) setActiveCall((current) => current ? { ...current, callKind: 'video' } : current);\n  };\n\n  const handlePanelPointerDown`
    );
  }

  if (!source.includes('APP_FIX: incoming-per-stream-media')) {
    source = replaceRequired(
      source,
      'incoming remote per stream media',
      `        const hasVideo = event.streams[0]?.getVideoTracks().length > 0;\n        let media = remoteAudioRef.current.querySelector<HTMLMediaElement>(hasVideo ? "video[data-call-media='remote']" : "audio[data-call-media='remote']");`,
      `        // APP_FIX: incoming-per-stream-media\n        const remoteStream = event.streams[0];\n        const hasVideo = remoteStream?.getVideoTracks().length > 0;\n        const streamId = remoteStream?.id || (hasVideo ? 'remote-video' : 'remote-audio');\n        let media = remoteAudioRef.current.querySelector<HTMLMediaElement>(\n          \`\${hasVideo ? 'video' : 'audio'}[data-call-stream-id="\${streamId}"]\`\n        );`
    );
    source = source.replace(
      `          media.dataset.callMedia = "remote";\n          media.autoplay = true;`,
      `          media.dataset.callMedia = 'remote';\n          media.dataset.callStreamId = streamId;\n          media.autoplay = true;`
    );
    source = source.replace('        media.srcObject = event.streams[0];', '        media.srcObject = remoteStream;');
  }

  if (!source.includes('APP_FIX: flush-pending-ice')) {
    source = replaceRequired(
      source,
      'flush ICE after remote description',
      `      await peer.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current.description));\n      const answer = await peer.createAnswer();`,
      `      await peer.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current.description));\n      // APP_FIX: flush-pending-ice\n      for (const candidate of pendingIceCandidatesRef.current.splice(0)) {\n        await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);\n      }\n      const answer = await peer.createAnswer();`
    );
    source = source.replace(
      `      localStreamRef.current = stream;`,
      `      localStreamRef.current = stream;\n      setVideoEnabled(wantsVideo);`
    );
  }

  if (!source.includes('APP_FIX: queue-early-ice')) {
    source = replaceRequired(
      source,
      'queue early ICE candidates',
      `        if (peerRef.current && call.candidate) {\n          peerRef.current.addIceCandidate(new RTCIceCandidate(call.candidate)).catch(() => undefined);\n        }`,
      `        // APP_FIX: queue-early-ice\n        if (call.candidate) {\n          if (peerRef.current?.remoteDescription) {\n            peerRef.current.addIceCandidate(new RTCIceCandidate(call.candidate)).catch(() => undefined);\n          } else {\n            pendingIceCandidatesRef.current.push(call.candidate);\n          }\n        }`
    );
  }

  if (!source.includes('APP_FIX: friendship-live-update')) {
    const anchor = `      if (notification.type === "NEW_GROUP_CHAT" || notification.type === "NEW_GROUP_MEMBER") {`;
    source = replaceRequired(
      source,
      'friendship realtime event',
      anchor,
      `      // APP_FIX: friendship-live-update\n      if (notification.type === 'FRIENDSHIP_CHANGED') {\n        const payload = notification.data || {};\n        if (payload.targetIds?.includes(currentUserId)) {\n          window.dispatchEvent(new CustomEvent('itbird-friendship-changed', { detail: payload }));\n        }\n      }\n\n${anchor}`
    );
  }

  if (!source.includes('APP_FIX: incoming-self-preview-ui')) {
    source = replaceRequired(
      source,
      'incoming self preview UI',
      `          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/5 pt-5">`,
      `          {/* APP_FIX: incoming-self-preview-ui */}\n          {(videoEnabled || screenEnabled) && activeCall.senderId !== 0 && (\n            <div className="flex w-full flex-wrap justify-center gap-3">\n              {videoEnabled && (\n                <div className="space-y-1 text-center">\n                  <div className="text-[11px] text-white/60">Вы — камера</div>\n                  <video ref={localVideoRef} autoPlay muted playsInline className="h-28 w-44 rounded-lg bg-gray-950 object-cover" />\n                </div>\n              )}\n              {screenEnabled && (\n                <div className="space-y-1 text-center">\n                  <div className="text-[11px] text-white/60">Вы — демонстрация экрана</div>\n                  <video ref={localScreenVideoRef} autoPlay muted playsInline className="h-28 w-44 rounded-lg bg-gray-950 object-contain" />\n                </div>\n              )}\n            </div>\n          )}\n\n          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/5 pt-5">`
    );
    source = source.replace(
      `{micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4 text-red-300" />}`,
      `{micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4 text-red-300" />}`
    );
    source = source.replace(
      `<Button variant="ghost" size="sm" onClick={toggleVideo} className="rounded-none text-white hover:bg-white/15 hover:text-white">\n                <Video className="h-4 w-4" />`,
      `<Button variant="ghost" size="sm" onClick={() => { void toggleVideo(); }} className="rounded-none text-white hover:bg-white/15 hover:text-white">\n                {videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4 text-red-300" />}`
    );
  }

  if (source !== initial) {
    write(file, source);
    console.log(`Applied application fixes: ${file}`);
  }
};

const patchUsers = () => {
  const file = 'src/pages/Users.tsx';
  let source = read(file);
  const initial = source;

  if (!source.includes('UserMinus')) {
    source = source.replace(
      `import { Search, UserPlus, User, Clock } from "lucide-react";`,
      `import { Search, UserPlus, User, Clock, UserMinus } from "lucide-react";`
    );
  }

  if (!source.includes('APP_FIX: live-friendship-state')) {
    source = replaceRequired(
      source,
      'live friendship state listener',
      `    const filteredUsers = users.filter((user) => {`,
      `    // APP_FIX: live-friendship-state\n    useEffect(() => {\n        const handleFriendshipChanged = (event: Event) => {\n            const token = localStorage.getItem('token');\n            if (!token) return;\n            try {\n                const currentUserId = Number((jwt_decode(token) as { id: number }).id);\n                const detail = (event as CustomEvent<{ userId: number; friendId: number; status: User['friendshipStatus'] }>).detail;\n                const otherUserId = Number(detail.userId) === currentUserId ? Number(detail.friendId) : Number(detail.userId);\n                if (!otherUserId) return;\n                setUsers((current) => current.map((user) =>\n                    user.id === otherUserId ? { ...user, friendshipStatus: detail.status } : user\n                ));\n            } catch {\n                // Ignore malformed local auth state.\n            }\n        };\n        window.addEventListener('itbird-friendship-changed', handleFriendshipChanged);\n        return () => window.removeEventListener('itbird-friendship-changed', handleFriendshipChanged);\n    }, []);\n\n    const filteredUsers = users.filter((user) => {`
    );
  }

  if (!source.includes('APP_FIX: remove-friend-action')) {
    source = replaceRequired(
      source,
      'remove friend action',
      `    return (\n        <div className="min-h-full`,
      `    // APP_FIX: remove-friend-action\n    const removeFriend = async (userId: number) => {\n        try {\n            const token = localStorage.getItem('token');\n            const response = await fetch(\`http://localhost:5000/friends/\${userId}\`, {\n                method: 'DELETE',\n                headers: { Authorization: \`Bearer \${token}\` },\n            });\n            const data = await response.json().catch(() => ({}));\n            if (!response.ok) {\n                toast({ title: 'Ошибка', description: data.message || 'Не удалось удалить из друзей', variant: 'destructive' });\n                return;\n            }\n            setUsers((current) => current.map((user) =>\n                user.id === userId ? { ...user, friendshipStatus: 'none' } : user\n            ));\n            toast({ title: 'Готово', description: 'Пользователь удален из друзей' });\n        } catch {\n            toast({ title: 'Ошибка', description: 'Не удалось удалить из друзей', variant: 'destructive' });\n        }\n    };\n\n    return (\n        <div className="min-h-full`
    );
  }

  if (!source.includes('Удалить из друзей')) {
    source = replaceRequired(
      source,
      'accepted friendship button',
      `                                            ) : user.friendshipStatus === "pending" ? (\n                                                <Button\n                                                    variant="outline"\n                                                    className="text-gray-500 dark:text-gray-400"\n                                                    disabled\n                                                >\n                                                    <Clock className="h-4 w-4 mr-2" />\n                                                    Заявка отправлена\n                                                </Button>\n                                            ) : null}`,
      `                                            ) : user.friendshipStatus === "pending" ? (\n                                                <Button\n                                                    variant="outline"\n                                                    className="text-gray-500 dark:text-gray-400"\n                                                    disabled\n                                                >\n                                                    <Clock className="h-4 w-4 mr-2" />\n                                                    Заявка отправлена\n                                                </Button>\n                                            ) : user.friendshipStatus === "accepted" ? (\n                                                <Button\n                                                    variant="outline"\n                                                    className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"\n                                                    onClick={() => removeFriend(user.id)}\n                                                >\n                                                    <UserMinus className="h-4 w-4 mr-2" />\n                                                    Удалить из друзей\n                                                </Button>\n                                            ) : null}`
    );
  }

  if (source !== initial) {
    write(file, source);
    console.log(`Applied application fixes: ${file}`);
  }
};

patchBackend();
patchVoiceCalls();
patchRealtimeCalls();
patchUsers();
console.log('Application fixes are current.');

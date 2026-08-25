import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = (file) => fs.readFileSync(file, 'utf8');
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');

const replaceOnce = (source, label, from, to) => {
  if (!source.includes(from)) throw new Error(`C-Party realtime-end patch failed: ${label}`);
  return source.replace(from, to);
};

const verifyNodeSyntax = (file) => {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`C-Party realtime-end produced invalid JavaScript: ${file}`);
};

const patchBackend = () => {
  const file = 'backend/socialbird-final-platform.js';
  let source = read(file);
  const marker = '// SOCIALBIRD_CPARTY_REALTIME_END_V1: server-broadcast';
  if (source.includes(marker)) {
    verifyNodeSyntax(file);
    return;
  }

  const oldBlock = `    app.delete('/cinema/rooms/:id', auth, async (req, res) => {\n        const [result] = await db.query('UPDATE cinema_rooms SET is_active = 0 WHERE id = ? AND owner_id = ?', [Number(req.params.id), getUserId(req)]);\n        if (!result.affectedRows) return res.status(403).json({ message: 'Завершить комнату может только её создатель.' });\n        res.json({ ended: true });\n    });`;

  const newBlock = `    app.delete('/cinema/rooms/:id', auth, async (req, res) => {\n        const roomId = Number(req.params.id);\n        const userId = getUserId(req);\n        const [rooms] = await db.query('SELECT id, owner_id FROM cinema_rooms WHERE id = ? AND is_active = 1 LIMIT 1', [roomId]);\n        if (!rooms.length) return res.status(404).json({ message: 'Комната уже завершена или не найдена.' });\n        if (Number(rooms[0].owner_id) !== userId) return res.status(403).json({ message: 'Завершить комнату может только её создатель.' });\n\n        await db.query(\"UPDATE cinema_rooms SET is_active = 0, playback_state = 'paused', playback_updated_at = NOW() WHERE id = ?\", [roomId]);\n\n        ${marker}\n        if (notifyClients) {\n            try {\n                notifyClients({\n                    type: 'CINEMA_ROOM_ENDED',\n                    data: { roomId, endedBy: userId, endedAt: Date.now(), reason: 'owner-ended' },\n                });\n            } catch (error) {\n                console.warn('C-Party realtime end notification failed:', error?.message || error);\n            }\n        }\n\n        res.json({ ended: true, roomId });\n    });`;

  source = replaceOnce(source, 'backend room delete route', oldBlock, newBlock);
  write(file, source);
  verifyNodeSyntax(file);
};

const patchRealtimeBridge = () => {
  const file = 'src/components/RealtimeNotifications.tsx';
  let source = read(file);
  const marker = '// SOCIALBIRD_CPARTY_REALTIME_END_V1: websocket-bridge';
  if (source.includes(marker)) return;

  const anchor = `      if (notification.type === \"ONLINE_USERS\" || notification.type === \"USER_PRESENCE\") {\n        writeOnlineUserIds(notification.data.userIds || []);\n      }\n\n      if (notification.type === \"NEW_MESSAGE\") {`;
  const block = `      if (notification.type === \"ONLINE_USERS\" || notification.type === \"USER_PRESENCE\") {\n        writeOnlineUserIds(notification.data.userIds || []);\n      }\n\n      ${marker}\n      if (notification.type === \"CINEMA_ROOM_ENDED\") {\n        const payload = notification.data || {};\n        window.dispatchEvent(new CustomEvent(\"itbird-cinema-room-ended\", { detail: payload }));\n      }\n\n      if (notification.type === \"NEW_MESSAGE\") {`;

  source = replaceOnce(source, 'RealtimeNotifications websocket bridge', anchor, block);
  write(file, source);
};

const patchRoomPage = () => {
  const file = 'src/pages/CinemaPartyRoom.tsx';
  let source = read(file);
  const marker = '// SOCIALBIRD_CPARTY_REALTIME_END_V1: force-eject';

  if (!source.includes(marker)) {
    const effectAnchor = `  useEffect(() => {\n    if (!room || room.is_owner) return;`;
    const effectBlock = `  ${marker}\n  useEffect(() => {\n    const handleRoomEnded = (event: Event) => {\n      const payload = (event as CustomEvent<{ roomId?: number | string }>).detail || {};\n      if (String(payload.roomId || \"\") !== String(roomId)) return;\n      const video = videoRef.current;\n      if (video) {\n        try { video.pause(); } catch {}\n        video.removeAttribute(\"src\");\n        video.load();\n      }\n      navigate(\"/c-party\", { replace: true });\n    };\n    window.addEventListener(\"itbird-cinema-room-ended\", handleRoomEnded);\n    return () => window.removeEventListener(\"itbird-cinema-room-ended\", handleRoomEnded);\n  }, [roomId, navigate]);\n\n${effectAnchor}`;
    source = replaceOnce(source, 'room force-eject listener', effectAnchor, effectBlock);
  }

  const pollingOld = `        const response = await fetch(\`${'${api}'}/cinema/rooms/${'${roomId}'}${'${invite ? `?invite=${encodeURIComponent(invite)}` : ""}'}\`, { headers });\n        if (!response.ok) return;\n        const latest: Room = await response.json();`;
  const pollingNew = `        const response = await fetch(\`${'${api}'}/cinema/rooms/${'${roomId}'}${'${invite ? `?invite=${encodeURIComponent(invite)}` : ""}'}\`, { headers });\n        if (!response.ok) {\n          if (response.status === 404 || response.status === 410) {\n            window.dispatchEvent(new CustomEvent(\"itbird-cinema-room-ended\", { detail: { roomId, reason: \"server-ended\" } }));\n          }\n          return;\n        }\n        const latest: Room = await response.json();`;
  if (source.includes(pollingOld)) source = source.replace(pollingOld, pollingNew);

  const endOld = `    const response = await fetch(\`${'${api}'}/cinema/rooms/${'${roomId}'}\`, { method: \"DELETE\", headers });\n    if (response.ok) navigate(\"/c-party\");`;
  const endNew = `    const response = await fetch(\`${'${api}'}/cinema/rooms/${'${roomId}'}\`, { method: \"DELETE\", headers });\n    if (response.ok) {\n      window.dispatchEvent(new CustomEvent(\"itbird-cinema-room-ended\", { detail: { roomId, reason: \"owner-ended\" } }));\n    }`;
  if (source.includes(endOld)) source = source.replace(endOld, endNew);

  if (!source.includes(marker)) throw new Error('room force-eject marker missing');
  if (!source.includes('itbird-cinema-room-ended')) throw new Error('room realtime event missing');
  if (!source.includes('response.status === 404 || response.status === 410')) throw new Error('room ended polling fallback missing');
  write(file, source);
};

const patchAccountBlockRealtime = () => {
  const backendFile = 'backend/socialbird-final-platform.js';
  let backend = read(backendFile);
  const backendMarker = '// SOCIALBIRD_ACCOUNT_BLOCK_REALTIME_V1: targeted-kick';
  if (!backend.includes(backendMarker)) {
    const oldBlock = `    app.post('/admin/v2/users/:id/block', verifyDesktopAdmin, async (req, res) => {\n        const targetId = Number(req.params.id);\n        const reason = String(req.body?.reason || 'Нарушение правил SocialBIRD').trim().slice(0, 500);\n        if (targetId === Number(req.desktopAdmin.id)) return res.status(400).json({ message: 'Нельзя заблокировать собственный admin-аккаунт.' });\n        const [result] = await db.query(\"UPDATE users SET isBlocked = 'заблокирован' WHERE id = ?\", [targetId]);\n        if (!result.affectedRows) return res.status(404).json({ message: 'Пользователь не найден.' });\n        res.json({ blocked: true, reason });\n    });`;
    const newBlock = `    app.post('/admin/v2/users/:id/block', verifyDesktopAdmin, async (req, res) => {\n        const targetId = Number(req.params.id);\n        const reason = String(req.body?.reason || 'Нарушение правил SocialBIRD').trim().slice(0, 500);\n        if (targetId === Number(req.desktopAdmin.id)) return res.status(400).json({ message: 'Нельзя заблокировать собственный admin-аккаунт.' });\n        const [result] = await db.query(\"UPDATE users SET isBlocked = 'заблокирован' WHERE id = ?\", [targetId]);\n        if (!result.affectedRows) return res.status(404).json({ message: 'Пользователь не найден.' });\n\n        ${backendMarker}\n        if (notifyClients) {\n            try {\n                notifyClients({\n                    type: 'ACCOUNT_BLOCKED',\n                    data: {\n                        targetIds: [targetId],\n                        userId: targetId,\n                        reason,\n                        blockedBy: Number(req.desktopAdmin.id),\n                        blockedAt: Date.now(),\n                    },\n                });\n            } catch (error) {\n                console.warn('Realtime account block notification failed:', error?.message || error);\n            }\n        }\n\n        res.json({ blocked: true, reason });\n    });`;
    backend = replaceOnce(backend, 'admin realtime account block route', oldBlock, newBlock);
    write(backendFile, backend);
    verifyNodeSyntax(backendFile);
  }

  const realtimeFile = 'src/components/RealtimeNotifications.tsx';
  let realtime = read(realtimeFile);
  const realtimeMarker = '// SOCIALBIRD_ACCOUNT_BLOCK_REALTIME_V1: force-session-exit';
  if (!realtime.includes(realtimeMarker)) {
    const anchor = `      // SOCIALBIRD_CPARTY_REALTIME_END_V1: websocket-bridge\n      if (notification.type === \"CINEMA_ROOM_ENDED\") {\n        const payload = notification.data || {};\n        window.dispatchEvent(new CustomEvent(\"itbird-cinema-room-ended\", { detail: payload }));\n      }\n\n      if (notification.type === \"NEW_MESSAGE\") {`;
    const block = `      // SOCIALBIRD_CPARTY_REALTIME_END_V1: websocket-bridge\n      if (notification.type === \"CINEMA_ROOM_ENDED\") {\n        const payload = notification.data || {};\n        window.dispatchEvent(new CustomEvent(\"itbird-cinema-room-ended\", { detail: payload }));\n      }\n\n      ${realtimeMarker}\n      if (notification.type === \"ACCOUNT_BLOCKED\") {\n        const reason = String(notification.data?.reason || \"Нарушение правил SocialBIRD\").trim();\n        localStorage.removeItem(\"token\");\n        localStorage.removeItem(\"role\");\n        sessionStorage.setItem(\"socialbird:block-reason\", reason);\n        try { socketRef.current?.close(); } catch {}\n        window.alert(\"Вы были заблокированы по причине: \\\"\" + reason + \"\\\"\");\n        window.location.replace(\"/login?blocked=1\");\n        return;\n      }\n\n      if (notification.type === \"NEW_MESSAGE\") {`;
    realtime = replaceOnce(realtime, 'realtime blocked-account force exit', anchor, block);
    write(realtimeFile, realtime);
  }
};

const patchOwnerAudioV2 = () => {
  const file = 'src/pages/CinemaPartyRoom.tsx';
  let source = read(file);
  const marker = '// SOCIALBIRD_CPARTY_OWNER_AUDIO_V2: dedicated-audio-channel';
  if (source.includes(marker)) return;

  source = replaceOnce(
    source,
    'owner dedicated audio ref',
    `  const videoRef = useRef<HTMLVideoElement | null>(null);\n`,
    `  const videoRef = useRef<HTMLVideoElement | null>(null);\n  const ownerAudioRef = useRef<HTMLAudioElement | null>(null);\n`,
  );

  const v1Effect = /  \/\/ SOCIALBIRD_CPARTY_OWNER_AUDIO_V1:[\s\S]*?\n  \}, \[room\?\.is_owner, streamUrl\]\);\n/;
  if (!v1Effect.test(source)) throw new Error('C-Party owner audio V2 patch failed: V1 effect not found');
  source = source.replace(v1Effect, `  ${marker}\n  useEffect(() => {\n    if (!room?.is_owner) {\n      setOwnerAudioMuted(false);\n      return;\n    }\n    const audio = ownerAudioRef.current;\n    const video = videoRef.current;\n    if (!audio || !video) return;\n\n    const syncPosition = () => {\n      if (!Number.isFinite(video.currentTime)) return;\n      if (Math.abs(audio.currentTime - video.currentTime) > 0.35) {\n        try { audio.currentTime = video.currentTime; } catch {}\n      }\n    };\n    const reflectAudio = () => setOwnerAudioMuted(audio.muted || audio.volume <= 0.001 || audio.paused);\n\n    audio.muted = false;\n    if (!Number.isFinite(audio.volume) || audio.volume <= 0.001) audio.volume = 1;\n    syncPosition();\n    setOwnerAudioMuted(true);\n    audio.addEventListener(\"playing\", reflectAudio);\n    audio.addEventListener(\"pause\", reflectAudio);\n    audio.addEventListener(\"volumechange\", reflectAudio);\n    audio.addEventListener(\"loadedmetadata\", syncPosition);\n    const timer = window.setInterval(() => {\n      if (!video.paused && !audio.paused) syncPosition();\n    }, 500);\n    return () => {\n      window.clearInterval(timer);\n      audio.pause();\n      audio.removeEventListener(\"playing\", reflectAudio);\n      audio.removeEventListener(\"pause\", reflectAudio);\n      audio.removeEventListener(\"volumechange\", reflectAudio);\n      audio.removeEventListener(\"loadedmetadata\", syncPosition);\n    };\n  }, [room?.is_owner, streamUrl]);\n`);

  const handlerPattern = /  const enableOwnerAudio = async \(\) => \{[\s\S]*?\n  const selectEpisode = async/;
  if (!handlerPattern.test(source)) throw new Error('C-Party owner audio V2 patch failed: V1 handlers not found');
  source = source.replace(handlerPattern, `  const syncOwnerAudio = () => {\n    if (!room?.is_owner) return null;\n    const video = videoRef.current;\n    const audio = ownerAudioRef.current;\n    if (!video || !audio) return null;\n    const desiredSrc = video.currentSrc || video.src || streamUrl;\n    if (desiredSrc && audio.src !== desiredSrc) {\n      audio.src = desiredSrc;\n      audio.load();\n    }\n    audio.muted = false;\n    if (!Number.isFinite(audio.volume) || audio.volume <= 0.001) audio.volume = 1;\n    if (Number.isFinite(video.currentTime)) {\n      try { audio.currentTime = video.currentTime; } catch {}\n    }\n    return audio;\n  };\n\n  const enableOwnerAudio = async () => {\n    const audio = syncOwnerAudio();\n    if (!audio) return;\n    try {\n      await audio.play();\n      setOwnerAudioMuted(false);\n    } catch {\n      setOwnerAudioMuted(true);\n    }\n  };\n\n  const handleOwnerPlay = async () => {\n    if (room?.is_owner) await enableOwnerAudio();\n    void updateState(\"playing\");\n  };\n\n  const handleOwnerPause = () => {\n    if (room?.is_owner) ownerAudioRef.current?.pause();\n    void updateState(\"paused\");\n  };\n\n  const handleOwnerSeeked = () => {\n    const audio = syncOwnerAudio();\n    const video = videoRef.current;\n    if (room?.is_owner && audio && video && !video.paused) {\n      void audio.play().then(() => setOwnerAudioMuted(false)).catch(() => setOwnerAudioMuted(true));\n    }\n    void updateState(video?.paused ? \"paused\" : \"playing\");\n  };\n\n  const selectEpisode = async`);

  const videoHandlers = `                onPlay={handleOwnerPlay}\n                onPause={() => void updateState(\"paused\")}\n                onSeeked={() => void updateState(videoRef.current?.paused ? \"paused\" : \"playing\")}\n                onVolumeChange={() => {\n                  if (!room.is_owner) return;\n                  const video = videoRef.current;\n                  setOwnerAudioMuted(Boolean(video && (video.muted || video.volume <= 0.001)));\n                }}`;
  const newVideoHandlers = `                muted={room.is_owner}\n                onPlay={() => void handleOwnerPlay()}\n                onPause={handleOwnerPause}\n                onSeeked={handleOwnerSeeked}`;
  source = replaceOnce(source, 'owner video handler bridge', videoHandlers, newVideoHandlers);

  source = replaceOnce(
    source,
    'owner hidden audio element',
    `              />\n              {room.is_owner && ownerAudioMuted && (`,
    `              />\n              {room.is_owner && <audio ref={ownerAudioRef} src={streamUrl} preload=\"metadata\" className=\"hidden\" />}\n              {room.is_owner && ownerAudioMuted && (`,
  );

  if (!source.includes(marker) || !source.includes('ownerAudioRef')) throw new Error('C-Party owner audio V2 marker missing');
  write(file, source);
};

patchBackend();
patchRealtimeBridge();
patchRoomPage();
patchAccountBlockRealtime();
patchOwnerAudioV2();
verifyNodeSyntax('backend/socialbird-final-platform.js');

console.log('C-Party runtime applied: realtime room end, realtime blocked-account kick with reason, dedicated owner audio channel, polling fallback; backend syntax verified.');

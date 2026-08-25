import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');

const replaceOnce = (source, label, from, to) => {
  if (!source.includes(from)) throw new Error(`C-Party realtime-end patch failed: ${label}`);
  return source.replace(from, to);
};

const patchBackend = () => {
  const file = 'backend/socialbird-final-platform.js';
  let source = read(file);
  const marker = '// SOCIALBIRD_CPARTY_REALTIME_END_V1: server-broadcast';
  if (source.includes(marker)) return;

  const oldBlock = `    app.delete('/cinema/rooms/:id', auth, async (req, res) => {\n        const [result] = await db.query('UPDATE cinema_rooms SET is_active = 0 WHERE id = ? AND owner_id = ?', [Number(req.params.id), getUserId(req)]);\n        if (!result.affectedRows) return res.status(403).json({ message: 'Завершить комнату может только её создатель.' });\n        res.json({ ended: true });\n    });`;

  const newBlock = `    app.delete('/cinema/rooms/:id', auth, async (req, res) => {\n        const roomId = Number(req.params.id);\n        const userId = getUserId(req);\n        const [rooms] = await db.query('SELECT id, owner_id FROM cinema_rooms WHERE id = ? AND is_active = 1 LIMIT 1', [roomId]);\n        if (!rooms.length) return res.status(404).json({ message: 'Комната уже завершена или не найдена.' });\n        if (Number(rooms[0].owner_id) !== userId) return res.status(403).json({ message: 'Завершить комнату может только её создатель.' });\n\n        await db.query('UPDATE cinema_rooms SET is_active = 0, playback_state = \'paused\', playback_updated_at = NOW() WHERE id = ?', [roomId]);\n\n        ${marker}\n        if (notifyClients) {\n            try {\n                notifyClients({\n                    type: 'CINEMA_ROOM_ENDED',\n                    data: { roomId, endedBy: userId, endedAt: Date.now(), reason: 'owner-ended' },\n                });\n            } catch (error) {\n                console.warn('C-Party realtime end notification failed:', error?.message || error);\n            }\n        }\n\n        res.json({ ended: true, roomId });\n    });`;

  source = replaceOnce(source, 'backend room delete route', oldBlock, newBlock);
  write(file, source);
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

patchBackend();
patchRealtimeBridge();
patchRoomPage();

console.log('C-Party realtime end applied: server broadcasts room termination, clients stop playback and are force-ejected, polling fallback enabled.');

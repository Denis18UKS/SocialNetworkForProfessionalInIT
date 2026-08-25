import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = (file) => fs.readFileSync(file, 'utf8');
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');

const replaceOnce = (source, label, from, to) => {
  if (!source.includes(from)) throw new Error(`C-Party media-change patch failed: ${label}`);
  return source.replace(from, to);
};

const verifyNodeSyntax = (file) => {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`C-Party media-change produced invalid JavaScript: ${file}`);
};

const patchBackend = () => {
  const file = 'backend/socialbird-final-platform.js';
  let source = read(file);
  const marker = '// SOCIALBIRD_CPARTY_MEDIA_CHANGE_V1: owner-upload-source';
  if (source.includes(marker)) {
    verifyNodeSyntax(file);
    return;
  }

  const anchor = `    app.delete('/cinema/rooms/:id', auth, async (req, res) => {`;
  const block = `    ${marker}\n    app.post('/cinema/rooms/:id/media', auth, async (req, res) => {\n        await ensureSchema();\n        const userId = getUserId(req);\n        const roomId = Number(req.params.id);\n        const mediaUrl = String(req.body?.mediaUrl || '').trim().slice(0, 700);\n        const mediaPath = mediaUrl.split('?')[0];\n        if (!/^\\/cinema\\/media\\/[a-zA-Z0-9._-]+$/.test(mediaPath)) {\n            return res.status(400).json({ message: 'Некорректный адрес нового видео.' });\n        }\n\n        const [rows] = await db.query('SELECT owner_id, source_type, title_id FROM cinema_rooms WHERE id = ? AND is_active = 1 LIMIT 1', [roomId]);\n        if (!rows.length) return res.status(404).json({ message: 'Комната не найдена.' });\n        const current = rows[0];\n        if (Number(current.owner_id) !== userId) return res.status(403).json({ message: 'Сменить видео может только создатель комнаты.' });\n        if (String(current.source_type || '') !== 'upload' || current.title_id) {\n            return res.status(409).json({ message: 'Видео можно менять только в сеансе, созданном из собственного файла.' });\n        }\n\n        await db.query(\"UPDATE cinema_rooms SET media_url = ?, episode_id = NULL, playback_position = 0, playback_state = 'paused', playback_updated_at = NOW() WHERE id = ?\", [mediaPath, roomId]);\n\n        if (notifyClients) {\n            try {\n                notifyClients({\n                    type: 'CINEMA_MEDIA_CHANGED',\n                    data: { roomId, mediaUrl: mediaPath, changedBy: userId, changedAt: Date.now() },\n                });\n            } catch (error) {\n                console.warn('C-Party media-change notification failed:', error?.message || error);\n            }\n        }\n\n        res.json({ updated: true, roomId, mediaUrl: mediaPath, state: 'paused', position: 0 });\n    });\n\n${anchor}`;

  source = replaceOnce(source, 'backend media-change route', anchor, block);
  write(file, source);
  verifyNodeSyntax(file);
};

const patchRealtimeBridge = () => {
  const file = 'src/components/RealtimeNotifications.tsx';
  let source = read(file);
  const marker = '// SOCIALBIRD_CPARTY_MEDIA_CHANGE_V1: websocket-bridge';
  if (source.includes(marker)) return;

  const anchor = `      // SOCIALBIRD_ACCOUNT_BLOCK_REALTIME_V1: force-session-exit`;
  const block = `      ${marker}\n      if (notification.type === \"CINEMA_MEDIA_CHANGED\") {\n        const payload = notification.data || {};\n        window.dispatchEvent(new CustomEvent(\"itbird-cinema-media-changed\", { detail: payload }));\n      }\n\n${anchor}`;
  source = replaceOnce(source, 'realtime media-change bridge', anchor, block);
  write(file, source);
};

const patchRoomPage = () => {
  const file = 'src/pages/CinemaPartyRoom.tsx';
  let source = read(file);
  const marker = '// SOCIALBIRD_CPARTY_MEDIA_CHANGE_V1: in-session-upload-switch';
  if (source.includes(marker)) return;

  source = replaceOnce(
    source,
    'room React event import',
    `import { FormEvent, useEffect, useMemo, useRef, useState } from \"react\";`,
    `import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from \"react\";`,
  );

  source = replaceOnce(
    source,
    'room upload icon import',
    `import { Copy, Maximize2, MessageCircle, Play, QrCode, Send, Square, Users, Volume2, VolumeX } from \"lucide-react\";`,
    `import { Copy, Maximize2, MessageCircle, Play, QrCode, RefreshCw, Send, Square, Upload, Users, Volume2, VolumeX } from \"lucide-react\";`,
  );

  source = replaceOnce(
    source,
    'room cinema upload helper import',
    `import { Input } from \"@/components/ui/input\";`,
    `import { Input } from \"@/components/ui/input\";\nimport { uploadCinemaVideo } from \"@/lib/cinema-upload\";`,
  );

  source = replaceOnce(
    source,
    'room custom media fields',
    `  chat_enabled: number | boolean;\n  title_id?: number | null;`,
    `  chat_enabled: number | boolean;\n  source_type?: \"library\" | \"upload\";\n  media_url?: string | null;\n  resolved_media_url?: string | null;\n  title_id?: number | null;`,
  );

  source = replaceOnce(
    source,
    'room media change state',
    `  const [playerVolume, setPlayerVolume] = useState(initialVolumeRef.current);`,
    `  const [playerVolume, setPlayerVolume] = useState(initialVolumeRef.current);\n  const [replacingMedia, setReplacingMedia] = useState(false);\n  const [replaceProgress, setReplaceProgress] = useState(0);\n  const activeMediaKeyRef = useRef(\"\");\n  ${marker}`,
  );

  const streamOld = `  const roomUrl = useMemo(() => \`${'${window.location.origin}'}/c-party/room/${'${roomId}'}${'${invite ? `?invite=${encodeURIComponent(invite)}` : ""}'}\`, [roomId, invite]);\n  const streamUrl = useMemo(() => \`${'${api}'}/cinema/stream/${'${roomId}'}${'${invite ? `?invite=${encodeURIComponent(invite)}` : ""}'}\`, [roomId, invite]);`;
  const streamNew = `  const roomUrl = useMemo(() => \`${'${window.location.origin}'}/c-party/room/${'${roomId}'}${'${invite ? `?invite=${encodeURIComponent(invite)}` : ""}'}\`, [roomId, invite]);\n  const mediaKey = String(room?.resolved_media_url || room?.media_url || \"\");\n  const streamUrl = useMemo(() => \`${'${api}'}/cinema/stream/${'${roomId}'}?${'${invite ? `invite=${encodeURIComponent(invite)}&` : ""}'}media=${'${encodeURIComponent(mediaKey)}'}\`, [roomId, invite, mediaKey]);`;
  source = replaceOnce(source, 'room media-key stream URL', streamOld, streamNew);

  const participantAnchor = `        const latest: Room = await response.json();\n        setRoom((current) => current ? { ...current, ...latest } : latest);\n        const video = videoRef.current;`;
  const participantBlock = `        const latest: Room = await response.json();\n        const latestMediaKey = String(latest.resolved_media_url || latest.media_url || \"\");\n        const mediaChanged = latestMediaKey !== activeMediaKeyRef.current;\n        setRoom((current) => current ? { ...current, ...latest } : latest);\n        if (mediaChanged) {\n          activeMediaKeyRef.current = latestMediaKey;\n          applyingRemoteRef.current = true;\n          try { videoRef.current?.pause(); } catch {}\n          try { ownerAudioRef.current?.pause(); } catch {}\n          window.setTimeout(() => { applyingRemoteRef.current = false; }, 180);\n          return;\n        }\n        const video = videoRef.current;`;
  source = replaceOnce(source, 'participant detects media replacement', participantAnchor, participantBlock);

  const afterLoadEffect = `  }, [roomId, inviteFromUrl]);\n\n  useEffect(() => {\n    if (!room || room.is_owner) return;`;
  const mediaEffects = `  }, [roomId, inviteFromUrl]);\n\n  useEffect(() => {\n    activeMediaKeyRef.current = mediaKey;\n  }, [mediaKey]);\n\n  useEffect(() => {\n    const handleMediaChanged = (event: Event) => {\n      const payload = (event as CustomEvent<{ roomId?: number | string }>).detail || {};\n      if (String(payload.roomId || \"\") !== String(roomId)) return;\n      try { videoRef.current?.pause(); } catch {}\n      try { ownerAudioRef.current?.pause(); } catch {}\n      void loadRoom().catch(() => undefined);\n    };\n    window.addEventListener(\"itbird-cinema-media-changed\", handleMediaChanged);\n    return () => window.removeEventListener(\"itbird-cinema-media-changed\", handleMediaChanged);\n  }, [roomId, inviteFromUrl]);\n\n  useEffect(() => {\n    if (!room || room.is_owner) return;`;
  source = replaceOnce(source, 'room realtime media replacement listener', afterLoadEffect, mediaEffects);

  const sendAnchor = `  const sendMessage = async (event: FormEvent) => {`;
  const replaceHandler = `  const replaceCustomVideo = async (event: ChangeEvent<HTMLInputElement>) => {\n    const file = event.target.files?.[0];\n    event.target.value = \"\";\n    if (!file || !room?.is_owner) return;\n    if (room.source_type !== \"upload\" || room.title_id) {\n      window.alert(\"Менять видео можно только в сеансе со своим видео.\");\n      return;\n    }\n\n    setReplacingMedia(true);\n    setReplaceProgress(1);\n    try {\n      videoRef.current?.pause();\n      ownerAudioRef.current?.pause();\n      const uploaded = await uploadCinemaVideo({ file, onProgress: setReplaceProgress });\n      const response = await fetch(\`${'${api}'}/cinema/rooms/${'${roomId}'}/media\`, {\n        method: \"POST\",\n        headers: { ...headers, \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ mediaUrl: uploaded.mediaUrl }),\n      });\n      const data = await response.json().catch(() => ({}));\n      if (!response.ok) throw new Error(data?.message || \"Не удалось заменить видео в сеансе\");\n\n      const nextMedia = String(data.mediaUrl || uploaded.mediaUrl);\n      activeMediaKeyRef.current = nextMedia;\n      setRoom((current) => current ? {\n        ...current,\n        media_url: nextMedia,\n        resolved_media_url: nextMedia,\n        episode_id: null,\n        playback_position: 0,\n        effective_position: 0,\n        playback_state: \"paused\",\n      } : current);\n      setReplaceProgress(100);\n    } catch (replaceError) {\n      window.alert(replaceError instanceof Error ? replaceError.message : \"Не удалось заменить видео\");\n      setReplaceProgress(0);\n    } finally {\n      setReplacingMedia(false);\n    }\n  };\n\n${sendAnchor}`;
  source = replaceOnce(source, 'room replace-video handler', sendAnchor, replaceHandler);

  const controlsAnchor = `          {room.is_owner && <Button variant=\"outline\" size=\"sm\" onClick={() => navigator.clipboard.writeText(roomUrl)}><Copy className=\"mr-2 h-4 w-4\" />Ссылка</Button>}\n          {room.is_owner && <Button variant=\"destructive\" size=\"sm\" onClick={endRoom}><Square className=\"mr-2 h-4 w-4\" />Завершить</Button>}`;
  const controlsBlock = `          {room.is_owner && <Button variant=\"outline\" size=\"sm\" onClick={() => navigator.clipboard.writeText(roomUrl)}><Copy className=\"mr-2 h-4 w-4\" />Ссылка</Button>}\n          {room.is_owner && room.source_type === \"upload\" && !room.title_id && (\n            <label className={\`inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground ${'${replacingMedia ? "pointer-events-none opacity-60" : ""}'}\`}>\n              {replacingMedia ? <RefreshCw className=\"mr-2 h-4 w-4 animate-spin\" /> : <Upload className=\"mr-2 h-4 w-4\" />}\n              {replacingMedia ? \`Загрузка ${'${replaceProgress}'}%\` : \"Сменить видео\"}\n              <input type=\"file\" accept=\"video/*,.mkv,.mov,.avi,.wmv,.flv,.mpg,.mpeg,.ts,.m2ts,.3gp,.ogv\" className=\"hidden\" disabled={replacingMedia} onChange={replaceCustomVideo} />\n            </label>\n          )}\n          {room.is_owner && <Button variant=\"destructive\" size=\"sm\" onClick={endRoom}><Square className=\"mr-2 h-4 w-4\" />Завершить</Button>}`;
  source = replaceOnce(source, 'room owner replace-video control', controlsAnchor, controlsBlock);

  if (!source.includes(marker)) throw new Error('room media-change marker missing');
  if (!source.includes('/cinema/rooms/${roomId}/media')) throw new Error('room media-change endpoint missing');
  if (!source.includes('Сменить видео')) throw new Error('room media-change UI missing');
  write(file, source);
};

patchBackend();
patchRealtimeBridge();
patchRoomPage();
verifyNodeSyntax('backend/socialbird-final-platform.js');

console.log('C-Party session media change applied: custom-upload room owners can replace video in-session, playback resets to paused/0, and participants switch source in realtime.');

import fs from 'node:fs';

const backendMarker = '// SOCIALBIRD_CPARTY_PLAYLIST_AUTOPLAY_V1: backend';
const frontendMarker = '// SOCIALBIRD_CPARTY_PLAYLIST_AUTOPLAY_V1: frontend';

const patchBackend = () => {
  const file = 'backend/socialbird-final-platform.js';
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(backendMarker)) return;
  if (!source.includes('SOCIALBIRD_CPARTY_PLAYLIST_V1: persistent-queue')) {
    throw new Error('C-Party playlist autoplay V1 requires playlist V1 backend first');
  }

  const oldBlock = `    const activatePlaylistItem = async (roomId, item) => {\n        await db.query(\`UPDATE cinema_rooms SET source_type = ?, title_id = ?, episode_id = ?, media_url = ?, current_playlist_item_id = ?,\n            playback_position = 0, playback_state = 'paused', playback_updated_at = NOW() WHERE id = ? AND is_active = 1\`,\n            [item.source_type, item.title_id || null, item.episode_id || null, item.media_url || null, item.id, roomId]);\n        return {`;
  const newBlock = `    ${backendMarker}\n    const activatePlaylistItem = async (roomId, item) => {\n        await db.query(\`UPDATE cinema_rooms SET source_type = ?, title_id = ?, episode_id = ?, media_url = ?, current_playlist_item_id = ?,\n            playback_position = 0, playback_state = 'playing', playback_updated_at = NOW() WHERE id = ? AND is_active = 1\`,\n            [item.source_type, item.title_id || null, item.episode_id || null, item.media_url || null, item.id, roomId]);\n        return {`;
  if (!source.includes(oldBlock)) throw new Error('C-Party playlist autoplay V1 backend activate block not found');
  source = source.replace(oldBlock, newBlock);

  const returnedPaused = `            playback_state: 'paused',\n        };\n    };`;
  if (!source.includes(returnedPaused)) throw new Error('C-Party playlist autoplay V1 backend return state not found');
  source = source.replace(returnedPaused, `            playback_state: 'playing',\n        };\n    };`);

  fs.writeFileSync(file, source, 'utf8');
};

const patchFrontend = () => {
  const file = 'src/pages/CinemaPartyRoom.tsx';
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(frontendMarker)) return;
  if (!source.includes('SOCIALBIRD_CPARTY_PLAYLIST_V1: room-player')) {
    throw new Error('C-Party playlist autoplay V1 requires playlist V1 frontend first');
  }

  const oldApply = `    setRoom((current) => current ? { ...current, ...patch, playback_position: 0, effective_position: 0, playback_state: "paused" } : current);`;
  const newApply = `    ${frontendMarker}\n    setRoom((current) => current ? { ...current, ...patch, playback_position: 0, effective_position: 0, playback_state: patch.playback_state || "paused" } : current);`;
  if (!source.includes(oldApply)) throw new Error('C-Party playlist autoplay V1 frontend source-state block not found');
  source = source.replace(oldApply, newApply);

  const oldEffect = `    if (video) {\n      video.pause();\n      try { video.currentTime = 0; } catch {}\n      video.load();\n    }\n    if (audio) {\n      audio.pause();\n      try { audio.currentTime = 0; } catch {}\n      audio.load();\n    }`;
  const newEffect = `    const shouldPlay = room.playback_state === "playing";\n    if (video) {\n      video.pause();\n      try { video.currentTime = 0; } catch {}\n      video.load();\n    }\n    if (audio) {\n      audio.pause();\n      try { audio.currentTime = 0; } catch {}\n      audio.load();\n    }\n    if (shouldPlay) {\n      window.setTimeout(() => {\n        const activeVideo = videoRef.current;\n        const activeAudio = ownerAudioRef.current;\n        if (activeVideo) {\n          try { activeVideo.currentTime = 0; } catch {}\n          void activeVideo.play().catch(() => undefined);\n        }\n        if (room.is_owner && activeAudio) {\n          try { activeAudio.currentTime = 0; } catch {}\n          void activeAudio.play().catch(() => undefined);\n        }\n      }, 250);\n    }`;
  if (!source.includes(oldEffect)) throw new Error('C-Party playlist autoplay V1 frontend media reload effect not found');
  source = source.replace(oldEffect, newEffect);

  fs.writeFileSync(file, source, 'utf8');
};

patchBackend();
patchFrontend();
console.log('C-Party playlist autoplay V1 applied: manual queue selection and automatic next item start playing immediately.');
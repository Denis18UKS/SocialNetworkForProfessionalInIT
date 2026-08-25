import fs from 'node:fs';

const file = 'src/pages/CinemaPartyRoom.tsx';
let source = fs.readFileSync(file, 'utf8');
const marker = '// SOCIALBIRD_CPARTY_MEDIA_RELOAD_V2: force-participant-source';

if (!source.includes(marker)) {
  const pollingOld = `        if (mediaChanged) {\n          activeMediaKeyRef.current = latestMediaKey;\n          applyingRemoteRef.current = true;\n          try { videoRef.current?.pause(); } catch {}\n          try { ownerAudioRef.current?.pause(); } catch {}\n          window.setTimeout(() => { applyingRemoteRef.current = false; }, 180);\n          return;\n        }`;

  const pollingNew = `        if (mediaChanged) {\n          ${marker}\n          activeMediaKeyRef.current = latestMediaKey;\n          applyingRemoteRef.current = true;\n          const nextStream = \`${'${api}'}/cinema/stream/${'${roomId}'}?${'${invite ? `invite=${encodeURIComponent(invite)}&` : ""}'}media=${'${encodeURIComponent(latestMediaKey)}'}&reload=${'${Date.now()}'}\`;\n          const participantVideo = videoRef.current;\n          if (participantVideo) {\n            try { participantVideo.pause(); } catch {}\n            participantVideo.src = nextStream;\n            participantVideo.load();\n            try { participantVideo.currentTime = 0; } catch {}\n          }\n          const participantAudio = ownerAudioRef.current;\n          if (participantAudio) {\n            try { participantAudio.pause(); } catch {}\n            participantAudio.src = nextStream;\n            participantAudio.load();\n            try { participantAudio.currentTime = 0; } catch {}\n          }\n          window.setTimeout(() => { applyingRemoteRef.current = false; }, 250);\n          return;\n        }`;

  if (!source.includes(pollingOld)) {
    throw new Error('C-Party participant media reload V2 failed: polling media-change block not found');
  }
  source = source.replace(pollingOld, pollingNew);

  const realtimeOld = `      try { videoRef.current?.pause(); } catch {}\n      try { ownerAudioRef.current?.pause(); } catch {}\n      void loadRoom().catch(() => undefined);`;

  const realtimeNew = `      try { videoRef.current?.pause(); } catch {}\n      try { ownerAudioRef.current?.pause(); } catch {}\n      void loadRoom().then((latest) => {\n        const latestMediaKey = String(latest.resolved_media_url || latest.media_url || \"\");\n        activeMediaKeyRef.current = latestMediaKey;\n        const nextStream = \`${'${api}'}/cinema/stream/${'${roomId}'}?${'${inviteFromUrl ? `invite=${encodeURIComponent(inviteFromUrl)}&` : ""}'}media=${'${encodeURIComponent(latestMediaKey)}'}&reload=${'${Date.now()}'}\`;\n        const participantVideo = videoRef.current;\n        if (participantVideo) {\n          participantVideo.src = nextStream;\n          participantVideo.load();\n          try { participantVideo.currentTime = 0; } catch {}\n        }\n        const participantAudio = ownerAudioRef.current;\n        if (participantAudio) {\n          participantAudio.src = nextStream;\n          participantAudio.load();\n          try { participantAudio.currentTime = 0; } catch {}\n        }\n      }).catch(() => undefined);`;

  if (!source.includes(realtimeOld)) {
    throw new Error('C-Party participant media reload V2 failed: realtime media-change block not found');
  }
  source = source.replace(realtimeOld, realtimeNew);

  if (!source.includes(marker) || !source.includes('&reload=${Date.now()}')) {
    throw new Error('C-Party participant media reload V2 verification failed');
  }

  fs.writeFileSync(file, source, 'utf8');
}

console.log('C-Party participant media reload V2 applied: realtime and polling both force a fresh media URL, load(), pause and 00:00.');

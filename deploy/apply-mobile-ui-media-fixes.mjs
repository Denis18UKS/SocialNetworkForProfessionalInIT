import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const patchFile = (relativePath, transform) => {
  const filePath = path.join(root, relativePath);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    console.log(`Applied mobile UI/media fix: ${relativePath}`);
  } else {
    console.log(`Mobile UI/media fix already current: ${relativePath}`);
  }
};

const replaceRequired = (source, label, from, to) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Mobile UI/media fix failed: ${label}`);
  return source.replace(from, to);
};

const replaceAllLiteral = (source, from, to) => source.split(from).join(to);

patchFile('src/lib/call-media-bus.ts', (input) => {
  let source = input;
  if (source.includes('MOBILE_UI_MEDIA_FIX: dedupe-video-per-source')) return source;

  source = replaceRequired(
    source,
    'remote video candidate map',
    'const remoteVideos = new Map<string, CallVideoEntry>();\nconst listeners = new Set<Listener>();',
    `// MOBILE_UI_MEDIA_FIX: dedupe-video-per-source\n// Keep every live candidate internally, but expose only one visible video per\n// user/kind. Re-negotiations on mobile can produce multiple live track ids for the\n// same camera; those must not become duplicate tiles.\nconst remoteVideoCandidates = new Map<string, Map<string, CallVideoEntry>>();\nconst listeners = new Set<Listener>();\n\nconst getVisibleRemoteVideos = (): CallVideoEntry[] => {\n  const visible: CallVideoEntry[] = [];\n  remoteVideoCandidates.forEach((candidates) => {\n    const live = Array.from(candidates.values()).filter((entry) => entry.track.readyState === "live");\n    if (live.length > 0) visible.push(live[live.length - 1]);\n  });\n  return visible;\n};`,
  );

  source = replaceRequired(
    source,
    'snapshot remote videos',
    '  remoteVideos: Array.from(remoteVideos.values()).filter((entry) => entry.track.readyState === "live"),',
    '  remoteVideos: getVisibleRemoteVideos(),',
  );

  const oldPublish = `export const publishRemoteVideo = (userId: number, track: MediaStreamTrack, kind: CallVideoKind = "camera") => {\n  if (!track || track.kind !== "video") return;\n  const key = \`\${kind}:\${Number(userId)}:\${track.id}\`;\n  remoteVideos.set(key, { key, userId: Number(userId), kind, track });\n  const remove = () => {\n    remoteVideos.delete(key);\n    emit();\n  };\n  track.addEventListener("ended", remove, { once: true });\n  emit();\n};`;
  const newPublish = `export const publishRemoteVideo = (userId: number, track: MediaStreamTrack, kind: CallVideoKind = "camera") => {\n  if (!track || track.kind !== "video") return;\n  const normalizedUserId = Number(userId);\n  const sourceKey = \`\${kind}:\${normalizedUserId}\`;\n  let candidates = remoteVideoCandidates.get(sourceKey);\n  if (!candidates) {\n    candidates = new Map<string, CallVideoEntry>();\n    remoteVideoCandidates.set(sourceKey, candidates);\n  }\n\n  // Stable React key per participant/kind; changing WebRTC track ids replaces the\n  // picture instead of adding another copy underneath it.\n  candidates.set(track.id, { key: sourceKey, userId: normalizedUserId, kind, track });\n  const remove = () => {\n    const current = remoteVideoCandidates.get(sourceKey);\n    current?.delete(track.id);\n    if (current && current.size === 0) remoteVideoCandidates.delete(sourceKey);\n    emit();\n  };\n  track.addEventListener("ended", remove, { once: true });\n  emit();\n};`;
  source = replaceRequired(source, 'publish deduped remote video', oldPublish, newPublish);

  const oldRemove = `export const removeRemoteVideoUser = (userId: number) => {\n  const normalized = Number(userId);\n  Array.from(remoteVideos.entries()).forEach(([key, entry]) => {\n    if (entry.userId === normalized) remoteVideos.delete(key);\n  });\n  emit();\n};`;
  const newRemove = `export const removeRemoteVideoUser = (userId: number) => {\n  const normalized = Number(userId);\n  Array.from(remoteVideoCandidates.entries()).forEach(([sourceKey, candidates]) => {\n    if (Array.from(candidates.values()).some((entry) => entry.userId === normalized)) {\n      remoteVideoCandidates.delete(sourceKey);\n    }\n  });\n  emit();\n};`;
  source = replaceRequired(source, 'remove deduped remote user', oldRemove, newRemove);

  source = replaceRequired(
    source,
    'clear deduped media',
    '  remoteVideos.clear();',
    '  remoteVideoCandidates.clear();',
  );

  return source;
});

patchFile('src/components/RealtimeNotifications.tsx', (input) => {
  let source = input;
  if (source.includes('MOBILE_UI_MEDIA_FIX: remote-video-bus-only')) return source;

  if (!source.includes('callMediaSnapshot') || !source.includes('SOCIAL_NEXT: publish-incoming-video')) {
    throw new Error('Mobile UI/media fix requires the social-next call media bus to be applied first');
  }

  source = replaceRequired(
    source,
    'render media bus for incoming and outgoing calls',
    '{activeCall.senderId === 0 && callMediaSnapshot.remoteVideos.map((entry) => (',
    '{callMediaSnapshot.remoteVideos.map((entry) => (',
  );

  source = replaceRequired(
    source,
    'incoming video bus ownership marker',
    `          remoteStream.getVideoTracks().forEach((track) => publishRemoteVideo(sourceUserId, track, 'camera'));\n          const videoRoot = remoteVideoRef.current;`,
    `          remoteStream.getVideoTracks().forEach((track) => publishRemoteVideo(sourceUserId, track, 'camera'));\n          // MOBILE_UI_MEDIA_FIX: remote-video-bus-only\n          // React renders the call-media bus below. Do not also append imperative\n          // <video> elements here, otherwise renegotiations create duplicate tiles.\n          return;\n          const videoRoot = remoteVideoRef.current;`,
  );

  source = replaceAllLiteral(
    source,
    'ref={remoteVideoRef} className="grid w-full min-w-0 grid-cols-1 place-items-center gap-2 sm:grid-cols-2 lg:grid-cols-3"',
    'ref={remoteVideoRef} className="itbird-call-video-grid grid w-full min-w-0 grid-cols-1 place-items-center gap-2 sm:grid-cols-2 lg:grid-cols-3"',
  );
  source = replaceAllLiteral(
    source,
    'ref={remoteVideoRef} className="grid w-full min-w-0 grid-cols-1 place-items-center gap-2 sm:grid-cols-2"',
    'ref={remoteVideoRef} className="itbird-call-video-grid grid w-full min-w-0 grid-cols-1 place-items-center gap-2 sm:grid-cols-2"',
  );
  source = replaceAllLiteral(
    source,
    'className="flex flex-wrap items-center justify-center gap-2 border-t border-white/5 pt-5"',
    'className="itbird-call-controls flex flex-wrap items-center justify-center gap-2 border-t border-white/5 pt-5"',
  );

  const headphones = `              <Button variant="ghost" size="sm" className="rounded-none px-2 text-white hover:bg-white/15 hover:text-white">\n                <Headphones className="h-4 w-4" />\n              </Button>`;
  const functionalHeadphones = `              <Button\n                variant="ghost"\n                size="sm"\n                onClick={toggleSound}\n                aria-pressed={!soundEnabled}\n                title={soundEnabled ? "Отключить звук собеседника" : "Включить звук собеседника"}\n                className={\`rounded-none px-2 hover:bg-white/15 hover:text-white \${soundEnabled ? "text-white" : "bg-red-500/20 text-red-300"}\`}\n              >\n                <Headphones className="h-4 w-4" />\n              </Button>`;
  source = replaceRequired(source, 'incoming headphones deafen button', headphones, functionalHeadphones);

  return source;
});

patchFile('src/components/VoiceCallControls.tsx', (input) => {
  let source = input;
  if (source.includes('MOBILE_UI_MEDIA_FIX: outgoing-headphones')) return source;

  source = replaceAllLiteral(
    source,
    'ref={remoteMediaRef} className="grid w-full min-w-0 grid-cols-1 place-items-center gap-2 sm:grid-cols-2"',
    'ref={remoteMediaRef} className="itbird-call-video-grid grid w-full min-w-0 grid-cols-1 place-items-center gap-2 sm:grid-cols-2"',
  );
  source = replaceAllLiteral(
    source,
    'className="flex flex-wrap items-center justify-center gap-2"',
    'className="itbird-call-controls flex flex-wrap items-center justify-center gap-2"',
  );

  const headphones = `              <Button variant="ghost" size="sm" className="rounded-none px-2 text-white hover:bg-white/15 hover:text-white">\n                <Headphones className="h-4 w-4" />\n              </Button>`;
  const functionalHeadphones = `              {/* MOBILE_UI_MEDIA_FIX: outgoing-headphones */}\n              <Button\n                variant="ghost"\n                size="sm"\n                onClick={toggleSound}\n                aria-pressed={!soundEnabled}\n                title={soundEnabled ? "Отключить звук собеседника" : "Включить звук собеседника"}\n                className={\`rounded-none px-2 hover:bg-white/15 hover:text-white \${soundEnabled ? "text-white" : "bg-red-500/20 text-red-300"}\`}\n              >\n                <Headphones className="h-4 w-4" />\n              </Button>`;
  source = replaceRequired(source, 'outgoing headphones deafen button', headphones, functionalHeadphones);

  return source;
});

const patchChatComposer = (relativePath, isGroup) => {
  patchFile(relativePath, (input) => {
    let source = input;
    if (source.includes('MOBILE_UI_MEDIA_FIX: filename-overflow')) return source;

    if (isGroup) {
      source = replaceAllLiteral(
        source,
        'className="max-w-3xl mx-auto"',
        'className="mx-auto w-full min-w-0 max-w-3xl overflow-hidden"',
      );
      source = replaceAllLiteral(
        source,
        `className={\`max-w-[88%] break-words rounded-lg p-3 sm:max-w-[80%] \${msg.user_id === currentUser?.id`,
        `className={\`min-w-0 max-w-[88%] overflow-hidden break-words rounded-lg p-3 sm:max-w-[80%] \${msg.user_id === currentUser?.id`,
      );
      source = replaceAllLiteral(
        source,
        'className="inline-flex items-center gap-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-1 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"',
        'className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md border border-gray-200 bg-white px-3 py-1 text-gray-800 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"',
      );
      source = replaceAllLiteral(source, '<span>{label}</span>', '<span className="min-w-0 flex-1 truncate">{label}</span>');
    } else {
      source = replaceAllLiteral(
        source,
        'className="mx-auto w-full min-w-0 max-w-3xl"',
        'className="mx-auto w-full min-w-0 max-w-3xl overflow-hidden"',
      );
    }

    source = replaceAllLiteral(
      source,
      'className="flex items-end gap-2"',
      'className="flex w-full min-w-0 max-w-full items-end gap-2 overflow-hidden"',
    );
    source = replaceAllLiteral(
      source,
      'className="cursor-pointer p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"',
      'className="shrink-0 cursor-pointer rounded-full p-2 hover:bg-gray-100 dark:hover:bg-gray-700"',
    );
    source = replaceAllLiteral(
      source,
      'className="bg-[#6E59A5] hover:bg-[#5a4a8a] h-10 w-10 p-0 rounded-full"',
      'className="h-10 w-10 shrink-0 rounded-full bg-[#6E59A5] p-0 hover:bg-[#5a4a8a]"',
    );
    source = replaceAllLiteral(
      source,
      'className="mt-2 flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-md"',
      'className="mt-2 flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md bg-gray-100 p-2 dark:bg-gray-700"',
    );
    source = replaceAllLiteral(
      source,
      'className="text-sm truncate flex-1">{mediaFile.name}</span>',
      'className="min-w-0 flex-1 truncate text-sm">{mediaFile.name}</span>',
    );
    source = replaceAllLiteral(
      source,
      'className="text-sm truncate flex-1">Голосовое сообщение</span>',
      'className="min-w-0 flex-1 truncate text-sm">Голосовое сообщение</span>',
    );
    source = replaceAllLiteral(
      source,
      'className="text-gray-500 hover:text-red-500"',
      'className="shrink-0 text-gray-500 hover:text-red-500"',
    );

    const markerNeedle = '                            {/* Поле ввода сообщения */}';
    if (source.includes(markerNeedle)) {
      source = source.replace(markerNeedle, `                            {/* MOBILE_UI_MEDIA_FIX: filename-overflow */}\n${markerNeedle}`);
    } else {
      source = `// MOBILE_UI_MEDIA_FIX: filename-overflow\n${source}`;
    }
    return source;
  });
};

patchChatComposer('src/pages/Chats.tsx', false);
patchChatComposer('src/pages/GroupChats.tsx', true);

patchFile('src/index.css', (input) => {
  let source = input;
  if (source.includes('MOBILE_UI_MEDIA_FIX: compact-call-stage')) return source;

  source += `\n/* MOBILE_UI_MEDIA_FIX: compact-call-stage */\n.itbird-call-video-grid {\n  min-width: 0;\n  min-height: 0;\n}\n\n.itbird-call-controls {\n  flex-shrink: 0;\n}\n\n.itbird-call-panel:fullscreen {\n  overflow: hidden !important;\n}\n\n.itbird-call-panel:fullscreen .itbird-call-video-grid {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow: auto;\n  align-content: center;\n  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)) !important;\n}\n\n.itbird-call-panel:fullscreen .itbird-call-remote-video {\n  width: 100% !important;\n  max-width: 720px !important;\n  max-height: calc(100dvh - 240px) !important;\n  aspect-ratio: auto !important;\n  object-fit: contain !important;\n}\n\n@media (max-width: 640px) {\n  .itbird-call-panel {\n    max-height: calc(var(--app-viewport-height, 100dvh) - 12px - var(--mobile-visible-bottom, 0px)) !important;\n    overflow-x: hidden !important;\n  }\n\n  .itbird-call-panel .itbird-call-video-grid {\n    width: 100%;\n    max-height: min(43dvh, 390px);\n    overflow-y: auto;\n    overflow-x: hidden;\n    grid-template-columns: minmax(0, 1fr) !important;\n    align-items: center;\n  }\n\n  .itbird-call-panel .itbird-call-remote-video {\n    display: block;\n    width: 100% !important;\n    max-width: 420px !important;\n    max-height: min(38dvh, 350px) !important;\n    height: auto !important;\n    margin-inline: auto;\n    aspect-ratio: auto !important;\n    object-fit: contain !important;\n  }\n\n  .itbird-call-panel .itbird-call-controls {\n    position: sticky;\n    bottom: 0;\n    z-index: 4;\n    width: 100%;\n    margin-top: auto;\n    padding-top: 0.5rem;\n    padding-bottom: max(0.25rem, env(safe-area-inset-bottom, 0px));\n    background: rgb(0 0 0 / 0.94);\n  }\n\n  .itbird-call-panel:fullscreen {\n    left: 0 !important;\n    right: 0 !important;\n    bottom: 0 !important;\n    width: 100vw !important;\n    height: 100dvh !important;\n    max-height: 100dvh !important;\n    border-radius: 0 !important;\n  }\n\n  .itbird-call-panel:fullscreen .itbird-call-video-grid {\n    flex: 1 1 auto;\n    max-height: none;\n  }\n\n  .itbird-call-panel:fullscreen .itbird-call-remote-video {\n    max-height: calc(100dvh - 260px) !important;\n  }\n}\n`;
  return source;
});

console.log('Mobile call UI, video dedupe, deafen and long-filename fixes are current.');

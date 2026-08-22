import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const writeIfChanged = (relativePath, next) => {
  const filePath = path.join(root, relativePath);
  const before = fs.readFileSync(filePath, 'utf8');
  if (before !== next) {
    fs.writeFileSync(filePath, next, 'utf8');
    console.log(`Applied single-camera tile fix: ${relativePath}`);
  } else {
    console.log(`Single-camera tile fix already current: ${relativePath}`);
  }
};

// Canonical media bus: one visible entry per participant + media kind.
// A new WebRTC receiver track replaces the previous camera for that participant
// instead of creating another tile. Screen share remains a separate kind.
const mediaBusPath = 'src/lib/call-media-bus.ts';
const canonicalMediaBus = `export type CallVideoKind = "camera" | "screen";

export type CallVideoEntry = {
  key: string;
  userId: number;
  kind: CallVideoKind;
  track: MediaStreamTrack;
};

type CallMediaSnapshot = {
  localCamera: MediaStreamTrack | null;
  localScreen: MediaStreamTrack | null;
  remoteVideos: CallVideoEntry[];
};

type Listener = (snapshot: CallMediaSnapshot) => void;

let localCamera: MediaStreamTrack | null = null;
let localScreen: MediaStreamTrack | null = null;
// SINGLE_CAMERA_TILE_FIX: one-entry-per-user-kind
const remoteVideos = new Map<string, CallVideoEntry>();
const listeners = new Set<Listener>();

const snapshot = (): CallMediaSnapshot => ({
  localCamera,
  localScreen,
  remoteVideos: Array.from(remoteVideos.values()).filter((entry) => entry.track.readyState === "live"),
});

const emit = () => {
  const current = snapshot();
  listeners.forEach((listener) => listener(current));
};

export const subscribeCallMedia = (listener: Listener) => {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
};

export const publishLocalCamera = (track: MediaStreamTrack | null) => {
  localCamera = track?.readyState === "live" ? track : null;
  emit();
};

export const publishLocalScreen = (track: MediaStreamTrack | null) => {
  localScreen = track?.readyState === "live" ? track : null;
  emit();
};

export const publishRemoteVideo = (userId: number, track: MediaStreamTrack, kind: CallVideoKind = "camera") => {
  if (!track || track.kind !== "video") return;
  const normalizedUserId = Number(userId);
  const key = \`${'${kind}'}:${'${normalizedUserId}'}\`;
  const previous = remoteVideos.get(key);
  if (previous?.track.id === track.id && previous.track.readyState === "live") return;

  remoteVideos.set(key, { key, userId: normalizedUserId, kind, track });

  const remove = () => {
    // An old track may end after a replacement has already been published. Never
    // let the old track remove the newer visible camera entry.
    if (remoteVideos.get(key)?.track.id === track.id) {
      remoteVideos.delete(key);
      emit();
    }
  };
  track.addEventListener("ended", remove, { once: true });
  emit();
};

export const removeRemoteVideoUser = (userId: number) => {
  const normalized = Number(userId);
  Array.from(remoteVideos.entries()).forEach(([key, entry]) => {
    if (entry.userId === normalized) remoteVideos.delete(key);
  });
  emit();
};

export const getCallMediaSnapshot = snapshot;

export const clearCallMedia = () => {
  localCamera = null;
  localScreen = null;
  remoteVideos.clear();
  emit();
};
`;
writeIfChanged(mediaBusPath, canonicalMediaBus);

// Legacy VoiceCallControls still creates DOM media elements directly. Use a stable
// peer+role selector rather than MediaStream.id, because renegotiation can produce a
// fresh MediaStream wrapper for the same camera.
const voicePath = path.join(root, 'src/components/VoiceCallControls.tsx');
let voice = fs.readFileSync(voicePath, 'utf8');
if (!voice.includes('SINGLE_CAMERA_TILE_FIX: stable-peer-role')) {
  const startMarker = 'const attachMediaElement = (container: HTMLElement, peerId: number, stream: MediaStream, muted: boolean) => {';
  const endMarker = '\n\nconst getMediaErrorMessage = (error: unknown) => {';
  const start = voice.indexOf(startMarker);
  const end = voice.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('Single-camera tile fix: attachMediaElement markers not found');

  const replacement = `const attachMediaElement = (container: HTMLElement, peerId: number, stream: MediaStream, muted: boolean) => {\n  // SINGLE_CAMERA_TILE_FIX: stable-peer-role\n  const videoTrack = stream.getVideoTracks().find((track) => track.readyState === "live") || stream.getVideoTracks()[0];\n  const hasVideo = Boolean(videoTrack);\n  const streamId = stream.id || \`peer-\${peerId}-\${hasVideo ? "video" : "audio"}\`;\n  // Camera normally arrives in the user's A/V MediaStream. Screen-share video is\n  // intentionally sent in its own video-only stream by the screen-share v2 patch.\n  const mediaRole = hasVideo ? (stream.getAudioTracks().length > 0 ? "camera" : "screen") : "audio";\n  const selector = hasVideo\n    ? \`video[data-peer-id="\${peerId}"][data-media-role="\${mediaRole}"]\`\n    : \`audio[data-peer-id="\${peerId}"][data-stream-id="\${streamId}"]\`;\n  let media = container.querySelector<HTMLMediaElement>(selector);\n\n  if (hasVideo) {\n    const duplicates = Array.from(container.querySelectorAll<HTMLVideoElement>(\`video[data-peer-id="\${peerId}"][data-media-role="\${mediaRole}"]\`));\n    if (!media && duplicates.length > 0) media = duplicates[0];\n    duplicates.slice(1).forEach((element) => { element.srcObject = null; element.remove(); });\n  }\n\n  if (!media) {\n    media = document.createElement(hasVideo ? "video" : "audio");\n    media.dataset.peerId = String(peerId);\n    media.dataset.streamId = streamId;\n    media.dataset.mediaRole = mediaRole;\n    media.autoplay = true;\n    if (hasVideo) {\n      (media as HTMLVideoElement).playsInline = true;\n      media.className = "itbird-call-remote-video rounded-lg bg-black object-cover shadow-xl";\n    } else {\n      media.className = "hidden";\n    }\n    container.appendChild(media);\n  }\n\n  media.dataset.streamId = streamId;\n  media.dataset.mediaRole = mediaRole;\n  media.muted = muted;\n  media.srcObject = hasVideo && videoTrack ? new MediaStream([videoTrack]) : stream;\n  void playRemoteMedia(media);\n  const outputId = readSettings().audioOutputDeviceId;\n  if (outputId && "setSinkId" in media) {\n    (media as HTMLMediaElement & { setSinkId: (sinkId: string) => Promise<void> })\n      .setSinkId(outputId)\n      .catch(() => undefined);\n  }\n  return media;\n};`;
  voice = `${voice.slice(0, start)}${replacement}${voice.slice(end)}`;
  fs.writeFileSync(voicePath, voice, 'utf8');
  console.log('Applied stable peer/role media element dedupe.');
}

// The global call panel should render remote video only from the media bus. Older
// patches also appended imperative <video data-call-media="remote"> elements to the
// same container. Remove those defensively whenever they appear.
const realtimePath = path.join(root, 'src/components/RealtimeNotifications.tsx');
let realtime = fs.readFileSync(realtimePath, 'utf8');
if (realtime.includes('callMediaSnapshot') && !realtime.includes('SINGLE_CAMERA_TILE_FIX: remove-legacy-video-nodes')) {
  const marker = '  useEffect(() => subscribeCallMedia(setCallMediaSnapshot), []);';
  if (!realtime.includes(marker)) throw new Error('Single-camera tile fix: media bus subscription marker not found');
  const effect = `${marker}\n\n  // SINGLE_CAMERA_TILE_FIX: remove-legacy-video-nodes\n  useEffect(() => {\n    const root = remoteVideoRef.current;\n    if (!root) return;\n    const removeLegacy = () => {\n      root.querySelectorAll<HTMLVideoElement>('video[data-call-media="remote"], video[data-call-stream-id]')\n        .forEach((video) => { video.srcObject = null; video.remove(); });\n    };\n    removeLegacy();\n    const observer = new MutationObserver(removeLegacy);\n    observer.observe(root, { childList: true });\n    return () => observer.disconnect();\n  }, [activeCall]);`;
  realtime = realtime.replace(marker, effect);
  fs.writeFileSync(realtimePath, realtime, 'utf8');
  console.log('Applied global legacy video node cleanup.');
}

console.log('Single-camera tile fix is current.');

export type CallVideoKind = "camera" | "screen";

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
  const key = `${kind}:${Number(userId)}:${track.id}`;
  remoteVideos.set(key, { key, userId: Number(userId), kind, track });
  const remove = () => {
    remoteVideos.delete(key);
    emit();
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

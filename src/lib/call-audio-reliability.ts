import { playRemoteMedia, requestCallMedia } from "@/lib/webrtc";

export type SpeakingMonitorOptions = {
  threshold?: number;
  holdMs?: number;
};

const AudioContextClass = () =>
  window.AudioContext ||
  (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

export const createSpeakingMonitor = (
  stream: MediaStream,
  onSpeakingChange: (speaking: boolean) => void,
  options: SpeakingMonitorOptions = {},
) => {
  const track = stream.getAudioTracks()[0];
  const Context = AudioContextClass();
  if (!track || !Context) {
    onSpeakingChange(false);
    return () => undefined;
  }

  const context = new Context();
  const sourceStream = new MediaStream([track]);
  const source = context.createMediaStreamSource(sourceStream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.72;
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  const threshold = options.threshold ?? 0.035;
  const holdMs = options.holdMs ?? 260;
  let lastAboveThreshold = 0;
  let lastState = false;
  let frame = 0;
  let stopped = false;

  const update = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) {
      const normalized = (sample - 128) / 128;
      energy += normalized * normalized;
    }
    const rms = Math.sqrt(energy / samples.length);
    const now = performance.now();
    const live = track.readyState === "live" && track.enabled && !track.muted;
    if (live && rms >= threshold) lastAboveThreshold = now;
    const nextState = live && now - lastAboveThreshold <= holdMs;
    if (nextState !== lastState) {
      lastState = nextState;
      onSpeakingChange(nextState);
    }
    frame = window.requestAnimationFrame(update);
  };

  void context.resume().catch(() => undefined);
  frame = window.requestAnimationFrame(update);

  const forceSilent = () => {
    if (lastState) {
      lastState = false;
      onSpeakingChange(false);
    }
  };
  track.addEventListener("ended", forceSilent);
  track.addEventListener("mute", forceSilent);

  return () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
    track.removeEventListener("ended", forceSilent);
    track.removeEventListener("mute", forceSilent);
    try { source.disconnect(); } catch {}
    try { analyser.disconnect(); } catch {}
    void context.close().catch(() => undefined);
    onSpeakingChange(false);
  };
};

type PersistentAudioOptions = {
  root: HTMLElement;
  key: string;
  track: MediaStreamTrack;
  muted: boolean;
  outputDeviceId?: string;
  onPlaybackBlocked?: (blocked: boolean) => void;
};

export const attachPersistentAudioTrack = ({
  root,
  key,
  track,
  muted,
  outputDeviceId,
  onPlaybackBlocked,
}: PersistentAudioOptions) => {
  let media = Array.from(root.querySelectorAll<HTMLAudioElement>("audio[data-call-audio-key]"))
    .find((element) => element.dataset.callAudioKey === key);

  if (!media) {
    media = document.createElement("audio");
    media.dataset.callAudioKey = key;
    media.autoplay = true;
    media.preload = "auto";
    media.controls = false;
    media.className = "hidden";
    root.appendChild(media);
  }

  media.muted = muted;
  media.volume = 1;
  const currentStream = media.srcObject instanceof MediaStream ? media.srcObject : null;
  const currentTrack = currentStream?.getAudioTracks()[0];
  if (currentTrack?.id !== track.id) {
    media.srcObject = new MediaStream([track]);
  }

  if (outputDeviceId && "setSinkId" in media) {
    (media as HTMLAudioElement & { setSinkId: (sinkId: string) => Promise<void> })
      .setSinkId(outputDeviceId)
      .catch(() => undefined);
  }

  let disposed = false;
  let retrying = false;

  const ensurePlaying = async () => {
    if (disposed || media!.muted || track.readyState !== "live") return true;
    if (retrying) return !media!.paused;
    retrying = true;
    const playing = await playRemoteMedia(media!);
    retrying = false;
    onPlaybackBlocked?.(!playing);
    return playing;
  };

  const resume = () => { void ensurePlaying(); };
  const resumeWhenVisible = () => {
    if (document.visibilityState === "visible") resume();
  };

  media.addEventListener("loadedmetadata", resume);
  media.addEventListener("canplay", resume);
  track.addEventListener("unmute", resume);
  document.addEventListener("visibilitychange", resumeWhenVisible);
  window.addEventListener("focus", resume);
  window.addEventListener("pageshow", resume);
  window.addEventListener("pointerdown", resume, { passive: true });
  window.addEventListener("touchend", resume, { passive: true });

  const timer = window.setInterval(() => {
    if (!media!.muted && (media!.paused || media!.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)) {
      resume();
    }
  }, 1200);

  void ensurePlaying();

  return {
    media,
    ensurePlaying,
    dispose: () => {
      disposed = true;
      window.clearInterval(timer);
      media!.removeEventListener("loadedmetadata", resume);
      media!.removeEventListener("canplay", resume);
      track.removeEventListener("unmute", resume);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("touchend", resume);
      media!.srcObject = null;
      media!.remove();
    },
  };
};

export const watchPeerConnection = (
  peer: RTCPeerConnection,
  onRecover: () => Promise<void> | void,
) => {
  let disconnectedAt = 0;
  let recovering = false;
  let disposed = false;

  const maybeRecover = async () => {
    if (disposed || recovering || peer.signalingState === "closed") return;
    const state = peer.connectionState;
    const iceState = peer.iceConnectionState;
    const failed = state === "failed" || iceState === "failed";
    const disconnected = state === "disconnected" || iceState === "disconnected";

    if (!failed && !disconnected) {
      disconnectedAt = 0;
      return;
    }

    if (disconnected && !failed) {
      if (!disconnectedAt) disconnectedAt = Date.now();
      if (Date.now() - disconnectedAt < 3000) return;
    }

    recovering = true;
    try {
      if (typeof peer.restartIce === "function") peer.restartIce();
      await onRecover();
    } catch {
      // A later watchdog pass will retry if the connection is still unhealthy.
    } finally {
      recovering = false;
      disconnectedAt = Date.now();
    }
  };

  const handleState = () => { void maybeRecover(); };
  peer.addEventListener("connectionstatechange", handleState);
  peer.addEventListener("iceconnectionstatechange", handleState);
  const timer = window.setInterval(() => { void maybeRecover(); }, 1800);

  return () => {
    disposed = true;
    window.clearInterval(timer);
    peer.removeEventListener("connectionstatechange", handleState);
    peer.removeEventListener("iceconnectionstatechange", handleState);
  };
};

export const recoverMicrophoneTrack = async (
  currentStream: MediaStream | null,
  enabled: boolean,
) => {
  const liveTrack = currentStream?.getAudioTracks().find((track) => track.readyState === "live");
  if (liveTrack) {
    liveTrack.enabled = enabled;
    return { stream: currentStream as MediaStream, track: liveTrack, recovered: false };
  }

  const fresh = await requestCallMedia({ video: false });
  const track = fresh.getAudioTracks()[0];
  if (!track) throw new DOMException("Microphone track is unavailable", "NotFoundError");
  track.enabled = enabled;

  const stream = currentStream || new MediaStream();
  for (const oldTrack of stream.getAudioTracks()) {
    stream.removeTrack(oldTrack);
    if (oldTrack.readyState !== "ended") oldTrack.stop();
  }
  stream.addTrack(track);
  return { stream, track, recovered: true };
};

export type ScreenShareCapture = {
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  audioTracks: MediaStreamTrack[];
};

export class ScreenShareUnavailableError extends Error {
  readonly code = "SCREEN_SHARE_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "ScreenShareUnavailableError";
  }
}

type AndroidBridge = {
  requestScreenShare?: () => void;
  stopScreenShare?: () => void;
  isNativeApp?: () => boolean | string;
  getVersion?: () => string;
};

type NativeScreenSession = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  stream: MediaStream | null;
  resolved: boolean;
  stopping: boolean;
  frameBusy: boolean;
  audioContext: AudioContext | null;
  audioDestination: MediaStreamAudioDestinationNode | null;
  audioNextTime: number;
  resolve: (capture: ScreenShareCapture) => void;
  reject: (error: Error) => void;
};

declare global {
  interface Window {
    ITBirdAndroid?: AndroidBridge;
    __itbirdNativeScreenStarted?: (width: number, height: number, fps?: number, audioSupported?: boolean) => void;
    __itbirdNativeScreenFrame?: (dataUrl: string, width?: number, height?: number) => void;
    __itbirdNativeScreenAudio?: (base64Pcm: string, sampleRate?: number, channels?: number) => void;
    __itbirdNativeScreenStopped?: () => void;
    __itbirdNativeScreenError?: (message?: string) => void;
  }
}

let nativeSession: NativeScreenSession | null = null;

const isMobileLike = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || window.matchMedia?.("(pointer: coarse)").matches === true;

export const isNativeAndroidApp = () => {
  const bridge = window.ITBirdAndroid;
  if (!bridge) return false;
  try {
    const reported = bridge.isNativeApp?.();
    if (reported === true || reported === "true") return true;
  } catch {
    // User-agent fallback below.
  }
  return /SocialBIRDAndroid\//i.test(navigator.userAgent);
};

const teardownNativeSession = (stopNative: boolean) => {
  const session = nativeSession;
  if (!session) return;
  session.stopping = true;
  session.stream?.getTracks().forEach((track) => {
    if (track.readyState !== "ended") track.stop();
  });
  if (session.audioContext) {
    void session.audioContext.close().catch(() => undefined);
    session.audioContext = null;
    session.audioDestination = null;
  }
  if (stopNative) {
    try { window.ITBirdAndroid?.stopScreenShare?.(); } catch {}
  }
  nativeSession = null;
};

const ensureNativeCallbacks = () => {
  window.__itbirdNativeScreenStarted = (width, height, fps = 10, audioSupported = false) => {
    const session = nativeSession;
    if (!session || session.resolved) return;

    session.canvas.width = Math.max(2, Math.round(Number(width) || 720));
    session.canvas.height = Math.max(2, Math.round(Number(height) || 1280));
    const canvasStream = session.canvas.captureStream(Math.max(4, Math.min(20, Number(fps) || 10)));
    const videoTrack = canvasStream.getVideoTracks()[0];
    if (!videoTrack) {
      session.reject(new ScreenShareUnavailableError("Android не смог создать видеотрек демонстрации экрана."));
      teardownNativeSession(true);
      return;
    }

    let audioTracks: MediaStreamTrack[] = [];
    if (audioSupported && session.audioDestination && session.audioContext) {
      audioTracks = session.audioDestination.stream.getAudioTracks();
      void session.audioContext.resume().catch(() => undefined);
    } else if (session.audioContext) {
      void session.audioContext.close().catch(() => undefined);
      session.audioContext = null;
      session.audioDestination = null;
    }

    const combined = new MediaStream([videoTrack, ...audioTracks]);
    session.stream = combined;
    session.resolved = true;
    videoTrack.addEventListener("ended", () => {
      if (!session.stopping) teardownNativeSession(true);
    }, { once: true });
    session.resolve({ stream: combined, videoTrack, audioTracks });
  };

  window.__itbirdNativeScreenFrame = (dataUrl, width, height) => {
    const session = nativeSession;
    if (!session || session.frameBusy || !dataUrl) return;
    session.frameBusy = true;

    const image = new Image();
    image.onload = () => {
      try {
        if (width && height && (session.canvas.width !== width || session.canvas.height !== height)) {
          session.canvas.width = Math.max(2, Math.round(width));
          session.canvas.height = Math.max(2, Math.round(height));
        }
        session.context.drawImage(image, 0, 0, session.canvas.width, session.canvas.height);
      } finally {
        session.frameBusy = false;
      }
    };
    image.onerror = () => { session.frameBusy = false; };
    image.src = dataUrl;
  };

  window.__itbirdNativeScreenAudio = (base64Pcm, sampleRate = 48000, channels = 2) => {
    const session = nativeSession;
    const context = session?.audioContext;
    const destination = session?.audioDestination;
    if (!session || !context || !destination || !base64Pcm) return;

    try {
      if (context.state === "suspended") void context.resume().catch(() => undefined);
      const binary = atob(base64Pcm);
      const channelCount = Math.max(1, Math.min(2, Math.round(Number(channels) || 2)));
      const rate = Math.max(8000, Math.min(96000, Math.round(Number(sampleRate) || 48000)));
      const frameCount = Math.floor(binary.length / (2 * channelCount));
      if (frameCount <= 0) return;

      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const view = new DataView(bytes.buffer);
      const buffer = context.createBuffer(channelCount, frameCount, rate);

      for (let channel = 0; channel < channelCount; channel += 1) {
        const output = buffer.getChannelData(channel);
        for (let frame = 0; frame < frameCount; frame += 1) {
          const sampleIndex = (frame * channelCount + channel) * 2;
          output[frame] = view.getInt16(sampleIndex, true) / 32768;
        }
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      const now = context.currentTime;
      if (!Number.isFinite(session.audioNextTime) || session.audioNextTime < now || session.audioNextTime > now + 0.45) {
        session.audioNextTime = now + 0.04;
      }
      source.start(session.audioNextTime);
      session.audioNextTime += frameCount / rate;
    } catch {
      // A later PCM chunk can recover; video sharing continues independently.
    }
  };

  window.__itbirdNativeScreenStopped = () => {
    const session = nativeSession;
    if (!session) return;
    const wasResolved = session.resolved;
    if (!wasResolved) session.reject(new DOMException("Screen capture was cancelled", "NotAllowedError"));
    teardownNativeSession(false);
  };

  window.__itbirdNativeScreenError = (message) => {
    const session = nativeSession;
    if (!session) return;
    if (!session.resolved) {
      session.reject(new ScreenShareUnavailableError(message || "Android не смог начать демонстрацию экрана."));
    }
    teardownNativeSession(false);
  };
};

const requestNativeAndroidScreenShare = async (): Promise<ScreenShareCapture> => {
  const bridge = window.ITBirdAndroid;
  if (!bridge?.requestScreenShare) {
    throw new ScreenShareUnavailableError("Нативный мост демонстрации экрана Android недоступен.");
  }

  teardownNativeSession(true);
  ensureNativeCallbacks();

  return new Promise<ScreenShareCapture>((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      reject(new ScreenShareUnavailableError("Не удалось создать поверхность демонстрации экрана."));
      return;
    }
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const AudioContextClass = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let audioContext: AudioContext | null = null;
    let audioDestination: MediaStreamAudioDestinationNode | null = null;
    if (AudioContextClass) {
      try {
        audioContext = new AudioContextClass();
        audioDestination = audioContext.createMediaStreamDestination();
        void audioContext.resume().catch(() => undefined);
      } catch {
        audioContext = null;
        audioDestination = null;
      }
    }

    nativeSession = {
      canvas,
      context,
      stream: null,
      resolved: false,
      stopping: false,
      frameBusy: false,
      audioContext,
      audioDestination,
      audioNextTime: 0,
      resolve,
      reject,
    };

    try {
      bridge.requestScreenShare?.();
    } catch (error) {
      if (audioContext) void audioContext.close().catch(() => undefined);
      nativeSession = null;
      reject(error instanceof Error ? error : new Error("Android screen-share bridge failed"));
    }
  });
};

export const getScreenShareAvailability = () => {
  if (isNativeAndroidApp() && typeof window.ITBirdAndroid?.requestScreenShare === "function") {
    return { supported: true, mobile: true, native: true, reason: "" };
  }

  if (!window.isSecureContext) {
    return {
      supported: false,
      mobile: isMobileLike(),
      native: false,
      reason: "Демонстрация экрана доступна только через HTTPS.",
    };
  }

  const supported = typeof navigator.mediaDevices?.getDisplayMedia === "function";
  if (!supported) {
    return {
      supported: false,
      mobile: isMobileLike(),
      native: false,
      reason: isMobileLike()
        ? "Этот мобильный браузер не предоставляет веб-сайту доступ к трансляции экрана. Установите отдельное Android-приложение SocialBIRD из раздела «Приложение Android» — оно использует системный MediaProjection."
        : "Этот браузер не поддерживает демонстрацию экрана через WebRTC.",
    };
  }

  return { supported: true, mobile: isMobileLike(), native: false, reason: "" };
};

export const requestScreenShare = async (): Promise<ScreenShareCapture> => {
  if (isNativeAndroidApp()) {
    return requestNativeAndroidScreenShare();
  }

  const availability = getScreenShareAvailability();
  if (!availability.supported) {
    throw new ScreenShareUnavailableError(availability.reason);
  }

  const options = {
    video: {
      frameRate: { ideal: 24, max: 30 },
    },
    audio: true,
    systemAudio: "include",
    surfaceSwitching: "include",
  } as DisplayMediaStreamOptions & {
    systemAudio?: "include" | "exclude";
    surfaceSwitching?: "include" | "exclude";
  };

  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new DOMException("Screen video track is unavailable", "NotFoundError");
  }

  const audioTracks = stream.getAudioTracks();
  audioTracks.forEach((track) => {
    track.enabled = true;
  });

  return { stream, videoTrack, audioTracks };
};

export const getScreenShareErrorMessage = (error: unknown) => {
  if (error instanceof ScreenShareUnavailableError) return error.message;

  if (error instanceof DOMException && ["NotAllowedError", "PermissionDeniedError"].includes(error.name)) {
    return isNativeAndroidApp()
      ? "Android не разрешил демонстрацию экрана. Подтвердите системное окно MediaProjection и повторите попытку."
      : "Браузер не разрешил демонстрацию экрана. Разрешите захват экрана и повторите попытку.";
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "Не удалось получить изображение экрана для трансляции.";
  }

  return "Не удалось начать демонстрацию экрана.";
};

export const getMissingScreenAudioMessage = () =>
  isNativeAndroidApp()
    ? "Экран Android транслируется, но это устройство/приложение не разрешило захват системного аудио. На Android 10+ SocialBIRD пытается захватывать разрешённый медиазвук через AudioPlaybackCapture; микрофон звонка при этом работает отдельно."
    : "Экран транслируется, но браузер не передал системный звук. В Chrome/Edge выберите вкладку/экран с доступным звуком и включите «Поделиться аудио» / «Share audio». В браузерах без захвата системного аудио демонстрация продолжит работать без звука.";

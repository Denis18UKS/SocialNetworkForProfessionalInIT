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
  resolve: (capture: ScreenShareCapture) => void;
  reject: (error: Error) => void;
};

declare global {
  interface Window {
    ITBirdAndroid?: AndroidBridge;
    __itbirdNativeScreenStarted?: (width: number, height: number, fps?: number) => void;
    __itbirdNativeScreenFrame?: (dataUrl: string, width?: number, height?: number) => void;
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
  if (stopNative) {
    try { window.ITBirdAndroid?.stopScreenShare?.(); } catch {}
  }
  nativeSession = null;
};

const ensureNativeCallbacks = () => {
  window.__itbirdNativeScreenStarted = (width, height, fps = 10) => {
    const session = nativeSession;
    if (!session || session.resolved) return;

    session.canvas.width = Math.max(2, Math.round(Number(width) || 720));
    session.canvas.height = Math.max(2, Math.round(Number(height) || 1280));
    const captureStream = session.canvas.captureStream(Math.max(4, Math.min(20, Number(fps) || 10)));
    const videoTrack = captureStream.getVideoTracks()[0];
    if (!videoTrack) {
      session.reject(new ScreenShareUnavailableError("Android не смог создать видеотрек демонстрации экрана."));
      teardownNativeSession(true);
      return;
    }

    session.stream = captureStream;
    session.resolved = true;
    videoTrack.addEventListener("ended", () => {
      if (!session.stopping) teardownNativeSession(true);
    }, { once: true });
    session.resolve({ stream: captureStream, videoTrack, audioTracks: [] });
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

    nativeSession = {
      canvas,
      context,
      stream: null,
      resolved: false,
      stopping: false,
      frameBusy: false,
      resolve,
      reject,
    };

    try {
      bridge.requestScreenShare?.();
    } catch (error) {
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
    ? "Экран Android транслируется. В первой версии нативного MediaProjection-моста системный звук Android в звонок не захватывается; микрофон звонка продолжает работать отдельно."
    : "Экран транслируется, но браузер не передал системный звук. В Chrome/Edge выберите вкладку/экран с доступным звуком и включите «Поделиться аудио» / «Share audio». В браузерах без захвата системного аудио демонстрация продолжит работать без звука.";

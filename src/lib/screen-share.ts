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

const isMobileLike = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || window.matchMedia?.("(pointer: coarse)").matches === true;

export const getScreenShareAvailability = () => {
  if (!window.isSecureContext) {
    return {
      supported: false,
      mobile: isMobileLike(),
      reason: "Демонстрация экрана доступна только через HTTPS.",
    };
  }

  const supported = typeof navigator.mediaDevices?.getDisplayMedia === "function";
  if (!supported) {
    return {
      supported: false,
      mobile: isMobileLike(),
      reason: isMobileLike()
        ? "Этот мобильный браузер не предоставляет веб-сайту доступ к трансляции экрана. На Android/iPhone для настоящей демонстрации экрана нужен нативный клиент SocialBIRD; установка сайта как PWA сама по себе это ограничение браузера не снимает."
        : "Этот браузер не поддерживает демонстрацию экрана через WebRTC.",
    };
  }

  return { supported: true, mobile: isMobileLike(), reason: "" };
};

export const requestScreenShare = async (): Promise<ScreenShareCapture> => {
  const availability = getScreenShareAvailability();
  if (!availability.supported) {
    throw new ScreenShareUnavailableError(availability.reason);
  }

  const options = {
    video: {
      frameRate: { ideal: 24, max: 30 },
    },
    audio: true,
    // Chromium understands these hints and ignores unknown members elsewhere.
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
    return "Браузер не разрешил демонстрацию экрана. Разрешите захват экрана и повторите попытку.";
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "Браузер не вернул изображение экрана для трансляции.";
  }

  return "Не удалось начать демонстрацию экрана.";
};

export const getMissingScreenAudioMessage = () =>
  "Экран транслируется, но браузер не передал системный звук. В Chrome/Edge выберите вкладку/экран с доступным звуком и включите «Поделиться аудио» / «Share audio». В браузерах без захвата системного аудио демонстрация продолжит работать без звука.";

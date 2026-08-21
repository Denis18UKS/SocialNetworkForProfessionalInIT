import { readSettings } from "@/lib/settings";

const splitUrls = (value?: string) =>
  String(value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

const isMobileLike = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || window.matchMedia?.("(pointer: coarse)").matches === true;

export const getIceServers = (): RTCIceServer[] => {
  const stunUrls = splitUrls(import.meta.env.VITE_STUN_URLS);
  const turnUrls = splitUrls(import.meta.env.VITE_TURN_URLS);

  const servers: RTCIceServer[] = [
    {
      urls: stunUrls.length > 0
        ? stunUrls
        : ["stun:stun.l.google.com:19302"],
    },
  ];

  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
};

export const getPeerConnectionConfig = (): RTCConfiguration => ({
  iceServers: getIceServers(),
  iceCandidatePoolSize: 4,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
});

const buildAudioConstraints = (deviceId?: string): MediaTrackConstraints => {
  const settings = readSettings();
  const processingEnabled = isMobileLike() || settings.noiseSuppressionMode === "krisp";

  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: processingEnabled,
    noiseSuppression: processingEnabled,
    autoGainControl: processingEnabled,
  };
};

const buildVideoConstraints = (deviceId?: string): MediaTrackConstraints => ({
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
});

const shouldRetryWithDefaultDevice = (error: unknown) =>
  error instanceof DOMException
  && ["OverconstrainedError", "NotFoundError", "DevicesNotFoundError"].includes(error.name);

export const requestCallMedia = async ({ video }: { video: boolean }) => {
  const settings = readSettings();

  const request = async (preferSavedDevices: boolean) => navigator.mediaDevices.getUserMedia({
    audio: buildAudioConstraints(preferSavedDevices ? settings.microphoneDeviceId : undefined),
    video: video
      ? buildVideoConstraints(preferSavedDevices ? settings.cameraDeviceId : undefined)
      : false,
  });

  let stream: MediaStream;
  try {
    stream = await request(true);
  } catch (error) {
    const hasSavedDevice = Boolean(settings.microphoneDeviceId || (video && settings.cameraDeviceId));
    if (!hasSavedDevice || !shouldRetryWithDefaultDevice(error)) throw error;
    stream = await request(false);
  }

  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack || audioTrack.readyState !== "live") {
    stream.getTracks().forEach((track) => track.stop());
    throw new DOMException("Microphone track is unavailable", "NotFoundError");
  }
  audioTrack.enabled = true;

  return stream;
};

export const requestCameraTrack = async () => {
  const settings = readSettings();

  const request = async (deviceId?: string) => navigator.mediaDevices.getUserMedia({
    video: buildVideoConstraints(deviceId),
    audio: false,
  });

  let stream: MediaStream;
  try {
    stream = await request(settings.cameraDeviceId);
  } catch (error) {
    if (!settings.cameraDeviceId || !shouldRetryWithDefaultDevice(error)) throw error;
    stream = await request();
  }

  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== "live") {
    stream.getTracks().forEach((item) => item.stop());
    throw new DOMException("Camera track is unavailable", "NotFoundError");
  }
  track.enabled = true;
  return { stream, track };
};

export const playRemoteMedia = async (media: HTMLMediaElement) => {
  try {
    await media.play();
    return true;
  } catch {
    return false;
  }
};
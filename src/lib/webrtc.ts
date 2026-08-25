import { readSettings } from "@/lib/settings";

export type CameraFacingMode = "user" | "environment";

export type CameraRequestOptions = {
  facingMode?: CameraFacingMode;
  deviceId?: string;
};

const splitUrls = (value?: string) =>
  String(value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

export const isMobileCallDevice = () =>
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
  const processingEnabled = isMobileCallDevice() || settings.noiseSuppressionMode === "krisp";

  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: processingEnabled,
    noiseSuppression: processingEnabled,
    autoGainControl: processingEnabled,
    channelCount: { ideal: 1 },
  };
};

const buildVideoConstraints = ({ facingMode, deviceId }: CameraRequestOptions = {}): MediaTrackConstraints => ({
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  ...(!deviceId && facingMode ? { facingMode: { ideal: facingMode } } : {}),
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
});

const shouldRetryWithDefaultDevice = (error: unknown) =>
  error instanceof DOMException
  && ["OverconstrainedError", "NotFoundError", "DevicesNotFoundError"].includes(error.name);

const liveAudioTrack = (stream: MediaStream) =>
  stream.getAudioTracks().find((track) => track.readyState === "live");

const liveVideoTrack = (stream: MediaStream) =>
  stream.getVideoTracks().find((track) => track.readyState === "live");

export const requestCallMedia = async ({
  video,
  facingMode,
}: {
  video: boolean;
  facingMode?: CameraFacingMode;
}) => {
  const settings = readSettings();
  const mobileFacing = video && isMobileCallDevice() ? (facingMode || "user") : facingMode;

  const request = async (preferSavedDevices: boolean) => navigator.mediaDevices.getUserMedia({
    audio: buildAudioConstraints(preferSavedDevices ? settings.microphoneDeviceId : undefined),
    video: video
      ? buildVideoConstraints({
          deviceId: preferSavedDevices && !mobileFacing ? settings.cameraDeviceId : undefined,
          facingMode: mobileFacing,
        })
      : false,
  });

  let stream: MediaStream;
  try {
    stream = await request(true);
  } catch (error) {
    const hasSavedDevice = Boolean(settings.microphoneDeviceId || (video && settings.cameraDeviceId));
    if (!hasSavedDevice && !mobileFacing) throw error;
    if (!shouldRetryWithDefaultDevice(error)) throw error;
    stream = await request(false);
  }

  const audioTrack = liveAudioTrack(stream);
  if (!audioTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new DOMException("Microphone track is unavailable", "NotFoundError");
  }
  audioTrack.enabled = true;

  if (video) {
    const videoTrack = liveVideoTrack(stream);
    if (!videoTrack) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException("Camera track is unavailable", "NotFoundError");
    }
    videoTrack.enabled = true;
  }

  return stream;
};

export const requestCameraTrack = async (options: CameraRequestOptions = {}) => {
  const settings = readSettings();
  const mobileFacing = isMobileCallDevice() ? (options.facingMode || "user") : options.facingMode;
  const preferredDeviceId = options.deviceId
    || (!mobileFacing ? settings.cameraDeviceId : undefined);

  const request = async (constraints: CameraRequestOptions) => navigator.mediaDevices.getUserMedia({
    video: buildVideoConstraints(constraints),
    audio: false,
  });

  let stream: MediaStream;
  try {
    stream = await request({ deviceId: preferredDeviceId, facingMode: mobileFacing });
  } catch (error) {
    if (!shouldRetryWithDefaultDevice(error)) throw error;
    stream = await request({ facingMode: mobileFacing });
  }

  const track = liveVideoTrack(stream);
  if (!track) {
    stream.getTracks().forEach((item) => item.stop());
    throw new DOMException("Camera track is unavailable", "NotFoundError");
  }
  track.enabled = true;
  return { stream, track };
};

export const listVideoInputs = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) return [] as MediaDeviceInfo[];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
};

export const playRemoteMedia = async (media: HTMLMediaElement) => {
  try {
    await media.play();
    return true;
  } catch {
    return false;
  }
};

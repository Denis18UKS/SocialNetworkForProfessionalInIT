import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { jwtDecode } from "jwt-decode";
import { toast } from "sonner";
import { useAuth } from "@/pages/AuthContext";
import { createReconnectingWebSocket } from "@/lib/reconnecting-websocket";
import { getWsUrl, readSettings } from "@/lib/settings";
import {
  getPeerConnectionConfig,
  isMobileCallDevice,
  listVideoInputs,
  playRemoteMedia,
  requestCallMedia,
  requestCameraTrack,
  type CameraFacingMode,
} from "@/lib/webrtc";
import {
  attachPersistentAudioTrack,
  createSpeakingMonitor,
  recoverMicrophoneTrack,
  watchPeerConnection,
} from "@/lib/call-audio-reliability";
import {
  getScreenShareErrorMessage,
  requestScreenShare,
  type ScreenShareCapture,
} from "@/lib/screen-share";

export type CallMode = "private" | "group";
export type CallKind = "voice" | "video";
export type CallPhase = "calling" | "ringing" | "connecting" | "active";

export type CallParticipant = {
  id: number;
  username: string;
  avatar?: string | null;
};

export type RemoteCallMedia = {
  camera?: MediaStream;
  screen?: MediaStream;
};

export type CallSnapshot = {
  callId: string;
  direction: "outgoing" | "incoming";
  phase: CallPhase;
  chatId: number | string;
  mode: CallMode;
  title: string;
  callKind: CallKind;
  initiatorId: number;
  targetIds: number[];
  participants: CallParticipant[];
  micEnabled: boolean;
  soundEnabled: boolean;
  cameraEnabled: boolean;
  screenEnabled: boolean;
  speakerEnabled: boolean;
  cameraFacing: CameraFacingMode;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
};

type CallSignal = {
  senderId: number;
  targetIds?: number[];
  callId?: string;
  initiatorId?: number;
  chatId: number | string;
  mode: CallMode;
  title?: string;
  callKind?: CallKind;
  callerName?: string;
  participants?: CallParticipant[];
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  transportId?: string;
  endForAll?: boolean;
  participantLeft?: boolean;
  screenStreamId?: string;
  cameraEnabled?: boolean;
  cameraFacing?: CameraFacingMode;
};

type StartCallInput = {
  mode: CallMode;
  chatId: number | string;
  title: string;
  participants: CallParticipant[];
  targetIds: number[];
  kind: CallKind;
};

type PeerBundle = {
  peerId: number;
  pc: RTCPeerConnection;
  cameraSender: RTCRtpSender | null;
  screenSender: RTCRtpSender | null;
  screenAudioSenders: RTCRtpSender[];
  watchdogStop: () => void;
};

type CameraAuxTransport = {
  peerId: number;
  transportId: string;
  pc: RTCPeerConnection;
  sender: RTCRtpSender | null;
};

type AudioBinding = ReturnType<typeof attachPersistentAudioTrack>;

type NativeCallBridge = {
  setSpeakerphone?: (enabled: boolean) => void;
  enterPictureInPicture?: () => void;
};

type NativeCallAction = {
  action?: "answer" | "open" | "decline";
  call?: Partial<CallSignal> | null;
};

type CallManagerContextValue = {
  call: CallSnapshot | null;
  incoming: CallSignal | null;
  remoteMedia: Record<number, RemoteCallMedia>;
  speakingUserIds: number[];
  participantVolumes: Record<number, number>;
  setParticipantVolume: (userId: number, volume: number) => void;
  currentUserId: number | null;
  isMobile: boolean;
  startCall: (input: StartCallInput) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  declineIncoming: () => void;
  hangup: () => void;
  toggleMic: () => void;
  toggleSound: () => void;
  toggleCamera: () => Promise<void>;
  switchCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  toggleSpeaker: () => void;
  enterPictureInPicture: () => void;
  forceRemoteAudioPlayback: () => Promise<void>;
};

const CallManagerContext = createContext<CallManagerContextValue | null>(null);

const createCallId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

const dedupeParticipants = (participants: CallParticipant[]) => {
  const seen = new Set<number>();
  return participants.filter((participant) => {
    const id = Number(participant.id);
    if (!Number.isFinite(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const parseNativeCall = (value: unknown): Partial<CallSignal> | null => {
  if (!value) return null;
  if (typeof value === "object") return value as Partial<CallSignal>;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as Partial<CallSignal>;
  } catch {
    return null;
  }
};

// SOCIALBIRD_CALL_SYSTEM_V5: participant-volume-storage
const participantVolumeKey = (userId: number) => `socialbird:call-volume:${userId}`;
const readParticipantVolume = (userId: number) => {
  try {
    const raw = localStorage.getItem(participantVolumeKey(userId));
    if (raw === null || raw.trim() === "") return 1;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  } catch { return 1; }
};
const writeParticipantVolume = (userId: number, volume: number) => {
  try { localStorage.setItem(participantVolumeKey(userId), String(volume)); } catch {}
};

const setWindowCallState = (state: CallSnapshot | null) => {
  const callWindow = window as typeof window & {
    __itbirdActiveCallState?: CallSnapshot | null;
    __socialbirdCallManagerV4?: boolean;
  };
  callWindow.__socialbirdCallManagerV4 = true;
  callWindow.__itbirdActiveCallState = state;
  window.dispatchEvent(new CustomEvent("itbird-call-state", { detail: state }));
};

export const CallProvider = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useAuth();
  const [call, setCall] = useState<CallSnapshot | null>(null);
  const [incoming, setIncoming] = useState<CallSignal | null>(null);
  const [remoteMedia, setRemoteMedia] = useState<Record<number, RemoteCallMedia>>({});
  const [speakingUserIds, setSpeakingUserIds] = useState<number[]>([]);
  const [participantVolumes, setParticipantVolumes] = useState<Record<number, number>>({});

  const callRef = useRef<CallSnapshot | null>(null);
  const incomingRef = useRef<CallSignal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenCaptureRef = useRef<ScreenShareCapture | null>(null);
  const peersRef = useRef<Record<number, PeerBundle>>({});
  const pendingOffersRef = useRef<Record<number, CallSignal>>({});
  const pendingIceRef = useRef<Record<number, RTCIceCandidateInit[]>>({});
  const expectedScreenStreamRef = useRef<Record<number, string>>({});
  const remoteStreamByIdRef = useRef<Record<string, { peerId: number; stream: MediaStream }>>({});
  const audioBindingsRef = useRef<Record<string, AudioBinding>>({});
  const participantVolumesRef = useRef<Record<number, number>>({});
  const cameraResyncTimersRef = useRef<Record<number, number>>({});
  // SOCIALBIRD_CALL_SYSTEM_V7: receiver-reconciliation
  const remoteCameraExpectedRef = useRef<Record<number, boolean>>({});
  const remoteVideoTrackStreamsRef = useRef<Record<string, MediaStream>>({});
  const remoteVideoResyncAtRef = useRef<Record<number, number>>({});
  // SOCIALBIRD_CALL_SYSTEM_V8: dedicated-camera-transport
  const cameraAuxOutgoingRef = useRef<Record<number, CameraAuxTransport>>({});
  const cameraAuxIncomingRef = useRef<Record<string, CameraAuxTransport>>({});
  const cameraAuxPendingIceRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const speakingStopsRef = useRef<Record<string, () => void>>({});
  const audioRootRef = useRef<HTMLDivElement | null>(null);
  const autoAnswerRef = useRef(false);
  // SOCIALBIRD_CALL_SYSTEM_V5: pending-push-answer
  const pendingPushAnswerRef = useRef(false);
  const socketReadyRef = useRef(false);
  const acceptedConnectTimerRef = useRef<number | null>(null);
  // SOCIALBIRD_CALL_SYSTEM_V4: accept-transition-lock
  const acceptingRef = useRef(false);
  const startingRef = useRef(false);
  const ringtoneContextRef = useRef<AudioContext | null>(null);
  const ringtoneTimerRef = useRef<number | null>(null);
  const currentUserIdRef = useRef<number | null>(null);
  const currentUsernameRef = useRef("Вы");
  const isMobile = isMobileCallDevice();

  // SOCIALBIRD_CALL_SYSTEM_V5: cold-start-auth-independent
  const token = localStorage.getItem("token") || "";

  useEffect(() => {
    callRef.current = call;
    setWindowCallState(call);
  }, [call]);

  useEffect(() => {
    incomingRef.current = incoming;
  }, [incoming]);

  // SOCIALBIRD_CALL_SYSTEM_V5: volume-ref-sync
  useEffect(() => { participantVolumesRef.current = participantVolumes; }, [participantVolumes]);

  useEffect(() => {
    if (!token) {
      currentUserIdRef.current = null;
      return;
    }
    try {
      const decoded = jwtDecode<{ id: number; username?: string }>(token);
      currentUserIdRef.current = Number(decoded.id) || null;
      currentUsernameRef.current = decoded.username || "Вы";
    } catch {
      currentUserIdRef.current = null;
    }
  }, [token]);

  const stopRingtone = useCallback(() => {
    if (ringtoneTimerRef.current !== null) {
      window.clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    if (ringtoneContextRef.current) {
      void ringtoneContextRef.current.close().catch(() => undefined);
      ringtoneContextRef.current = null;
    }
  }, []);

  const startRingtone = useCallback(() => {
    stopRingtone();
    const AudioContextClass = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      const context = new AudioContextClass();
      ringtoneContextRef.current = context;
      const pulse = () => {
        if (context.state === "suspended") void context.resume().catch(() => undefined);
        const now = context.currentTime;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.09, now + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
        gain.connect(context.destination);
        [660, 880].forEach((frequency, index) => {
          const oscillator = context.createOscillator();
          oscillator.frequency.value = frequency;
          oscillator.connect(gain);
          oscillator.start(now + index * 0.18);
          oscillator.stop(now + index * 0.18 + 0.16);
        });
      };
      pulse();
      ringtoneTimerRef.current = window.setInterval(pulse, 1350);
    } catch {
      ringtoneContextRef.current = null;
    }
  }, [stopRingtone]);

  const setSpeaking = useCallback((userId: number, speaking: boolean) => {
    if (!Number.isFinite(userId)) return;
    setSpeakingUserIds((current) => {
      if (speaking) return current.includes(userId) ? current : [...current, userId];
      return current.filter((id) => id !== userId);
    });
  }, []);

  const monitorAudioTrack = useCallback((key: string, userId: number, track: MediaStreamTrack) => {
    speakingStopsRef.current[key]?.();
    speakingStopsRef.current[key] = createSpeakingMonitor(
      new MediaStream([track]),
      (speaking) => setSpeaking(userId, speaking),
      { threshold: 0.025, holdMs: 320 },
    );
  }, [setSpeaking]);

  const sendSignal = useCallback((type: string, targetIds: number[], data: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || targetIds.length === 0) return false;
    return socket.send(JSON.stringify({ type, targetIds, data })) === undefined || true;
  }, []);

  const allOtherParticipantIds = useCallback((snapshot: CallSnapshot | null) => {
    if (!snapshot) return [] as number[];
    const selfId = currentUserIdRef.current;
    return Array.from(new Set([
      ...snapshot.targetIds,
      ...snapshot.participants.map((participant) => Number(participant.id)),
      snapshot.initiatorId,
    ]))
      .filter((id) => Number.isFinite(id) && id > 0 && id !== selfId);
  }, []);

  const publishActive = useCallback((snapshot: CallSnapshot) => {
    setCall(snapshot);
    window.dispatchEvent(new CustomEvent("itbird-call-active", { detail: snapshot }));
    // SOCIALBIRD_CALL_SYSTEM_V5: native-state-follows-real-phase
    window.dispatchEvent(new CustomEvent("itbird-native-call-state", {
      detail: { active: snapshot.phase === "active", connecting: snapshot.phase !== "active", phase: snapshot.phase },
    }));
  }, []);

  const stopAllPeerResources = useCallback(() => {
    Object.values(peersRef.current).forEach((bundle) => {
      try { bundle.watchdogStop(); } catch {}
      try { bundle.pc.close(); } catch {}
    });
    peersRef.current = {};
    Object.values(cameraAuxOutgoingRef.current).forEach((transport) => { try { transport.pc.close(); } catch {} });
    Object.values(cameraAuxIncomingRef.current).forEach((transport) => { try { transport.pc.close(); } catch {} });
    cameraAuxOutgoingRef.current = {};
    cameraAuxIncomingRef.current = {};
    cameraAuxPendingIceRef.current = {};
    pendingOffersRef.current = {};
    pendingIceRef.current = {};
    expectedScreenStreamRef.current = {};
    remoteStreamByIdRef.current = {};
    remoteCameraExpectedRef.current = {};
    remoteVideoTrackStreamsRef.current = {};
    remoteVideoResyncAtRef.current = {};
    Object.values(audioBindingsRef.current).forEach((binding) => binding.dispose());
    audioBindingsRef.current = {};
    Object.values(speakingStopsRef.current).forEach((stop) => stop());
    speakingStopsRef.current = {};
    setRemoteMedia({});
    setSpeakingUserIds([]);
  }, []);

  const clearLocalMedia = useCallback(() => {
    screenCaptureRef.current?.stream.getTracks().forEach((track) => {
      if (track.readyState !== "ended") track.stop();
    });
    screenCaptureRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => {
      if (track.readyState !== "ended") track.stop();
    });
    localStreamRef.current = null;
  }, []);

  const finishCallLocally = useCallback((source = "local") => {
    stopRingtone();
    stopAllPeerResources();
    clearLocalMedia();
    setIncoming(null);
    incomingRef.current = null;
    setCall(null);
    callRef.current = null;
    autoAnswerRef.current = false;
    pendingPushAnswerRef.current = false;
    // SOCIALBIRD_CALL_SYSTEM_V5: clear-connect-timeout
    if (acceptedConnectTimerRef.current !== null) {
      window.clearTimeout(acceptedConnectTimerRef.current);
      acceptedConnectTimerRef.current = null;
    }
    setWindowCallState(null);
    window.dispatchEvent(new CustomEvent("itbird-call-ended", { detail: { source } }));
    window.dispatchEvent(new CustomEvent("itbird-native-call-state", { detail: { active: false } }));
  }, [clearLocalMedia, stopAllPeerResources, stopRingtone]);

  const attachRemoteAudio = useCallback((peerId: number, stream: MediaStream, track: MediaStreamTrack) => {
    const root = audioRootRef.current;
    if (!root) return;
    const callState = callRef.current;
    const screenStreamId = expectedScreenStreamRef.current[peerId];
    const isScreenAudio = Boolean(screenStreamId && stream.id === screenStreamId);
    const key = `peer:${peerId}:${track.id}`;
    if (!audioBindingsRef.current[key]) {
      audioBindingsRef.current[key] = attachPersistentAudioTrack({
        root,
        key,
        track,
        muted: callState?.soundEnabled === false,
        outputDeviceId: readSettings().audioOutputDeviceId,
        onPlaybackBlocked: (blocked) => {
          if (blocked && callRef.current?.soundEnabled !== false) {
            window.dispatchEvent(new CustomEvent("itbird-call-audio-blocked"));
          }
        },
      });
    }
    // SOCIALBIRD_CALL_SYSTEM_V5: remote-audio-volume
    const peerVolume = participantVolumesRef.current[peerId] ?? readParticipantVolume(peerId);
    participantVolumesRef.current[peerId] = peerVolume;
    audioBindingsRef.current[key].media.volume = peerVolume;
    setParticipantVolumes((current) => current[peerId] === peerVolume ? current : { ...current, [peerId]: peerVolume });
    if (!isScreenAudio) monitorAudioTrack(`remote:${peerId}:${track.id}`, peerId, track);
  }, [monitorAudioTrack]);

  const classifyRemoteVideo = useCallback((peerId: number, stream: MediaStream) => {
    remoteStreamByIdRef.current[stream.id] = { peerId, stream };
    const expectedScreen = expectedScreenStreamRef.current[peerId];
    setRemoteMedia((current) => {
      const existing = current[peerId] || {};
      if (expectedScreen && stream.id === expectedScreen) {
        return { ...current, [peerId]: { ...existing, screen: stream } };
      }
      return { ...current, [peerId]: { ...existing, camera: stream } };
    });
  }, []);

  const reconcileRemoteVideo = useCallback((peerId: number, pc: RTCPeerConnection) => {
    if (!Number.isFinite(peerId) || peerId <= 0 || pc.signalingState === "closed") return;

    const expectedScreen = expectedScreenStreamRef.current[peerId];
    const cameraExpected = remoteCameraExpectedRef.current[peerId];
    const receivers = pc.getReceivers().filter((receiver) =>
      receiver.track?.kind === "video" && receiver.track.readyState === "live",
    );

    let cameraStream: MediaStream | undefined;
    let screenStream: MediaStream | undefined;

    for (const receiver of receivers) {
      const track = receiver.track;
      if (!track) continue;
      const originalStream = Object.values(remoteStreamByIdRef.current).find((entry) =>
        entry.peerId === peerId && entry.stream.getVideoTracks().some((candidate) => candidate.id === track.id),
      )?.stream;

      if (expectedScreen && originalStream?.id === expectedScreen) {
        screenStream = originalStream;
        continue;
      }

      if (cameraExpected === false || cameraStream) continue;
      const key = "peer:" + peerId + ":" + track.id;
      let dedicated = remoteVideoTrackStreamsRef.current[key];
      if (!dedicated) {
        dedicated = new MediaStream([track]);
        remoteVideoTrackStreamsRef.current[key] = dedicated;
      } else if (!dedicated.getTracks().some((candidate) => candidate.id === track.id)) {
        dedicated.addTrack(track);
      }
      cameraStream = dedicated;
    }

    if (expectedScreen && !screenStream) {
      const known = remoteStreamByIdRef.current[expectedScreen];
      if (known?.peerId === peerId && known.stream.getVideoTracks().some((track) => track.readyState === "live")) {
        screenStream = known.stream;
      }
    }

    setRemoteMedia((current) => {
      const previous = current[peerId] || {};
      const next = { ...previous };
      if (cameraStream) next.camera = cameraStream;
      else if (cameraExpected === false) delete next.camera;
      if (screenStream) next.screen = screenStream;
      if (previous.camera === next.camera && previous.screen === next.screen) return current;
      return { ...current, [peerId]: next };
    });
  }, []);

  const removePeer = useCallback((peerId: number) => {
    const bundle = peersRef.current[peerId];
    if (bundle) {
      try { bundle.watchdogStop(); } catch {}
      try { bundle.pc.close(); } catch {}
      delete peersRef.current[peerId];
    }
    Object.keys(audioBindingsRef.current)
      .filter((key) => key.startsWith(`peer:${peerId}:`))
      .forEach((key) => {
        audioBindingsRef.current[key]?.dispose();
        delete audioBindingsRef.current[key];
      });
    Object.keys(speakingStopsRef.current)
      .filter((key) => key.includes(`:${peerId}:`))
      .forEach((key) => {
        speakingStopsRef.current[key]?.();
        delete speakingStopsRef.current[key];
      });
    delete pendingOffersRef.current[peerId];
    delete pendingIceRef.current[peerId];
    delete expectedScreenStreamRef.current[peerId];
    delete remoteCameraExpectedRef.current[peerId];
    delete remoteVideoResyncAtRef.current[peerId];
    Object.keys(remoteVideoTrackStreamsRef.current)
      .filter((key) => key.startsWith("peer:" + peerId + ":"))
      .forEach((key) => { delete remoteVideoTrackStreamsRef.current[key]; });
    // SOCIALBIRD_CALL_SYSTEM_V5: peer-camera-timer-cleanup
    if (cameraResyncTimersRef.current[peerId]) window.clearTimeout(cameraResyncTimersRef.current[peerId]);
    delete cameraResyncTimersRef.current[peerId];
    setRemoteMedia((current) => {
      const next = { ...current };
      delete next[peerId];
      return next;
    });
    setSpeaking(peerId, false);
  }, [setSpeaking]);

  const makeOfferRef = useRef<(peerId: number, iceRestart?: boolean) => Promise<void>>(async () => undefined);

  const createPeer = useCallback((peerId: number) => {
    const existing = peersRef.current[peerId];
    if (existing && existing.pc.signalingState !== "closed") return existing;

    const pc = new RTCPeerConnection(getPeerConnectionConfig());
    const local = localStreamRef.current;
    local?.getAudioTracks().forEach((track) => pc.addTrack(track, local));

    // SOCIALBIRD_CALL_SYSTEM_V6: real-camera-sender
    // Do not pre-create an empty video transceiver for voice calls. Some browsers/WebViews
    // keep that receiver muted forever after replaceTrack(). A real addTrack() guarantees
    // a negotiated video m-line and a fresh remote ontrack event when video is enabled.
    const cameraTrack = local?.getVideoTracks().find((track) => track.readyState === "live");
    const cameraSender = cameraTrack && local ? pc.addTrack(cameraTrack, local) : null;

    const bundle: PeerBundle = {
      peerId,
      pc,
      cameraSender,
      screenSender: null,
      screenAudioSenders: [],
      watchdogStop: () => undefined,
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const active = callRef.current;
      if (!active) return;
      sendSignal("CALL_ICE", [peerId], {
        ...active,
        candidate: event.candidate.toJSON(),
      });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      if (event.track.kind === "audio") attachRemoteAudio(peerId, stream, event.track);
      if (event.track.kind === "video") {
        // SOCIALBIRD_CALL_SYSTEM_V7: dedicated-camera-track-stream
        // Keep the original WebRTC stream id for screen-share classification, but bind
        // webcam rendering to a dedicated MediaStream containing the actual receiver track.
        remoteStreamByIdRef.current[stream.id] = { peerId, stream };
        const expectedScreen = expectedScreenStreamRef.current[peerId];
        if (expectedScreen && stream.id === expectedScreen) {
          classifyRemoteVideo(peerId, stream);
        } else {
          const key = "peer:" + peerId + ":" + event.track.id;
          const cameraStream = remoteVideoTrackStreamsRef.current[key] || new MediaStream([event.track]);
          remoteVideoTrackStreamsRef.current[key] = cameraStream;
          setRemoteMedia((current) => {
            const previous = current[peerId] || {};
            return previous.camera === cameraStream
              ? current
              : { ...current, [peerId]: { ...previous, camera: cameraStream } };
          });
        }
        const refreshVideo = () => reconcileRemoteVideo(peerId, pc);
        event.track.addEventListener("unmute", refreshVideo);
        window.setTimeout(refreshVideo, 0);
      }
      event.track.addEventListener("ended", () => {
        if (event.track.kind === "video") {
          setRemoteMedia((current) => {
            const existingMedia = current[peerId];
            if (!existingMedia) return current;
            const nextMedia = { ...existingMedia };
            if (nextMedia.camera?.getTracks().some((track) => track.id === event.track.id)) delete nextMedia.camera;
            if (nextMedia.screen?.getTracks().some((track) => track.id === event.track.id)) delete nextMedia.screen;
            return { ...current, [peerId]: nextMedia };
          });
        }
      }, { once: true });
    };

    bundle.watchdogStop = watchPeerConnection(pc, async () => {
      const active = callRef.current;
      if (!active || pc.signalingState === "closed") return;
      await makeOfferRef.current(peerId, true);
    });

    // SOCIALBIRD_CALL_SYSTEM_V5: real-webrtc-connected-state
    const markRealConnection = () => {
      if (pc.connectionState !== "connected") return;
      reconcileRemoteVideo(peerId, pc);
      if (acceptedConnectTimerRef.current !== null) {
        window.clearTimeout(acceptedConnectTimerRef.current);
        acceptedConnectTimerRef.current = null;
      }
      setCall((current) => {
        if (!current || current.phase === "active") return current;
        const next = { ...current, phase: "active" as const };
        callRef.current = next;
        window.dispatchEvent(new CustomEvent("itbird-native-call-state", { detail: { active: true, phase: "active" } }));
        return next;
      });
    };
    pc.addEventListener("connectionstatechange", markRealConnection);

    peersRef.current[peerId] = bundle;
    return bundle;
  }, [attachRemoteAudio, classifyRemoteVideo, reconcileRemoteVideo, sendSignal]);

  const makeOffer = useCallback(async (peerId: number, iceRestart = false) => {
    const active = callRef.current;
    if (!active) return;
    const bundle = createPeer(peerId);
    const pc = bundle.pc;
    if (pc.signalingState === "closed") return;
    if (pc.signalingState !== "stable") {
      if (!iceRestart) return;
      try { await pc.setLocalDescription({ type: "rollback" }); } catch {}
    }
    const offer = await pc.createOffer({ iceRestart });
    await pc.setLocalDescription(offer);
    sendSignal("CALL_OFFER", [peerId], { ...active, description: offer });
  }, [createPeer, sendSignal]);

  useEffect(() => {
    makeOfferRef.current = makeOffer;
  }, [makeOffer]);

  const flushPendingIce = useCallback(async (peerId: number, pc: RTCPeerConnection) => {
    const candidates = pendingIceRef.current[peerId] || [];
    pendingIceRef.current[peerId] = [];
    for (const candidate of candidates) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
    }
  }, []);

  const handleOffer = useCallback(async (signal: CallSignal) => {
    if (!signal.description || !signal.senderId) return;
    const bundle = createPeer(Number(signal.senderId));
    const pc = bundle.pc;
    if (pc.signalingState !== "stable") {
      try { await pc.setLocalDescription({ type: "rollback" }); } catch {}
    }
    await pc.setRemoteDescription(new RTCSessionDescription(signal.description));
    reconcileRemoteVideo(Number(signal.senderId), pc);
    window.setTimeout(() => reconcileRemoteVideo(Number(signal.senderId), pc), 150);
    await flushPendingIce(Number(signal.senderId), pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const active = callRef.current;
    if (!active) return;
    sendSignal("CALL_ANSWER", [Number(signal.senderId)], { ...active, description: answer });
  }, [createPeer, flushPendingIce, reconcileRemoteVideo, sendSignal]);

  const handleAnswer = useCallback(async (signal: CallSignal) => {
    if (!signal.description || !signal.senderId) return;
    const bundle = peersRef.current[Number(signal.senderId)];
    if (!bundle || bundle.pc.signalingState === "closed") return;
    await bundle.pc.setRemoteDescription(new RTCSessionDescription(signal.description)).catch(() => undefined);
    reconcileRemoteVideo(Number(signal.senderId), bundle.pc);
    window.setTimeout(() => reconcileRemoteVideo(Number(signal.senderId), bundle.pc), 150);
    await flushPendingIce(Number(signal.senderId), bundle.pc);
    // V5: SDP answer alone is not a connected call. connectionstatechange owns phase=active.
  }, [flushPendingIce, reconcileRemoteVideo]);

  const ensureLocalMedia = useCallback(async (kind: CallKind, facing: CameraFacingMode = "user") => {
    const existing = localStreamRef.current;
    const existingAudio = existing?.getAudioTracks().find((track) => track.readyState === "live");
    const existingVideo = existing?.getVideoTracks().find((track) => track.readyState === "live");
    if (existingAudio && (kind === "voice" || existingVideo)) return existing as MediaStream;

    existing?.getTracks().forEach((track) => track.stop());
    const stream = await requestCallMedia({ video: kind === "video", facingMode: facing });
    localStreamRef.current = stream;
    const selfId = currentUserIdRef.current;
    const audioTrack = stream.getAudioTracks()[0];
    if (selfId && audioTrack) monitorAudioTrack(`local:${selfId}:${audioTrack.id}`, selfId, audioTrack);
    return stream;
  }, [monitorAudioTrack]);

  const closeOutgoingCameraTransport = useCallback((peerId: number, snapshot?: CallSnapshot | null, broadcast = false) => {
    const current = cameraAuxOutgoingRef.current[peerId];
    if (current) {
      try { current.pc.close(); } catch {}
      delete cameraAuxOutgoingRef.current[peerId];
    }
    if (broadcast && snapshot) {
      sendSignal("CALL_VIDEO_STOP", [peerId], { ...snapshot, transportId: current?.transportId });
    }
  }, [sendSignal]);

  const startOutgoingCameraTransport = useCallback(async (snapshot: CallSnapshot, peerId: number, track: MediaStreamTrack) => {
    if (!Number.isFinite(peerId) || peerId <= 0 || track.readyState !== "live") return;
    const existing = cameraAuxOutgoingRef.current[peerId];
    if (existing && existing.pc.signalingState !== "closed") {
      if (existing.sender) await existing.sender.replaceTrack(track).catch(() => undefined);
      return;
    }

    const selfId = currentUserIdRef.current;
    if (!selfId) return;
    const transportId = snapshot.callId + ":camera:" + selfId + ":" + peerId + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
    const pc = new RTCPeerConnection(getPeerConnectionConfig());
    const cameraStream = new MediaStream([track]);
    const sender = pc.addTrack(track, cameraStream);
    const transport: CameraAuxTransport = { peerId, transportId, pc, sender };
    cameraAuxOutgoingRef.current[peerId] = transport;

    pc.onicecandidate = (event) => {
      if (!event.candidate || cameraAuxOutgoingRef.current[peerId]?.transportId !== transportId) return;
      sendSignal("CALL_VIDEO_ICE", [peerId], {
        ...snapshot,
        transportId,
        candidate: event.candidate.toJSON(),
      });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal("CALL_VIDEO_OFFER", [peerId], {
      ...snapshot,
      transportId,
      cameraEnabled: true,
      description: offer,
    });
  }, [sendSignal]);

  const syncOutgoingCameraTransports = useCallback(async (snapshot: CallSnapshot, track: MediaStreamTrack | null) => {
    const peerIds = allOtherParticipantIds(snapshot);
    if (!track) {
      const existingPeerIds = Object.keys(cameraAuxOutgoingRef.current).map(Number);
      existingPeerIds.forEach((peerId) => closeOutgoingCameraTransport(peerId, snapshot, true));
      return;
    }
    for (const peerId of peerIds) {
      await startOutgoingCameraTransport(snapshot, peerId, track);
    }
  }, [allOtherParticipantIds, closeOutgoingCameraTransport, startOutgoingCameraTransport]);

  const flushAuxCameraIce = useCallback(async (transportId: string, pc: RTCPeerConnection) => {
    const candidates = cameraAuxPendingIceRef.current[transportId] || [];
    delete cameraAuxPendingIceRef.current[transportId];
    for (const candidate of candidates) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
    }
  }, []);

  const handleAuxCameraSignal = useCallback(async (type: string, signal: CallSignal) => {
    const peerId = Number(signal.senderId);
    const transportId = String(signal.transportId || "");
    if (!peerId || !transportId) return;

    if (type === "CALL_VIDEO_OFFER") {
      if (!signal.description) return;
      const previous = cameraAuxIncomingRef.current[transportId];
      if (previous) { try { previous.pc.close(); } catch {} }

      const pc = new RTCPeerConnection(getPeerConnectionConfig());
      const transport: CameraAuxTransport = { peerId, transportId, pc, sender: null };
      cameraAuxIncomingRef.current[transportId] = transport;

      pc.onicecandidate = (event) => {
        if (!event.candidate || cameraAuxIncomingRef.current[transportId]?.pc !== pc) return;
        const active = callRef.current;
        if (!active) return;
        sendSignal("CALL_VIDEO_ICE", [peerId], {
          ...active,
          transportId,
          candidate: event.candidate.toJSON(),
        });
      };
      pc.ontrack = (event) => {
        if (event.track.kind !== "video") return;
        const cameraStream = new MediaStream([event.track]);
        remoteCameraExpectedRef.current[peerId] = true;
        setRemoteMedia((current) => {
          const previousMedia = current[peerId] || {};
          return { ...current, [peerId]: { ...previousMedia, camera: cameraStream } };
        });
        const restore = () => {
          if (event.track.readyState !== "live") return;
          setRemoteMedia((current) => {
            const previousMedia = current[peerId] || {};
            return { ...current, [peerId]: { ...previousMedia, camera: cameraStream } };
          });
        };
        event.track.addEventListener("unmute", restore);
        event.track.addEventListener("ended", () => {
          setRemoteMedia((current) => {
            const previousMedia = current[peerId];
            if (!previousMedia?.camera?.getTracks().some((item) => item.id === event.track.id)) return current;
            const next = { ...previousMedia };
            delete next.camera;
            return { ...current, [peerId]: next };
          });
        }, { once: true });
      };

      await pc.setRemoteDescription(new RTCSessionDescription(signal.description));
      await flushAuxCameraIce(transportId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const active = callRef.current;
      if (!active) return;
      sendSignal("CALL_VIDEO_ANSWER", [peerId], { ...active, transportId, description: answer });
      return;
    }

    if (type === "CALL_VIDEO_ANSWER") {
      if (!signal.description) return;
      const outgoing = Object.values(cameraAuxOutgoingRef.current).find((item) => item.transportId === transportId);
      if (!outgoing || outgoing.pc.signalingState === "closed") return;
      await outgoing.pc.setRemoteDescription(new RTCSessionDescription(signal.description)).catch(() => undefined);
      await flushAuxCameraIce(transportId, outgoing.pc);
      return;
    }

    if (type === "CALL_VIDEO_ICE") {
      if (!signal.candidate) return;
      const outgoing = Object.values(cameraAuxOutgoingRef.current).find((item) => item.transportId === transportId);
      const incoming = cameraAuxIncomingRef.current[transportId];
      const pc = outgoing?.pc || incoming?.pc;
      if (pc?.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => undefined);
      } else {
        cameraAuxPendingIceRef.current[transportId] ||= [];
        cameraAuxPendingIceRef.current[transportId].push(signal.candidate);
      }
      return;
    }

    if (type === "CALL_VIDEO_STOP") {
      Object.entries(cameraAuxIncomingRef.current).forEach(([id, transport]) => {
        if (transport.peerId !== peerId) return;
        try { transport.pc.close(); } catch {}
        delete cameraAuxIncomingRef.current[id];
      });
      remoteCameraExpectedRef.current[peerId] = false;
      setRemoteMedia((current) => {
        const previousMedia = current[peerId];
        if (!previousMedia) return current;
        const next = { ...previousMedia };
        delete next.camera;
        return { ...current, [peerId]: next };
      });
    }
  }, [flushAuxCameraIce, sendSignal]);

  const startCall = useCallback(async (input: StartCallInput) => {
    if (startingRef.current) return;
    if (callRef.current || incomingRef.current) {
      toast.error("Сначала завершите текущий звонок");
      return;
    }
    const selfId = currentUserIdRef.current;
    if (!selfId) {
      toast.error("Не удалось определить пользователя звонка");
      return;
    }
    const targets = Array.from(new Set(input.targetIds.map(Number)))
      .filter((id) => Number.isFinite(id) && id > 0 && id !== selfId);
    if (targets.length === 0) return;

    startingRef.current = true;
    try {
      const stream = await ensureLocalMedia(input.kind, "user");
      const participants = dedupeParticipants([
        { id: selfId, username: currentUsernameRef.current },
        ...input.participants,
      ]);
      const snapshot: CallSnapshot = {
        callId: createCallId(),
        direction: "outgoing",
        phase: "calling",
        chatId: input.chatId,
        mode: input.mode,
        title: input.title,
        callKind: input.kind,
        initiatorId: selfId,
        targetIds: targets,
        participants,
        micEnabled: true,
        soundEnabled: true,
        cameraEnabled: input.kind === "video",
        screenEnabled: false,
        speakerEnabled: true,
        cameraFacing: "user",
        localStream: stream,
        screenStream: null,
      };
      callRef.current = snapshot;
      publishActive(snapshot);

      sendSignal("CALL_INVITE", targets, {
        ...snapshot,
        callerName: currentUsernameRef.current,
      });
      for (const targetId of targets) await makeOffer(targetId);
    } catch (error) {
      finishCallLocally("start-error");
      toast.error(error instanceof Error ? error.message : "Не удалось начать звонок");
    } finally {
      startingRef.current = false;
    }
  }, [ensureLocalMedia, finishCallLocally, makeOffer, publishActive, sendSignal]);

  const acceptIncoming = useCallback(async () => {
    const invite = incomingRef.current;
    if (!invite || !socketReadyRef.current || socketRef.current?.readyState !== WebSocket.OPEN) {
      // SOCIALBIRD_CALL_SYSTEM_V5: defer-answer-until-ready
      autoAnswerRef.current = true;
      pendingPushAnswerRef.current = true;
      return;
    }
    if (acceptingRef.current) return;
    const selfId = currentUserIdRef.current;
    if (!selfId) {
      // SOCIALBIRD_CALL_SYSTEM_V5: cold-start-user-id-defer
      autoAnswerRef.current = true;
      pendingPushAnswerRef.current = true;
      return;
    }
    acceptingRef.current = true;

    try {
      stopRingtone();
      const kind: CallKind = invite.callKind || "voice";
      const stream = await ensureLocalMedia(kind, "user");
      const participants = dedupeParticipants([
        ...(invite.participants || []),
        { id: invite.senderId, username: invite.callerName || invite.title || "Собеседник" },
        { id: selfId, username: currentUsernameRef.current },
      ]);
      const targetIds = Array.from(new Set([
        ...(invite.targetIds || []),
        ...participants.map((participant) => Number(participant.id)),
        Number(invite.senderId),
      ])).filter((id) => Number.isFinite(id) && id > 0 && id !== selfId);
      const snapshot: CallSnapshot = {
        callId: invite.callId || createCallId(),
        direction: "incoming",
        phase: "connecting",
        chatId: invite.chatId,
        mode: invite.mode || "private",
        title: invite.title || invite.callerName || "Активный звонок",
        callKind: kind,
        initiatorId: Number(invite.initiatorId || invite.senderId),
        targetIds,
        participants,
        micEnabled: true,
        soundEnabled: true,
        cameraEnabled: kind === "video",
        screenEnabled: false,
        speakerEnabled: true,
        cameraFacing: "user",
        localStream: stream,
        screenStream: null,
      };
      callRef.current = snapshot;
      setIncoming(null);
      incomingRef.current = null;
      autoAnswerRef.current = false;
      pendingPushAnswerRef.current = false;
      publishActive(snapshot);
      // SOCIALBIRD_CALL_SYSTEM_V5: accepted-connect-timeout
      if (acceptedConnectTimerRef.current !== null) window.clearTimeout(acceptedConnectTimerRef.current);
      acceptedConnectTimerRef.current = window.setTimeout(() => {
        const active = callRef.current;
        const connected = Object.values(peersRef.current).some((bundle) => bundle.pc.connectionState === "connected");
        if (active?.callId === snapshot.callId && !connected) {
          toast.error("Не удалось установить соединение. Попробуйте позвонить ещё раз.");
          finishCallLocally("connect-timeout");
        }
        acceptedConnectTimerRef.current = null;
      }, 18000);

      const pending = Object.values(pendingOffersRef.current);
      for (const offer of pending) {
        if (!offer.callId || offer.callId === snapshot.callId || String(offer.chatId) === String(snapshot.chatId)) {
          await handleOffer(offer);
          delete pendingOffersRef.current[Number(offer.senderId)];
        }
      }

      sendSignal("CALL_ACCEPT", targetIds, snapshot);
      const acceptedCameraTrack = stream.getVideoTracks().find((item) => item.readyState === "live") || null;
      if (acceptedCameraTrack) await syncOutgoingCameraTransports(snapshot, acceptedCameraTrack);
      // Push-answer may arrive after the original offer expired. Ask the initiator
      // for a fresh negotiation by also creating an offer when this side wins the tie.
      for (const peerId of targetIds) {
        if (selfId < peerId && !peersRef.current[peerId]) await makeOffer(peerId);
      }
    } catch (error) {
      finishCallLocally("accept-error");
      toast.error(error instanceof Error ? error.message : "Не удалось принять звонок");
    } finally {
      acceptingRef.current = false;
    }
  }, [ensureLocalMedia, finishCallLocally, handleOffer, makeOffer, publishActive, sendSignal, stopRingtone, syncOutgoingCameraTransports]);

  const declineIncoming = useCallback(() => {
    const invite = incomingRef.current;
    if (invite?.senderId) {
      sendSignal("CALL_HANGUP", [Number(invite.senderId)], {
        ...invite,
        participantLeft: true,
        endForAll: invite.mode !== "group",
      });
    }
    stopRingtone();
    setIncoming(null);
    incomingRef.current = null;
    autoAnswerRef.current = false;
  }, [sendSignal, stopRingtone]);

  const hangup = useCallback(() => {
    const active = callRef.current;
    if (!active) {
      declineIncoming();
      return;
    }
    const targets = allOtherParticipantIds(active);
    sendSignal("CALL_HANGUP", targets, {
      ...active,
      endForAll: active.mode === "private" || active.direction === "outgoing",
      participantLeft: active.mode === "group" && active.direction === "incoming",
    });
    finishCallLocally("hangup");
  }, [allOtherParticipantIds, declineIncoming, finishCallLocally, sendSignal]);

  const toggleMic = useCallback(() => {
    const active = callRef.current;
    if (!active) return;
    const next = !active.micEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setCall((current) => current ? { ...current, micEnabled: next } : current);
  }, []);

  const forceRemoteAudioPlayback = useCallback(async () => {
    const bindings = Object.values(audioBindingsRef.current);
    const results = await Promise.all(bindings.map(async (binding) => {
      binding.media.muted = false;
      return binding.ensurePlaying();
    }));
    if (results.some((playing) => !playing)) toast.error("Нажмите по экрану и повторите включение звука");
  }, []);

  // SOCIALBIRD_CALL_SYSTEM_V5: set-participant-volume
  const setParticipantVolume = useCallback((userId: number, volume: number) => {
    const id = Number(userId);
    if (!Number.isFinite(id) || id <= 0) return;
    const normalized = Math.min(1, Math.max(0, Number(volume) || 0));
    participantVolumesRef.current[id] = normalized;
    setParticipantVolumes((current) => ({ ...current, [id]: normalized }));
    writeParticipantVolume(id, normalized);
    Object.entries(audioBindingsRef.current).forEach(([key, binding]) => {
      if (key.startsWith(`peer:${id}:`)) binding.media.volume = normalized;
    });
  }, []);

  const toggleSound = useCallback(() => {
    const active = callRef.current;
    if (!active) return;
    const next = !active.soundEnabled;
    Object.values(audioBindingsRef.current).forEach((binding) => {
      binding.media.muted = !next;
      if (next) void binding.ensurePlaying();
    });
    setCall((current) => current ? { ...current, soundEnabled: next } : current);
  }, []);

  const renegotiateCamera = useCallback(async (snapshot: CallSnapshot, track: MediaStreamTrack | null) => {
    // SOCIALBIRD_CALL_SYSTEM_V8: auxiliary-camera-sync
    await syncOutgoingCameraTransports(snapshot, track);
    // SOCIALBIRD_CALL_SYSTEM_V6: add-remove-camera-track
    const local = localStreamRef.current;
    const peerIds = Object.keys(peersRef.current).map(Number);
    for (const peerId of peerIds) {
      const bundle = peersRef.current[peerId];
      if (!bundle || bundle.pc.signalingState === "closed") continue;

      if (track && local) {
        if (!bundle.cameraSender) {
          bundle.cameraSender = bundle.pc.addTrack(track, local);
        } else {
          try {
            if (typeof bundle.cameraSender.setStreams === "function") bundle.cameraSender.setStreams(local);
          } catch {}
          await bundle.cameraSender.replaceTrack(track).catch(() => undefined);
        }
      } else if (bundle.cameraSender) {
        try { bundle.pc.removeTrack(bundle.cameraSender); } catch {
          await bundle.cameraSender.replaceTrack(null).catch(() => undefined);
        }
        bundle.cameraSender = null;
      }
    }

    sendSignal("CALL_CAMERA_STATE", allOtherParticipantIds(snapshot), {
      ...snapshot,
      cameraEnabled: Boolean(track),
      cameraFacing: snapshot.cameraFacing,
    });
    for (const peerId of peerIds) await makeOffer(peerId, true);
  }, [allOtherParticipantIds, makeOffer, sendSignal, syncOutgoingCameraTransports]);

  const toggleCamera = useCallback(async () => {
    const active = callRef.current;
    if (!active) return;
    if (active.cameraEnabled) {
      const oldTracks = localStreamRef.current?.getVideoTracks() || [];
      oldTracks.forEach((track) => {
        localStreamRef.current?.removeTrack(track);
        if (track.readyState !== "ended") track.stop();
      });
      const next: CallSnapshot = { ...active, cameraEnabled: false, localStream: localStreamRef.current };
      callRef.current = next;
      setCall(next);
      await renegotiateCamera(next, null);
      return;
    }

    try {
      const { track } = await requestCameraTrack({ facingMode: active.cameraFacing });
      if (!localStreamRef.current) localStreamRef.current = new MediaStream();
      localStreamRef.current.getVideoTracks().forEach((oldTrack) => {
        localStreamRef.current?.removeTrack(oldTrack);
        if (oldTrack.readyState !== "ended") oldTrack.stop();
      });
      localStreamRef.current.addTrack(track);
      const next: CallSnapshot = { ...active, callKind: "video", cameraEnabled: true, localStream: localStreamRef.current };
      callRef.current = next;
      setCall(next);
      await renegotiateCamera(next, track);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось включить видео");
    }
  }, [renegotiateCamera]);

  const switchCamera = useCallback(async () => {
    const active = callRef.current;
    if (!active?.cameraEnabled) return;
    try {
      let nextFacing: CameraFacingMode = active.cameraFacing === "user" ? "environment" : "user";
      let cameraDeviceId: string | undefined;
      if (!isMobile) {
        const cameras = await listVideoInputs();
        if (cameras.length < 2) { toast.info("Доступна только одна камера"); return; }
        const currentTrack = localStreamRef.current?.getVideoTracks()[0];
        const currentDeviceId = currentTrack?.getSettings().deviceId;
        const currentIndex = Math.max(0, cameras.findIndex((camera) => camera.deviceId === currentDeviceId));
        cameraDeviceId = cameras[(currentIndex + 1) % cameras.length]?.deviceId;
        nextFacing = active.cameraFacing;
      }
      const { track } = await requestCameraTrack({ facingMode: isMobile ? nextFacing : undefined, deviceId: cameraDeviceId });
      const oldTrack = localStreamRef.current?.getVideoTracks()[0];
      if (!localStreamRef.current) localStreamRef.current = new MediaStream();
      if (oldTrack) localStreamRef.current.removeTrack(oldTrack);
      localStreamRef.current.addTrack(track);
      const next: CallSnapshot = { ...active, cameraFacing: nextFacing, cameraEnabled: true, callKind: "video", localStream: localStreamRef.current };
      callRef.current = next;
      setCall(next);
      await renegotiateCamera(next, track);
      if (oldTrack && oldTrack.readyState !== "ended") oldTrack.stop();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переключить камеру");
    }
  }, [isMobile, renegotiateCamera]);

  const stopScreenShare = useCallback(async (broadcast = true) => {
    const active = callRef.current;
    const capture = screenCaptureRef.current;
    if (!capture) return;
    for (const bundle of Object.values(peersRef.current)) {
      if (bundle.screenSender) {
        try { bundle.pc.removeTrack(bundle.screenSender); } catch {}
        bundle.screenSender = null;
      }
      bundle.screenAudioSenders.forEach((sender) => {
        try { bundle.pc.removeTrack(sender); } catch {}
      });
      bundle.screenAudioSenders = [];
    }
    capture.stream.getTracks().forEach((track) => {
      if (track.readyState !== "ended") track.stop();
    });
    screenCaptureRef.current = null;
    setCall((current) => current ? { ...current, screenEnabled: false, screenStream: null } : current);
    if (active && broadcast) {
      sendSignal("CALL_SCREEN_STOP", allOtherParticipantIds(active), active);
      for (const peerId of Object.keys(peersRef.current).map(Number)) await makeOffer(peerId);
    }
  }, [allOtherParticipantIds, makeOffer, sendSignal]);

  const toggleScreenShare = useCallback(async () => {
    const active = callRef.current;
    if (!active) return;
    if (active.screenEnabled) {
      await stopScreenShare(true);
      return;
    }

    try {
      const capture = await requestScreenShare();
      screenCaptureRef.current = capture;
      for (const bundle of Object.values(peersRef.current)) {
        bundle.screenSender = bundle.pc.addTrack(capture.videoTrack, capture.stream);
        bundle.screenAudioSenders = capture.audioTracks.map((track) => bundle.pc.addTrack(track, capture.stream));
      }
      capture.videoTrack.addEventListener("ended", () => { void stopScreenShare(true); }, { once: true });
      setCall((current) => current ? { ...current, screenEnabled: true, screenStream: capture.stream } : current);
      sendSignal("CALL_SCREEN_START", allOtherParticipantIds(active), {
        ...active,
        screenStreamId: capture.stream.id,
      });
      for (const peerId of Object.keys(peersRef.current).map(Number)) await makeOffer(peerId);
    } catch (error) {
      toast.error(getScreenShareErrorMessage(error));
    }
  }, [allOtherParticipantIds, makeOffer, sendSignal, stopScreenShare]);

  const toggleSpeaker = useCallback(() => {
    const active = callRef.current;
    if (!active) return;
    const next = !active.speakerEnabled;
    try {
      const bridge = (window as typeof window & { ITBirdAndroid?: NativeCallBridge }).ITBirdAndroid;
      bridge?.setSpeakerphone?.(next);
    } catch {}
    setCall((current) => current ? { ...current, speakerEnabled: next } : current);
  }, []);

  const enterPictureInPicture = useCallback(() => {
    try {
      const bridge = (window as typeof window & { ITBirdAndroid?: NativeCallBridge }).ITBirdAndroid;
      bridge?.enterPictureInPicture?.();
    } catch {}
  }, []);

  const processIncomingInvite = useCallback((signal: CallSignal) => {
    const active = callRef.current;
    if (active) {
      if (active.callId === signal.callId || (String(active.chatId) === String(signal.chatId) && active.mode === signal.mode)) return;
      sendSignal("CALL_BUSY", [Number(signal.senderId)], { ...signal, reason: "busy" });
      return;
    }
    incomingRef.current = signal;
    setIncoming(signal);
    startRingtone();
    if (autoAnswerRef.current) window.setTimeout(() => { void acceptIncoming(); }, 0);
  }, [acceptIncoming, sendSignal, startRingtone]);

  const handleCallSignal = useCallback(async (type: string, signal: CallSignal) => {
    const selfId = currentUserIdRef.current;
    if (!selfId || Number(signal.senderId) === selfId) return;
    if (Array.isArray(signal.targetIds) && !signal.targetIds.map(Number).includes(selfId)) return;

    const remotePeerId = Number(signal.senderId);
    if (remotePeerId > 0 && typeof signal.cameraEnabled === "boolean") {
      remoteCameraExpectedRef.current[remotePeerId] = signal.cameraEnabled;
      const peer = peersRef.current[remotePeerId];
      if (peer) reconcileRemoteVideo(remotePeerId, peer.pc);
    }

    // SOCIALBIRD_CALL_SYSTEM_V4: stale-call-signal-guard
    if (type !== "CALL_INVITE") {
      const relevant = callRef.current || incomingRef.current;
      if (relevant) {
        if (relevant.callId && signal.callId && relevant.callId !== signal.callId) return;
        if (String(relevant.chatId) !== String(signal.chatId) || relevant.mode !== signal.mode) return;
      }
    }

    if (type === "CALL_INVITE") {
      processIncomingInvite(signal);
      return;
    }

    if (type === "CALL_OFFER") {
      const active = callRef.current;
      const belongsToActive = active && (
        (signal.callId && signal.callId === active.callId)
        || (String(signal.chatId) === String(active.chatId) && signal.mode === active.mode)
      );
      if (belongsToActive) {
        await handleOffer(signal);
      } else {
        pendingOffersRef.current[Number(signal.senderId)] = signal;
        if (!incomingRef.current) processIncomingInvite(signal);
        if (autoAnswerRef.current && incomingRef.current) await acceptIncoming();
      }
      return;
    }

    if (type === "CALL_ANSWER") {
      await handleAnswer(signal);
      return;
    }

    if (type === "CALL_ICE") {
      if (!signal.candidate) return;
      const peerId = Number(signal.senderId);
      const bundle = peersRef.current[peerId];
      if (bundle?.pc.remoteDescription) {
        await bundle.pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => undefined);
      } else {
        pendingIceRef.current[peerId] ||= [];
        pendingIceRef.current[peerId].push(signal.candidate);
      }
      return;
    }

    if (type === "CALL_ACCEPT") {
      const active = callRef.current;
      if (!active) return;
      const peerId = Number(signal.senderId);
      if (!Number.isFinite(peerId) || peerId <= 0) return;
      if (!peersRef.current[peerId] || !peersRef.current[peerId].pc.remoteDescription) {
        // SOCIALBIRD_CALL_SYSTEM_V4: fresh-offer-after-accept
        if (selfId < peerId || active.direction === "outgoing") await makeOffer(peerId, true);
      }
      // SOCIALBIRD_CALL_SYSTEM_V8: accepted-peer-camera-start
      const localCamera = localStreamRef.current?.getVideoTracks().find((item) => item.readyState === "live") || null;
      if (active.cameraEnabled && localCamera) await startOutgoingCameraTransport(active, peerId, localCamera);
      // V5: CALL_ACCEPT only starts/refreshes negotiation; real WebRTC connected marks active.
      return;
    }

    if (type === "CALL_VIDEO_OFFER" || type === "CALL_VIDEO_ANSWER" || type === "CALL_VIDEO_ICE" || type === "CALL_VIDEO_STOP") {
      await handleAuxCameraSignal(type, signal);
      return;
    }

    // SOCIALBIRD_CALL_SYSTEM_V5: remote-camera-resync
    if (type === "CALL_CAMERA_STATE") {
      const peerId = Number(signal.senderId);
      remoteCameraExpectedRef.current[peerId] = Boolean(signal.cameraEnabled);
      const cameraPeer = peersRef.current[peerId];
      if (cameraPeer) reconcileRemoteVideo(peerId, cameraPeer.pc);
      if (cameraResyncTimersRef.current[peerId]) window.clearTimeout(cameraResyncTimersRef.current[peerId]);
      if (!signal.cameraEnabled) {
        setRemoteMedia((current) => {
          const previous = current[peerId];
          if (!previous) return current;
          const next = { ...previous };
          delete next.camera;
          return { ...current, [peerId]: next };
        });
        return;
      }

      // SOCIALBIRD_CALL_SYSTEM_V6: restore-existing-unmuted-camera
      // Re-enabling a previously negotiated sender may unmute the same receiver track
      // without firing ontrack again. Restore that known stream immediately.
      const screenId = expectedScreenStreamRef.current[peerId];
      const knownCamera = Object.values(remoteStreamByIdRef.current).find((entry) =>
        entry.peerId === peerId
        && entry.stream.id !== screenId
        && entry.stream.getVideoTracks().some((track) => track.readyState === "live" && !track.muted),
      );
      if (knownCamera) {
        setRemoteMedia((current) => {
          const previous = current[peerId] || {};
          return { ...current, [peerId]: { ...previous, camera: knownCamera.stream } };
        });
      }

      cameraResyncTimersRef.current[peerId] = window.setTimeout(() => {
        const screenId = expectedScreenStreamRef.current[peerId];
        const hasLiveCamera = Object.values(remoteStreamByIdRef.current).some((entry) =>
          entry.peerId === peerId && entry.stream.id !== screenId
          && entry.stream.getVideoTracks().some((track) => track.readyState === "live" && !track.muted),
        );
        if (!hasLiveCamera) sendSignal("CALL_CAMERA_RESYNC", [peerId], signal);
        delete cameraResyncTimersRef.current[peerId];
      }, 1400);
      return;
    }

    if (type === "CALL_CAMERA_RESYNC") {
      const active = callRef.current;
      const peerId = Number(signal.senderId);
      const track = localStreamRef.current?.getVideoTracks().find((item) => item.readyState === "live") || null;
      const bundle = peersRef.current[peerId];
      if (active?.cameraEnabled && bundle && track && localStreamRef.current) {
        // SOCIALBIRD_CALL_SYSTEM_V6: resync-real-camera-sender
        if (!bundle.cameraSender) {
          bundle.cameraSender = bundle.pc.addTrack(track, localStreamRef.current);
        } else {
          try {
            if (typeof bundle.cameraSender.setStreams === "function") bundle.cameraSender.setStreams(localStreamRef.current);
          } catch {}
          await bundle.cameraSender.replaceTrack(track).catch(() => undefined);
        }
        await makeOffer(peerId, true);
      }
      return;
    }

    if (type === "CALL_SCREEN_START") {
      if (signal.screenStreamId) {
        expectedScreenStreamRef.current[Number(signal.senderId)] = signal.screenStreamId;
        const known = remoteStreamByIdRef.current[signal.screenStreamId];
        if (known) {
          setRemoteMedia((current) => {
            const previous = current[known.peerId] || {};
            return { ...current, [known.peerId]: { ...previous, screen: known.stream } };
          });
        }
      }
      return;
    }

    if (type === "CALL_SCREEN_STOP") {
      const peerId = Number(signal.senderId);
      delete expectedScreenStreamRef.current[peerId];
      setRemoteMedia((current) => {
        const previous = current[peerId];
        if (!previous) return current;
        const next = { ...previous };
        delete next.screen;
        return { ...current, [peerId]: next };
      });
      return;
    }

    if (type === "CALL_BUSY") {
      toast.info("Пользователь уже находится в другом звонке");
      return;
    }

    if (type === "CALL_HANGUP") {
      const active = callRef.current;
      if (!active) {
        if (incomingRef.current && Number(signal.senderId) === Number(incomingRef.current.senderId)) {
          declineIncoming();
        }
        return;
      }
      if (active.mode === "group" && !signal.endForAll && signal.participantLeft) {
        removePeer(Number(signal.senderId));
      } else {
        finishCallLocally("remote-hangup");
      }
    }
  }, [acceptIncoming, declineIncoming, finishCallLocally, handleAnswer, handleAuxCameraSignal, handleOffer, makeOffer, processIncomingInvite, reconcileRemoteVideo, removePeer, startOutgoingCameraTransport]);

  useEffect(() => {
    if (!token) {
      socketReadyRef.current = false;
      socketRef.current?.close();
      socketRef.current = null;
      if (callRef.current || incomingRef.current) finishCallLocally("logout");
      return;
    }

    const socket = createReconnectingWebSocket(getWsUrl());
    socketRef.current = socket;
    socketReadyRef.current = false;
    socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token, clientRole: "call-host" }));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const type = String(payload.type || "");
        if (type === "ONLINE_USERS" || type.startsWith("CALL_")) {
          // SOCIALBIRD_CALL_SYSTEM_V5: authenticated-call-host-ready
          socketReadyRef.current = true;
        }
        if (type.startsWith("CALL_")) void handleCallSignal(type, payload.data || {});
        if (socketReadyRef.current && pendingPushAnswerRef.current && incomingRef.current) {
          window.setTimeout(() => { void acceptIncoming(); }, 0);
        }
      } catch {}
    };
    return () => {
      socketReadyRef.current = false;
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [acceptIncoming, finishCallLocally, handleCallSignal, token]);

  useEffect(() => {
    const onNativeAction = (event: Event) => {
      const detail = (event as CustomEvent<NativeCallAction>).detail || {};
      const nativeCall = parseNativeCall(detail.call);
      if (nativeCall && !incomingRef.current && nativeCall.senderId && nativeCall.chatId !== undefined) {
        const signal = nativeCall as CallSignal;
        incomingRef.current = signal;
        setIncoming(signal);
      }
      if (detail.action === "answer") {
        autoAnswerRef.current = true;
      pendingPushAnswerRef.current = true;
        if (incomingRef.current) void acceptIncoming();
      } else if (detail.action === "decline") {
        declineIncoming();
      }
    };

    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== "ITBIRD_PUSH_CALL_OPEN" && event.data?.type !== "ITBIRD_PUSH_CALL_VISIBLE") return;
      const action = event.data?.action === "answer" ? "answer" : "open";
      onNativeAction(new CustomEvent("itbird-native-call-action", {
        detail: { action, call: event.data?.call || null },
      }));
    };

    window.addEventListener("itbird-native-call-action", onNativeAction);
    navigator.serviceWorker?.addEventListener?.("message", onServiceWorkerMessage);
    return () => {
      window.removeEventListener("itbird-native-call-action", onNativeAction);
      navigator.serviceWorker?.removeEventListener?.("message", onServiceWorkerMessage);
    };
  }, [acceptIncoming, declineIncoming]);

  // SOCIALBIRD_CALL_SYSTEM_V4: legacy-native-answer-event
  useEffect(() => {
    const acceptFromNativeRuntime = () => {
      autoAnswerRef.current = true;
      pendingPushAnswerRef.current = true;
      try { sessionStorage.removeItem("itbird-native-answer-call"); } catch {}
      if (incomingRef.current) void acceptIncoming();
    };

    let pending = false;
    try { pending = sessionStorage.getItem("itbird-native-answer-call") === "1"; } catch {}
    if (pending) acceptFromNativeRuntime();

    window.addEventListener("itbird-native-answer-call", acceptFromNativeRuntime);
    return () => window.removeEventListener("itbird-native-answer-call", acceptFromNativeRuntime);
  }, [acceptIncoming]);

  // SOCIALBIRD_CALL_SYSTEM_V7: desktop-receiver-watchdog
  useEffect(() => {
    const timer = window.setInterval(() => {
      const active = callRef.current;
      if (!active) return;
      const now = Date.now();
      Object.values(peersRef.current).forEach((bundle) => {
        reconcileRemoteVideo(bundle.peerId, bundle.pc);
        if (remoteCameraExpectedRef.current[bundle.peerId] !== true) return;

        const screenId = expectedScreenStreamRef.current[bundle.peerId];
        const hasCameraReceiver = bundle.pc.getReceivers().some((receiver) => {
          const track = receiver.track;
          if (!track || track.kind !== "video" || track.readyState !== "live") return false;
          const original = Object.values(remoteStreamByIdRef.current).find((entry) =>
            entry.peerId === bundle.peerId && entry.stream.getVideoTracks().some((candidate) => candidate.id === track.id),
          )?.stream;
          return !screenId || !original || original.id !== screenId;
        });

        if (hasCameraReceiver) return;
        const last = remoteVideoResyncAtRef.current[bundle.peerId] || 0;
        if (now - last < 2200) return;
        remoteVideoResyncAtRef.current[bundle.peerId] = now;
        sendSignal("CALL_CAMERA_RESYNC", [bundle.peerId], {
          ...active,
          cameraEnabled: true,
          reason: "receiver-watchdog",
        });
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [reconcileRemoteVideo, sendSignal]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const active = callRef.current;
      if (!active) return;
      const audio = localStreamRef.current?.getAudioTracks().find((track) => track.readyState === "live");
      if (audio) return;
      void recoverMicrophoneTrack(localStreamRef.current, active.micEnabled)
        .then(async ({ stream, track, recovered }) => {
          if (!recovered) return;
          localStreamRef.current = stream;
          for (const bundle of Object.values(peersRef.current)) {
            const sender = bundle.pc.getSenders().find((item) => item.track?.kind === "audio" && !bundle.screenAudioSenders.includes(item));
            if (sender) await sender.replaceTrack(track).catch(() => undefined);
            else bundle.pc.addTrack(track, stream);
          }
          const selfId = currentUserIdRef.current;
          if (selfId) monitorAudioTrack(`local:${selfId}:${track.id}`, selfId, track);
          setCall((current) => current ? { ...current, localStream: stream } : current);
        })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [monitorAudioTrack]);

  useEffect(() => {
    return () => {
      stopRingtone();
      stopAllPeerResources();
      clearLocalMedia();
    };
  }, [clearLocalMedia, stopAllPeerResources, stopRingtone]);

  const contextValue = useMemo<CallManagerContextValue>(() => ({
    call,
    incoming,
    remoteMedia,
    speakingUserIds,
    participantVolumes,
    setParticipantVolume,
    currentUserId: currentUserIdRef.current,
    isMobile,
    startCall,
    acceptIncoming,
    declineIncoming,
    hangup,
    toggleMic,
    toggleSound,
    toggleCamera,
    switchCamera,
    toggleScreenShare,
    toggleSpeaker,
    enterPictureInPicture,
    forceRemoteAudioPlayback,
  }), [
    acceptIncoming,
    call,
    declineIncoming,
    enterPictureInPicture,
    forceRemoteAudioPlayback,
    hangup,
    incoming,
    isMobile,
    remoteMedia,
    speakingUserIds,
    participantVolumes,
    setParticipantVolume,
    startCall,
    switchCamera,
    toggleCamera,
    toggleMic,
    toggleScreenShare,
    toggleSound,
    toggleSpeaker,
  ]);

  return (
    <CallManagerContext.Provider value={contextValue}>
      {children}
      <div ref={audioRootRef} className="hidden" aria-hidden="true" />
    </CallManagerContext.Provider>
  );
};

export const useCallManager = () => {
  const context = useContext(CallManagerContext);
  if (!context) throw new Error("useCallManager must be used inside CallProvider");
  return context;
};

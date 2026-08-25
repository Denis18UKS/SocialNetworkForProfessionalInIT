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
  endForAll?: boolean;
  participantLeft?: boolean;
  screenStreamId?: string;
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
  cameraSender: RTCRtpSender;
  screenSender: RTCRtpSender | null;
  screenAudioSenders: RTCRtpSender[];
  watchdogStop: () => void;
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
  const speakingStopsRef = useRef<Record<string, () => void>>({});
  const audioRootRef = useRef<HTMLDivElement | null>(null);
  const autoAnswerRef = useRef(false);
  const ringtoneContextRef = useRef<AudioContext | null>(null);
  const ringtoneTimerRef = useRef<number | null>(null);
  const currentUserIdRef = useRef<number | null>(null);
  const currentUsernameRef = useRef("Вы");
  const isMobile = isMobileCallDevice();

  const token = isAuthenticated ? (localStorage.getItem("token") || "") : "";

  useEffect(() => {
    callRef.current = call;
    setWindowCallState(call);
  }, [call]);

  useEffect(() => {
    incomingRef.current = incoming;
  }, [incoming]);

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
    window.dispatchEvent(new CustomEvent("itbird-native-call-state", { detail: { active: true } }));
  }, []);

  const stopAllPeerResources = useCallback(() => {
    Object.values(peersRef.current).forEach((bundle) => {
      try { bundle.watchdogStop(); } catch {}
      try { bundle.pc.close(); } catch {}
    });
    peersRef.current = {};
    pendingOffersRef.current = {};
    pendingIceRef.current = {};
    expectedScreenStreamRef.current = {};
    remoteStreamByIdRef.current = {};
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

    const cameraTrack = local?.getVideoTracks().find((track) => track.readyState === "live");
    const cameraTransceiver = cameraTrack
      ? pc.addTransceiver(cameraTrack, { direction: "sendrecv", streams: local ? [local] : [] })
      : pc.addTransceiver("video", { direction: "sendrecv" });

    const bundle: PeerBundle = {
      peerId,
      pc,
      cameraSender: cameraTransceiver.sender,
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
      if (event.track.kind === "video") classifyRemoteVideo(peerId, stream);
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

    peersRef.current[peerId] = bundle;
    return bundle;
  }, [attachRemoteAudio, classifyRemoteVideo, sendSignal]);

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
    await flushPendingIce(Number(signal.senderId), pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const active = callRef.current;
    if (!active) return;
    sendSignal("CALL_ANSWER", [Number(signal.senderId)], { ...active, description: answer });
  }, [createPeer, flushPendingIce, sendSignal]);

  const handleAnswer = useCallback(async (signal: CallSignal) => {
    if (!signal.description || !signal.senderId) return;
    const bundle = peersRef.current[Number(signal.senderId)];
    if (!bundle || bundle.pc.signalingState === "closed") return;
    await bundle.pc.setRemoteDescription(new RTCSessionDescription(signal.description)).catch(() => undefined);
    await flushPendingIce(Number(signal.senderId), bundle.pc);
    setCall((current) => current ? { ...current, phase: "active" } : current);
  }, [flushPendingIce]);

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

  const startCall = useCallback(async (input: StartCallInput) => {
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
    }
  }, [ensureLocalMedia, finishCallLocally, makeOffer, publishActive, sendSignal]);

  const acceptIncoming = useCallback(async () => {
    const invite = incomingRef.current;
    if (!invite) {
      autoAnswerRef.current = true;
      return;
    }
    const selfId = currentUserIdRef.current;
    if (!selfId) return;

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
      publishActive(snapshot);

      const pending = Object.values(pendingOffersRef.current);
      for (const offer of pending) {
        if (!offer.callId || offer.callId === snapshot.callId || String(offer.chatId) === String(snapshot.chatId)) {
          await handleOffer(offer);
          delete pendingOffersRef.current[Number(offer.senderId)];
        }
      }

      sendSignal("CALL_ACCEPT", targetIds, snapshot);
      // Push-answer may arrive after the original offer expired. Ask the initiator
      // for a fresh negotiation by also creating an offer when this side wins the tie.
      for (const peerId of targetIds) {
        if (selfId < peerId && !peersRef.current[peerId]) await makeOffer(peerId);
      }
    } catch (error) {
      finishCallLocally("accept-error");
      toast.error(error instanceof Error ? error.message : "Не удалось принять звонок");
    }
  }, [ensureLocalMedia, finishCallLocally, handleOffer, makeOffer, publishActive, sendSignal, stopRingtone]);

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

  const toggleCamera = useCallback(async () => {
    const active = callRef.current;
    if (!active) return;
    if (active.cameraEnabled) {
      const oldTracks = localStreamRef.current?.getVideoTracks() || [];
      await Promise.all(Object.values(peersRef.current).map((bundle) => bundle.cameraSender.replaceTrack(null).catch(() => undefined)));
      oldTracks.forEach((track) => {
        localStreamRef.current?.removeTrack(track);
        if (track.readyState !== "ended") track.stop();
      });
      setCall((current) => current ? { ...current, cameraEnabled: false, localStream: localStreamRef.current } : current);
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
      await Promise.all(Object.values(peersRef.current).map((bundle) => bundle.cameraSender.replaceTrack(track)));
      setCall((current) => current ? {
        ...current,
        callKind: "video",
        cameraEnabled: true,
        localStream: localStreamRef.current,
      } : current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось включить камеру");
    }
  }, []);

  const switchCamera = useCallback(async () => {
    const active = callRef.current;
    if (!active?.cameraEnabled) return;
    try {
      let nextFacing: CameraFacingMode = active.cameraFacing === "user" ? "environment" : "user";
      let cameraDeviceId: string | undefined;

      if (!isMobile) {
        const cameras = await listVideoInputs();
        if (cameras.length < 2) {
          toast.info("Доступна только одна камера");
          return;
        }
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
      await Promise.all(Object.values(peersRef.current).map((bundle) => bundle.cameraSender.replaceTrack(track)));
      if (oldTrack && oldTrack.readyState !== "ended") oldTrack.stop();
      setCall((current) => current ? {
        ...current,
        cameraFacing: nextFacing,
        localStream: localStreamRef.current,
      } : current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переключить камеру");
    }
  }, [isMobile]);

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
        if (selfId < peerId || active.direction === "outgoing") await makeOffer(peerId);
      }
      setCall((current) => current ? { ...current, phase: "active" } : current);
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
  }, [acceptIncoming, declineIncoming, finishCallLocally, handleAnswer, handleOffer, makeOffer, processIncomingInvite, removePeer]);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      socketRef.current?.close();
      socketRef.current = null;
      if (callRef.current || incomingRef.current) finishCallLocally("logout");
      return;
    }

    const socket = createReconnectingWebSocket(getWsUrl());
    socketRef.current = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token, clientRole: "call-host" }));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!String(payload.type || "").startsWith("CALL_")) return;
        void handleCallSignal(String(payload.type), payload.data || {});
      } catch {}
    };
    return () => {
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [finishCallLocally, handleCallSignal, isAuthenticated, token]);

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
      try { sessionStorage.removeItem("itbird-native-answer-call"); } catch {}
      if (incomingRef.current) void acceptIncoming();
    };

    let pending = false;
    try { pending = sessionStorage.getItem("itbird-native-answer-call") === "1"; } catch {}
    if (pending) acceptFromNativeRuntime();

    window.addEventListener("itbird-native-answer-call", acceptFromNativeRuntime);
    return () => window.removeEventListener("itbird-native-answer-call", acceptFromNativeRuntime);
  }, [acceptIncoming]);

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

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Headphones,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { getWsUrl, readSettings } from "@/lib/settings";
import { getIceServers } from "@/lib/webrtc";
import { createReconnectingWebSocket } from "@/lib/reconnecting-websocket";

type CallMode = "private" | "group";
type CallKind = "voice" | "video";

type CallParticipant = {
  id: number;
  username: string;
  avatar?: string | null;
};

type VoiceCallControlsProps = {
  currentUserId?: number;
  mode: CallMode;
  chatId: number | string;
  title: string;
  participants: CallParticipant[];
};

const iceServers: RTCConfiguration = { iceServers: getIceServers() };

type ActiveCallWindow = typeof window & {
  __itbirdActiveCallEnd?: () => void;
  __itbirdActiveCallToggleMic?: () => void;
  __itbirdActiveCallToggleSound?: () => void;
  __itbirdActiveCallToggleVideo?: () => void;
  __itbirdActiveCallToggleScreen?: () => void;
};

const getGlobalMediaRoot = () => {
  let root = document.getElementById("itbird-global-call-media") as HTMLDivElement | null;
  if (!root) {
    root = document.createElement("div");
    root.id = "itbird-global-call-media";
    root.className = "fixed bottom-[calc(7rem+var(--mobile-safe-bottom))] right-3 z-[60] flex max-w-[calc(100vw-24px)] flex-wrap justify-end gap-2 sm:right-6";
    document.body.appendChild(root);
  }
  return root;
};

const attachMediaElement = (container: HTMLElement, peerId: number, stream: MediaStream, muted: boolean) => {
  // APP_FIX: per-stream-media-elements
  const hasVideo = stream.getVideoTracks().length > 0;
  const streamId = stream.id || `peer-${peerId}-${hasVideo ? 'video' : 'audio'}`;
  const selector = `${hasVideo ? 'video' : 'audio'}[data-peer-id="${peerId}"][data-stream-id="${streamId}"]`;
  let media = container.querySelector<HTMLMediaElement>(selector);

  if (!media) {
    media = document.createElement(hasVideo ? "video" : "audio");
    media.dataset.peerId = String(peerId);
    media.dataset.streamId = streamId;
    media.autoplay = true;
    if (hasVideo) {
      (media as HTMLVideoElement).playsInline = true;
      media.className = "h-28 w-44 rounded-lg bg-black object-cover shadow-xl";
    } else {
      media.className = "hidden";
    }
    container.appendChild(media);
  }

  media.muted = muted;
  media.srcObject = stream;
  const outputId = readSettings().audioOutputDeviceId;
  if (outputId && "setSinkId" in media) {
    (media as HTMLMediaElement & { setSinkId: (sinkId: string) => Promise<void> })
      .setSinkId(outputId)
      .catch(() => undefined);
  }
};

const getMediaErrorMessage = (error: unknown) => {
  if (!window.isSecureContext && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
    return "На телефоне браузер запрашивает микрофон и камеру только через HTTPS или localhost. Откройте сайт по HTTPS, иначе окно разрешения не появится.";
  }

  if (error instanceof DOMException && ["NotAllowedError", "PermissionDeniedError"].includes(error.name)) {
    return "Доступ к микрофону или камере запрещен в браузере. Нажмите на значок замка в адресной строке, разрешите доступ и повторите звонок.";
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "Не найден микрофон или камера. Подключите устройство и повторите звонок.";
  }

  return "Не удалось получить доступ к устройствам. Проверьте разрешения браузера и повторите звонок.";
};

const VoiceCallControls = ({ currentUserId, mode, chatId, title, participants }: VoiceCallControlsProps) => {
  const { toast } = useToast();
  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Record<number, RTCPeerConnection>>({});
  const remoteMediaRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenSendersRef = useRef<Record<number, RTCRtpSender>>({});
  const deviceTestMuteRef = useRef<{ mic: boolean; sound: boolean } | null>(null);
  const isCallingRef = useRef(false);
  const liveCallRef = useRef(false);
  const selfParticipantRef = useRef<CallParticipant | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [callKind, setCallKind] = useState<CallKind>("voice");
  const [micEnabled, setMicEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [selfParticipant, setSelfParticipant] = useState<CallParticipant | null>(null);

  const token = localStorage.getItem("token");
  const callableParticipants = participants.filter((participant) => participant.id !== currentUserId);
  const callTargets = mode === "private" ? callableParticipants.map((participant) => participant.id) : selectedIds;
  const visibleCallParticipants = [
    ...(selfParticipant ? [selfParticipant] : []),
    ...callableParticipants.filter((participant) => callTargets.includes(participant.id)),
  ];

  const getAvatarUrl = (avatar?: string | null) => {
    if (!avatar) return "/images/default-avatar.png";
    if (/^https?:\/\//i.test(avatar)) return avatar;
    return `http://localhost:5000${avatar}`;
  };

  useEffect(() => {
    setSelectedIds(callableParticipants.map((participant) => participant.id));
  }, [participants, currentUserId]);

  useEffect(() => {
    selfParticipantRef.current = selfParticipant;
  }, [selfParticipant]);

  useEffect(() => {
    if (!token || !currentUserId) return;

    fetch("http://localhost:5000/profile", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((profile) => {
        if (!profile) return;
        setSelfParticipant({
          id: currentUserId,
          username: profile.username || "Вы",
          avatar: profile.avatar || null,
        });
      })
      .catch(() => {
        setSelfParticipant((current) => current || { id: currentUserId, username: "Вы" });
      });
  }, [token, currentUserId]);

  const ensureSelfParticipant = async () => {
    if (selfParticipantRef.current) return selfParticipantRef.current;
    if (!token || !currentUserId) return null;

    try {
      const response = await fetch("http://localhost:5000/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("profile");
      const profile = await response.json();
      const participant = {
        id: currentUserId,
        username: profile.username || "Вы",
        avatar: profile.avatar || null,
      };
      selfParticipantRef.current = participant;
      setSelfParticipant(participant);
      return participant;
    } catch {
      const participant = { id: currentUserId, username: "Вы" };
      selfParticipantRef.current = participant;
      setSelfParticipant(participant);
      return participant;
    }
  };

  useEffect(() => {
    isCallingRef.current = isCalling;
  }, [isCalling]);

  // APP_FIX: local-preview-sync
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.play().catch(() => undefined);
    }
    if (localScreenVideoRef.current) {
      localScreenVideoRef.current.srcObject = screenStreamRef.current;
      localScreenVideoRef.current.play().catch(() => undefined);
    }
  }, [isCalling, videoEnabled, screenEnabled]);

  const sendSignal = (type: string, targetIds: number[], data: Record<string, unknown>) => {
    const self = selfParticipantRef.current || selfParticipant;
    const callParticipants = [
      ...(self ? [self] : []),
      ...callableParticipants.filter((participant) => targetIds.includes(participant.id)),
    ];
    socketRef.current?.send(JSON.stringify({
      type,
      targetIds,
      // APP_FIX: explicit-call-kind-wins
      data: { chatId, mode, title, callKind, callerName: self?.username, participants: callParticipants, ...data },
    }));
  };

  const ensureLocalStream = async (kind: CallKind, forceVideoEnabled = videoEnabled) => {
    const settings = readSettings();
    if (!localStreamRef.current) {
      try {
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(settings.microphoneDeviceId ? { deviceId: { exact: settings.microphoneDeviceId } } : {}),
            echoCancellation: settings.noiseSuppressionMode === "krisp",
            noiseSuppression: settings.noiseSuppressionMode === "krisp",
            autoGainControl: settings.noiseSuppressionMode === "krisp",
          },
          video: kind === "video"
            ? settings.cameraDeviceId
              ? { deviceId: { exact: settings.cameraDeviceId } }
              : true
            : false,
        });
      } catch (error) {
        toast({ title: "Ошибка звонка", description: getMediaErrorMessage(error), variant: "destructive" });
        throw error;
      }
    }

    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = micEnabled;
    });
    localStreamRef.current.getVideoTracks().forEach((track) => {
      track.enabled = kind === "video" && forceVideoEnabled;
    });

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }

    return localStreamRef.current;
  };

  const attachRemoteStream = (peerId: number, stream: MediaStream) => {
    if (remoteMediaRef.current) {
      attachMediaElement(remoteMediaRef.current, peerId, stream, !soundEnabled);
    }
    attachMediaElement(getGlobalMediaRoot(), peerId, stream, !soundEnabled);
  };

  const createPeer = async (peerId: number, kind: CallKind) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId];

    // APP_FIX: keep-initial-video-enabled
    const stream = await ensureLocalStream(kind, kind === 'video' ? true : videoEnabled);
    const peer = new RTCPeerConnection(iceServers);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));

    peer.ontrack = (event) => attachRemoteStream(peerId, event.streams[0]);
    peer.onicecandidate = (event) => {
      if (event.candidate) sendSignal("CALL_ICE", [peerId], { candidate: event.candidate });
    };

    peersRef.current[peerId] = peer;
    return peer;
  };

  const startCall = async (targetIds: number[], kind: CallKind) => {
    if (!currentUserId || targetIds.length === 0) return;

    try {
      await ensureSelfParticipant();
      setCallKind(kind);
      const shouldEnableVideo = kind === "video";
      setVideoEnabled(shouldEnableVideo);
      await ensureLocalStream(kind, shouldEnableVideo);
      liveCallRef.current = true;
      setIsCalling(true);
      sendSignal("CALL_INVITE", targetIds, { fromName: title, callKind: kind });

      for (const targetId of targetIds) {
        const peer = await createPeer(targetId, kind);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        sendSignal("CALL_OFFER", [targetId], { description: offer, callKind: kind });
      }

      setShowPicker(false);
    } catch {
      setIsCalling(false);
    }
  };

  const renegotiate = async (targetId: number, nextKind = callKind) => {
    const peer = peersRef.current[targetId];
    if (!peer) return;
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendSignal("CALL_OFFER", [targetId], { description: offer, callKind: nextKind, isRenegotiation: true });
  };

  const toggleMic = () => {
    const next = !micEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicEnabled(next);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    remoteMediaRef.current?.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {
      media.muted = !next;
    });
    getGlobalMediaRoot().querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {
      media.muted = !next;
    });
    setSoundEnabled(next);
  };

  const addCameraTrack = async () => {
    const settings = readSettings();
    const cameraStream = await navigator.mediaDevices.getUserMedia({
      video: settings.cameraDeviceId ? { deviceId: { exact: settings.cameraDeviceId } } : true,
      audio: false,
    });
    const [videoTrack] = cameraStream.getVideoTracks();
    if (!videoTrack) return;

    if (!localStreamRef.current) {
      localStreamRef.current = new MediaStream();
    }

    localStreamRef.current.addTrack(videoTrack);
    Object.values(peersRef.current).forEach((peer) => peer.addTrack(videoTrack, localStreamRef.current as MediaStream));
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  };

  const toggleVideo = async () => {
    const next = !videoEnabled;
    if (next && localStreamRef.current?.getVideoTracks().length === 0) {
      try {
        await addCameraTrack();
        setCallKind("video");
        setVideoEnabled(true);
        await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id), "video")));
      } catch (error) {
        toast({ title: "Ошибка звонка", description: getMediaErrorMessage(error), variant: "destructive" });
      }
      return;
    }

    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setVideoEnabled(next);
    if (next) {
      setCallKind("video");
      await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id), "video")));
    }
  };

  // APP_FIX: removable-screen-track
  const stopScreenShare = async () => {
    const senders = screenSendersRef.current;
    for (const [peerId, sender] of Object.entries(senders)) {
      const peer = peersRef.current[Number(peerId)];
      if (peer && peer.signalingState !== 'closed') {
        try { peer.removeTrack(sender); } catch {}
      }
    }
    screenSendersRef.current = {};
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;
    setScreenEnabled(false);
    await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id))));
  };

  const toggleScreenShare = async () => {
    if (screenEnabled) {
      await stopScreenShare();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const [track] = stream.getVideoTracks();
      if (!track) return;
      screenStreamRef.current = stream;
      screenSendersRef.current = {};

      for (const [peerId, peer] of Object.entries(peersRef.current)) {
        screenSendersRef.current[Number(peerId)] = peer.addTrack(track, stream);
      }

      track.onended = () => { void stopScreenShare(); };
      setScreenEnabled(true);
      if (localScreenVideoRef.current) {
        localScreenVideoRef.current.srcObject = stream;
        localScreenVideoRef.current.play().catch(() => undefined);
      }
      await Promise.all(Object.keys(peersRef.current).map((id) => renegotiate(Number(id))));
    } catch {
      toast({ title: 'Демонстрация экрана', description: 'Не удалось начать демонстрацию экрана', variant: 'destructive' });
    }
  };

  useEffect(() => {
    const handleDeviceTestStart = () => {
      if (!isCalling || deviceTestMuteRef.current) return;
      deviceTestMuteRef.current = { mic: micEnabled, sound: soundEnabled };
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      remoteMediaRef.current?.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {
        media.muted = true;
      });
      setMicEnabled(false);
      setSoundEnabled(false);
    };

    const handleDeviceTestStop = () => {
      const previous = deviceTestMuteRef.current;
      if (!previous) return;
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = previous.mic;
      });
      remoteMediaRef.current?.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {
        media.muted = !previous.sound;
      });
      setMicEnabled(previous.mic);
      setSoundEnabled(previous.sound);
      deviceTestMuteRef.current = null;
    };

    window.addEventListener("itbird-microphone-test-start", handleDeviceTestStart);
    window.addEventListener("itbird-microphone-test-stop", handleDeviceTestStop);

    return () => {
      window.removeEventListener("itbird-microphone-test-start", handleDeviceTestStart);
      window.removeEventListener("itbird-microphone-test-stop", handleDeviceTestStop);
    };
  }, [isCalling, micEnabled, soundEnabled]);

  const endCall = () => {
    liveCallRef.current = false;
    const windowWithCall = window as ActiveCallWindow;
    if (windowWithCall.__itbirdActiveCallEnd === endCall) delete windowWithCall.__itbirdActiveCallEnd;
    delete windowWithCall.__itbirdActiveCallToggleMic;
    delete windowWithCall.__itbirdActiveCallToggleSound;
    delete windowWithCall.__itbirdActiveCallToggleVideo;
    delete windowWithCall.__itbirdActiveCallToggleScreen;
    const targetIds = Object.keys(peersRef.current).map(Number);
    if (targetIds.length > 0) sendSignal("CALL_HANGUP", targetIds, {});
    Object.values(peersRef.current).forEach((peer) => peer.close());
    peersRef.current = {};
    screenSendersRef.current = {};
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    remoteMediaRef.current?.replaceChildren();
    document.getElementById("itbird-global-call-media")?.replaceChildren();
    setIsCalling(false);
    setVideoEnabled(false);
    setScreenEnabled(false);
    window.dispatchEvent(new CustomEvent("itbird-call-ended"));
  };

  useEffect(() => {
    if (!isCalling) return;
    const windowWithCall = window as ActiveCallWindow;
    windowWithCall.__itbirdActiveCallEnd = endCall;
    windowWithCall.__itbirdActiveCallToggleMic = toggleMic;
    windowWithCall.__itbirdActiveCallToggleSound = toggleSound;
    windowWithCall.__itbirdActiveCallToggleVideo = () => {
      void toggleVideo();
    };
    windowWithCall.__itbirdActiveCallToggleScreen = () => {
      void toggleScreenShare();
    };
    window.dispatchEvent(new CustomEvent("itbird-call-active", {
      detail: { chatId, mode, title, callKind, targetIds: callTargets, participants: visibleCallParticipants },
    }));
    return () => {
      if (!isCallingRef.current && windowWithCall.__itbirdActiveCallEnd === endCall) {
        delete windowWithCall.__itbirdActiveCallEnd;
        delete windowWithCall.__itbirdActiveCallToggleMic;
        delete windowWithCall.__itbirdActiveCallToggleSound;
        delete windowWithCall.__itbirdActiveCallToggleVideo;
        delete windowWithCall.__itbirdActiveCallToggleScreen;
      }
    };
  }, [isCalling, chatId, mode, title, callKind, callTargets.join(","), visibleCallParticipants.length, micEnabled, soundEnabled, videoEnabled, screenEnabled]);

  useEffect(() => {
    if (!token || !currentUserId) return;

    const socket = createReconnectingWebSocket(getWsUrl());
    socketRef.current = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token }));
    socket.onmessage = async (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.type?.startsWith("CALL_")) return;

      const data = payload.data || {};
      if (data.senderId === currentUserId) return;
      if (!data.targetIds?.includes(currentUserId)) return;
      if (String(data.chatId) !== String(chatId) || data.mode !== mode) return;

      if (payload.type === "CALL_ACCEPT") {
        liveCallRef.current = true;
        setIsCalling(true);
      }

      if (payload.type === "CALL_ANSWER") {
        const peer = peersRef.current[data.senderId];
        if (peer) await peer.setRemoteDescription(new RTCSessionDescription(data.description));
      }

      if (payload.type === "CALL_OFFER") {
        const peer = peersRef.current[data.senderId];
        if (peer && data.description) {
          liveCallRef.current = true;
          setIsCalling(true);
          await peer.setRemoteDescription(new RTCSessionDescription(data.description));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          sendSignal("CALL_ANSWER", [data.senderId], {
            description: answer,
            callKind: data.callKind || callKind,
            isRenegotiation: true,
          });
        }
      }

      if (payload.type === "CALL_ICE") {
        const peer = peersRef.current[data.senderId];
        if (peer && data.candidate) await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
      }

      if (payload.type === "CALL_HANGUP") {
        endCall();
      }
    };

    return () => {
      if (isCallingRef.current || liveCallRef.current || localStreamRef.current || Object.keys(peersRef.current).length > 0) return;
      socket.close();
      endCall();
    };
  }, [token, currentUserId, chatId, mode]);

  const callButton = (kind: CallKind) => (
    <Button
      variant={kind === "video" ? "outline" : "ghost"}
      size="sm"
      onClick={() => (mode === "group" ? (setCallKind(kind), setShowPicker(true)) : startCall(callTargets, kind))}
      disabled={callableParticipants.length === 0}
      className="gap-2"
      title={kind === "video" ? "Видеозвонок" : "Голосовой звонок"}
    >
      {kind === "video" ? <Video className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
    </Button>
  );

  return (
    <>
      {!isCalling ? (
        <div className="flex items-center gap-1">
          {callButton("voice")}
          {callButton("video")}
        </div>
      ) : (
        <div className="fixed inset-x-0 bottom-[calc(1rem+var(--mobile-safe-bottom))] z-50 mx-auto flex max-h-[calc(var(--app-viewport-height)-2rem-var(--mobile-safe-bottom))] w-[min(760px,calc(100vw-16px))] flex-col items-center gap-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/90 p-3 text-white shadow-2xl sm:w-[min(760px,calc(100vw-24px))] sm:gap-4 sm:p-4">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{title}</div>
              <div className="text-xs text-white/60">{mode === "group" ? "Групповой звонок" : "Личный звонок"}</div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              {visibleCallParticipants.map((participant) => (
                <div key={participant.id} className="flex flex-col items-center gap-1">
                  <img
                    src={getAvatarUrl(participant.avatar)}
                    alt={participant.username}
                    className="h-12 w-12 rounded-full border-2 border-white/20 bg-gray-800 object-cover"
                  />
                  <span className="max-w-16 truncate text-[11px] text-white/70">{participant.username}</span>
                </div>
              ))}
              <div ref={remoteMediaRef} className="flex min-w-0 flex-wrap justify-end gap-2" />
            </div>
          </div>

          {/* APP_FIX: self-video-and-screen-preview */}
          {(videoEnabled || screenEnabled) && (
            <div className="flex w-full flex-wrap justify-center gap-3">
              {videoEnabled && (
                <div className="space-y-1 text-center">
                  <div className="text-[11px] text-white/60">Вы — камера</div>
                  <video ref={localVideoRef} autoPlay muted playsInline className="h-28 w-44 rounded-lg bg-gray-950 object-cover" />
                </div>
              )}
              {screenEnabled && (
                <div className="space-y-1 text-center">
                  <div className="text-[11px] text-white/60">Вы — демонстрация экрана</div>
                  <video ref={localScreenVideoRef} autoPlay muted playsInline className="h-28 w-44 rounded-lg bg-gray-950 object-contain" />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-white/10 bg-white/10">
              <Button variant="ghost" size="sm" onClick={toggleMic} className="rounded-none text-white hover:bg-white/15 hover:text-white">
                {micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4 text-red-300" />}
              </Button>
              <Button variant="ghost" size="sm" className="rounded-none px-2 text-white hover:bg-white/15 hover:text-white">
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex overflow-hidden rounded-lg border border-white/10 bg-white/10">
              <Button variant="ghost" size="sm" onClick={toggleVideo} className="rounded-none text-white hover:bg-white/15 hover:text-white">
                {videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4 text-red-300" />}
              </Button>
              <Button variant="ghost" size="sm" className="rounded-none px-2 text-white hover:bg-white/15 hover:text-white">
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex overflow-hidden rounded-lg border border-white/10 bg-white/10">
              <Button variant="ghost" size="sm" onClick={toggleSound} className="rounded-none text-white hover:bg-white/15 hover:text-white">
                {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-red-300" />}
              </Button>
              <Button variant="ghost" size="sm" className="rounded-none px-2 text-white hover:bg-white/15 hover:text-white">
                <Headphones className="h-4 w-4" />
              </Button>
            </div>

            <Button variant="ghost" size="sm" onClick={toggleScreenShare} className="bg-white/10 text-white hover:bg-white/15 hover:text-white">
              {screenEnabled ? <ScreenShareOff className="h-4 w-4" /> : <ScreenShare className="h-4 w-4" />}
            </Button>

            <Button variant="destructive" size="sm" onClick={endCall} className="px-6">
              <PhoneOff className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={showPicker} onOpenChange={setShowPicker}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {callKind === "video" ? <Video className="h-5 w-5" /> : <Users className="h-5 w-5" />}
              Выберите участников звонка
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {callableParticipants.map((participant) => (
              <label key={participant.id} className="flex items-center gap-3 rounded-md border p-3">
                <Checkbox
                  checked={selectedIds.includes(participant.id)}
                  onCheckedChange={(checked) => {
                    setSelectedIds((prev) =>
                      checked ? [...prev, participant.id] : prev.filter((id) => id !== participant.id)
                    );
                  }}
                />
                <span>{participant.username}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowPicker(false)}>Отмена</Button>
            <Button onClick={() => startCall(callTargets, callKind)} disabled={callTargets.length === 0} className="gap-2">
              <PhoneCall className="h-4 w-4" />
              Позвонить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default VoiceCallControls;

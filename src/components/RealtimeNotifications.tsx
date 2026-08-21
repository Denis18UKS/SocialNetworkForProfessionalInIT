import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { ChevronDown, Headphones, Mic, MicOff, Minus, PhoneCall, PhoneOff, Pin, ScreenShare, ScreenShareOff, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { getWsUrl, readSettings } from "@/lib/settings";
import { getIceServers } from "@/lib/webrtc";
import { createReconnectingWebSocket } from "@/lib/reconnecting-websocket";
import { writeOnlineUserIds } from "@/lib/realtime";
import { useAuth } from "@/pages/AuthContext";

interface DecodedToken {
  id: number;
}

type CallParticipant = {
  id: number;
  username: string;
  avatar?: string | null;
};

type IncomingCall = {
  senderId: number;
  targetIds: number[];
  chatId: number | string;
  mode: "private" | "group";
  title?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  callKind?: "voice" | "video";
  callerName?: string;
  isRenegotiation?: boolean;
  participants?: CallParticipant[];
};

const getMicrophoneErrorMessage = (error: unknown) => {
  if (!window.isSecureContext && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
    return "На телефоне браузер запрашивает микрофон и камеру только через HTTPS или localhost. Откройте сайт по HTTPS, иначе окно разрешения не появится.";
  }

  if (error instanceof DOMException && ["NotAllowedError", "PermissionDeniedError"].includes(error.name)) {
    return "Доступ к микрофону запрещен в браузере. Нажмите на значок замка или микрофона в адресной строке, разрешите доступ и повторите звонок.";
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "Микрофон не найден. Подключите микрофон и повторите звонок.";
  }

  return "Не удалось получить доступ к микрофону. Проверьте разрешения браузера и повторите звонок.";
};

const RealtimeNotifications = () => {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const pathnameRef = useRef(location.pathname);
  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const screenSenderRef = useRef<RTCRtpSender | null>(null);
  const pendingOfferRef = useRef<IncomingCall | null>(null);
  const ringtoneContextRef = useRef<AudioContext | null>(null);
  const ringtoneTimerRef = useRef<number | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCall, setActiveCall] = useState<IncomingCall | null>(null);
  const [offerReady, setOfferReady] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);
  const [panelPinned, setPanelPinned] = useState(true);
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const activeCallRef = useRef<IncomingCall | null>(null);

  const getAvatarUrl = (avatar?: string | null) => {
    if (!avatar) return "/images/default-avatar.png";
    if (/^https?:\/\//i.test(avatar)) return avatar;
    return `http://localhost:5000${avatar}`;
  };

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    const handleLocalCallActive = (event: Event) => {
      const detail = (event as CustomEvent<Partial<IncomingCall> & { targetIds?: number[] }>).detail || {};
      setActiveCall({
        senderId: 0,
        targetIds: detail.targetIds || [],
        chatId: detail.chatId || "",
        mode: detail.mode || "private",
        title: detail.title,
        callKind: detail.callKind || "voice",
        participants: detail.participants || [],
      });
      // APP_FIX: outgoing-call-video-state
      setVideoEnabled(detail.callKind === 'video');
    };

    const handleLocalCallEnded = () => setActiveCall(null);
    window.addEventListener("itbird-call-active", handleLocalCallActive);
    window.addEventListener("itbird-call-ended", handleLocalCallEnded);

    return () => {
      window.removeEventListener("itbird-call-active", handleLocalCallActive);
      window.removeEventListener("itbird-call-ended", handleLocalCallEnded);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !("Notification" in window) || Notification.permission !== "default") return;
    Notification.requestPermission().catch(() => undefined);
  }, [isAuthenticated]);

  const showDesktopNotification = (title: string, body: string, onClick: () => void) => {
    if (!("Notification" in window)) return;
    if (document.visibilityState === "visible") return;
    if (Notification.permission !== "granted") return;

    const notification = new Notification(title, { body, icon: "/favicon.ico", tag: title });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  };

  const playRingtonePulse = (context: AudioContext) => {
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.13, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    gain.connect(context.destination);

    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.16);
      oscillator.connect(gain);
      oscillator.start(now + index * 0.16);
      oscillator.stop(now + index * 0.16 + 0.14);
    });
  };

  const startRingtone = async () => {
    if (ringtoneTimerRef.current !== null) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = ringtoneContextRef.current || new AudioContextClass();
    ringtoneContextRef.current = context;
    if (context.state === "suspended") await context.resume().catch(() => undefined);
    playRingtonePulse(context);
    ringtoneTimerRef.current = window.setInterval(() => playRingtonePulse(context), 1300);
  };

  const stopRingtone = () => {
    if (ringtoneTimerRef.current !== null) {
      window.clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
  };

  const sendCallSignal = (type: string, targetIds: number[], data: Record<string, unknown>) => {
    socketRef.current?.send(JSON.stringify({ type, targetIds, data }));
  };

  const cleanupCall = () => {
    peerRef.current?.close();
    peerRef.current = null;
    pendingIceCandidatesRef.current = [];
    screenSenderRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    remoteAudioRef.current?.replaceChildren();
    pendingOfferRef.current = null;
    setOfferReady(false);
    stopRingtone();
    setIncomingCall(null);
    setActiveCall(null);
    setMicEnabled(true);
    setSoundEnabled(true);
    setVideoEnabled(false);
    setScreenEnabled(false);
    setPanelHidden(false);
  };

  // APP_FIX: incoming-local-preview-sync
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.play().catch(() => undefined);
    }
    if (localScreenVideoRef.current) {
      localScreenVideoRef.current.srcObject = screenStreamRef.current;
      localScreenVideoRef.current.play().catch(() => undefined);
    }
  }, [activeCall, videoEnabled, screenEnabled]);

  const toggleMic = () => {
    if (activeCall?.senderId === 0) {
      (window as typeof window & { __itbirdActiveCallToggleMic?: () => void }).__itbirdActiveCallToggleMic?.();
      setMicEnabled((current) => !current);
      return;
    }

    const next = !micEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicEnabled(next);
  };

  const toggleSound = () => {
    if (activeCall?.senderId === 0) {
      (window as typeof window & { __itbirdActiveCallToggleSound?: () => void }).__itbirdActiveCallToggleSound?.();
      setSoundEnabled((current) => !current);
      return;
    }

    const next = !soundEnabled;
    remoteAudioRef.current?.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {
      media.muted = !next;
    });
    setSoundEnabled(next);
  };

  const renegotiateActivePeer = async () => {
    if (!activeCall?.senderId || !peerRef.current) return;
    const offer = await peerRef.current.createOffer();
    await peerRef.current.setLocalDescription(offer);
    sendCallSignal("CALL_OFFER", [activeCall.senderId], { ...activeCall, description: offer, isRenegotiation: true });
  };

  // APP_FIX: incoming-screen-track-lifecycle
  const stopIncomingScreenShare = async () => {
    if (peerRef.current && screenSenderRef.current && peerRef.current.signalingState !== 'closed') {
      try { peerRef.current.removeTrack(screenSenderRef.current); } catch {}
    }
    screenSenderRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;
    setScreenEnabled(false);
    await renegotiateActivePeer();
  };

  const toggleScreenShare = async () => {
    if (activeCall?.senderId === 0) {
      (window as typeof window & { __itbirdActiveCallToggleScreen?: () => void }).__itbirdActiveCallToggleScreen?.();
      setScreenEnabled((current) => !current);
      return;
    }

    if (screenEnabled) {
      await stopIncomingScreenShare();
      return;
    }

    if (!peerRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const [track] = stream.getVideoTracks();
      if (!track) return;
      screenStreamRef.current = stream;
      screenSenderRef.current = peerRef.current.addTrack(track, stream);
      track.onended = () => { void stopIncomingScreenShare(); };
      setScreenEnabled(true);
      if (localScreenVideoRef.current) {
        localScreenVideoRef.current.srcObject = stream;
        localScreenVideoRef.current.play().catch(() => undefined);
      }
      await renegotiateActivePeer();
    } catch {
      toast({ title: 'Демонстрация экрана', description: 'Не удалось начать демонстрацию экрана', variant: 'destructive' });
    }
  };

  const toggleVideo = async () => {
    if (activeCall?.senderId === 0) {
      (window as typeof window & { __itbirdActiveCallToggleVideo?: () => void }).__itbirdActiveCallToggleVideo?.();
      setVideoEnabled((current) => !current);
      setActiveCall((current) => current ? { ...current, callKind: 'video' } : current);
      return;
    }

    if (!peerRef.current || !localStreamRef.current) return;
    const next = !videoEnabled;
    let videoTracks = localStreamRef.current.getVideoTracks();

    if (next && videoTracks.length === 0) {
      try {
        const settings = readSettings();
        const camera = await navigator.mediaDevices.getUserMedia({
          video: settings.cameraDeviceId ? { deviceId: { exact: settings.cameraDeviceId } } : true,
          audio: false,
        });
        const [track] = camera.getVideoTracks();
        if (!track) return;
        localStreamRef.current.addTrack(track);
        peerRef.current.addTrack(track, localStreamRef.current);
        videoTracks = [track];
        await renegotiateActivePeer();
      } catch (error) {
        toast({ title: 'Камера', description: getMicrophoneErrorMessage(error), variant: 'destructive' });
        return;
      }
    }

    videoTracks.forEach((track) => { track.enabled = next; });
    setVideoEnabled(next);
    if (next) setActiveCall((current) => current ? { ...current, callKind: 'video' } : current);
  };

  const handlePanelPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (panelPinned) return;
    const target = event.currentTarget.parentElement;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    dragOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePanelPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragOffsetRef.current || panelPinned) return;
    setPanelPosition({
      x: Math.max(8, Math.min(window.innerWidth - 120, event.clientX - dragOffsetRef.current.x)),
      y: Math.max(8, Math.min(window.innerHeight - 80, event.clientY - dragOffsetRef.current.y)),
    });
  };

  const handlePanelPointerUp = () => {
    dragOffsetRef.current = null;
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall) return;
    if (!pendingOfferRef.current?.description) {
      toast({ title: "Звонок", description: "Ждем сигнал подключения. Попробуйте нажать еще раз через секунду." });
      return;
    }

    try {
      stopRingtone();
      const settings = readSettings();
      const wantsVideo = incomingCall.callKind === "video";
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(settings.microphoneDeviceId ? { deviceId: { exact: settings.microphoneDeviceId } } : {}),
          echoCancellation: settings.noiseSuppressionMode === "krisp",
          noiseSuppression: settings.noiseSuppressionMode === "krisp",
          autoGainControl: settings.noiseSuppressionMode === "krisp",
        },
        video: wantsVideo
          ? settings.cameraDeviceId
            ? { deviceId: { exact: settings.cameraDeviceId } }
            : true
          : false,
      });
      localStreamRef.current = stream;
      setVideoEnabled(wantsVideo);

      const peer = new RTCPeerConnection({ iceServers: getIceServers() });
      peerRef.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.ontrack = (event) => {
        if (!remoteAudioRef.current) return;
        // APP_FIX: incoming-per-stream-media
        const remoteStream = event.streams[0];
        const hasVideo = remoteStream?.getVideoTracks().length > 0;
        const streamId = remoteStream?.id || (hasVideo ? 'remote-video' : 'remote-audio');
        let media = remoteAudioRef.current.querySelector<HTMLMediaElement>(
          `${hasVideo ? 'video' : 'audio'}[data-call-stream-id="${streamId}"]`
        );
        if (!media) {
          media = document.createElement(hasVideo ? "video" : "audio");
          media.dataset.callMedia = 'remote';
          media.dataset.callStreamId = streamId;
          media.autoplay = true;
          if (hasVideo) {
            (media as HTMLVideoElement).playsInline = true;
            media.className = "mt-3 h-28 w-44 rounded-lg bg-black object-cover";
          } else {
            media.className = "hidden";
          }
          remoteAudioRef.current.appendChild(media);
        }
        media.srcObject = remoteStream;
      };
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          sendCallSignal("CALL_ICE", [incomingCall.senderId], { ...incomingCall, candidate: event.candidate });
        }
      };

      await peer.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current.description));
      // APP_FIX: flush-pending-ice
      for (const candidate of pendingIceCandidatesRef.current.splice(0)) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
      }
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendCallSignal("CALL_ACCEPT", [incomingCall.senderId], incomingCall);
      sendCallSignal("CALL_ANSWER", [incomingCall.senderId], { ...incomingCall, description: answer });
      setActiveCall(incomingCall);
      setIncomingCall(null);
    } catch (error) {
      toast({ title: "Доступ к микрофону", description: getMicrophoneErrorMessage(error), variant: "destructive" });
      cleanupCall();
    }
  };

  const declineIncomingCall = () => {
    (window as typeof window & { __itbirdActiveCallEnd?: () => void }).__itbirdActiveCallEnd?.();
    if (incomingCall) sendCallSignal("CALL_HANGUP", [incomingCall.senderId], incomingCall);
    if (activeCall?.senderId) sendCallSignal("CALL_HANGUP", [activeCall.senderId], activeCall);
    cleanupCall();
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!isAuthenticated || !token) return;

    let currentUserId: number;
    try {
      currentUserId = jwtDecode<DecodedToken>(token).id;
    } catch {
      return;
    }

    const socket = createReconnectingWebSocket(getWsUrl());
    socketRef.current = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "AUTH", token }));
    };

    socket.onmessage = (event) => {
      const notification = JSON.parse(event.data);

      if (notification.type === "ONLINE_USERS" || notification.type === "USER_PRESENCE") {
        writeOnlineUserIds(notification.data.userIds || []);
      }

      if (notification.type === "NEW_MESSAGE") {
        const message = notification.data;
        if (message.user_id === currentUserId) return;
        if (!message.recipientIds?.includes(currentUserId)) return;
        if (pathnameRef.current === `/chats/${message.chat_id}`) return;
        const title = "Новое личное сообщение";
        const description = `${message.username || "Пользователь"}: ${message.message || "Файл"}`;
        const openChat = () => navigate(`/chats/${message.chat_id}`);
        toast({ title, description, action: <ToastAction altText="Открыть чат" onClick={openChat}>Открыть</ToastAction> });
        showDesktopNotification(title, description, openChat);
      }

      if (notification.type === "NEW_GROUP_MESSAGE") {
        const message = notification.data;
        if (message.user_id === currentUserId) return;
        if (!message.recipientIds?.includes(currentUserId)) return;
        if (message.mentionRecipientIds?.includes(currentUserId)) return;
        if (pathnameRef.current === `/group-chats/${message.group_chat_id}`) return;
        const title = "Новое сообщение в группе";
        const description = `${message.username || "Участник"}: ${message.message || "Файл"}`;
        const openChat = () => navigate(`/group-chats/${message.group_chat_id}`);
        toast({ title, description, action: <ToastAction altText="Открыть чат" onClick={openChat}>Открыть</ToastAction> });
        showDesktopNotification(title, description, openChat);
      }

      if (notification.type === "GROUP_MENTION") {
        const message = notification.data;
        if (message.user_id === currentUserId) return;
        if (!message.recipientIds?.includes(currentUserId)) return;
        const title = message.mentionEveryone ? "Упоминание @everyone" : "Вас упомянули";
        const description = `${message.username || "Участник"}: ${message.message || "Файл"}`;
        const openChat = () => navigate(`/group-chats/${message.group_chat_id}`);
        toast({ title, description, action: <ToastAction altText="Открыть чат" onClick={openChat}>Открыть</ToastAction> });
        showDesktopNotification(title, description, openChat);
      }

      if (notification.type === "NEW_FORUM_ANSWER") {
        const answer = notification.data;
        if (answer.user_id === currentUserId) return;
        if (!answer.recipientIds?.includes(currentUserId)) return;
        const title = "Форум";
        const description = `Вам пришел ответ на вопрос: ${answer.forumTitle || "ваш вопрос"}`;
        const openQuestion = () => navigate(`/forums/${answer.forum_id}/answers`);
        toast({ title, description, action: <ToastAction altText="Открыть вопрос" onClick={openQuestion}>Открыть</ToastAction> });
        showDesktopNotification(title, description, openQuestion);
      }

      if (notification.type === "FRIEND_REQUEST_CREATED") {
        const payload = notification.data;
        if (payload.recipientId !== currentUserId && !payload.recipientIds?.includes(currentUserId)) return;
        if (pathnameRef.current === "/friend-requests") return;
        const request = payload.request || {};
        const title = "Новая заявка в друзья";
        const description = `${request.user_name || "Пользователь"} хочет добавить вас в друзья`;
        const openRequests = () => navigate("/friend-requests");
        toast({ title, description, action: <ToastAction altText="Открыть заявки" onClick={openRequests}>Открыть</ToastAction> });
        showDesktopNotification(title, description, openRequests);
      }

      // APP_FIX: friendship-live-update
      if (notification.type === 'FRIENDSHIP_CHANGED') {
        const payload = notification.data || {};
        if (payload.targetIds?.includes(currentUserId)) {
          window.dispatchEvent(new CustomEvent('itbird-friendship-changed', { detail: payload }));
        }
      }

      if (notification.type === "NEW_GROUP_CHAT" || notification.type === "NEW_GROUP_MEMBER") {
        const payload = notification.data || {};
        const memberIds = payload.memberIds || [];
        if (!memberIds.includes(currentUserId)) return;
        const chat = payload.chat || {};
        if (pathnameRef.current === `/group-chats/${chat.id || payload.chatId}`) return;
        const title = "Вас добавили в группу";
        const description = chat.name ? `Группа: ${chat.name}` : "Откройте групповые чаты, чтобы посмотреть новую группу";
        const openGroup = () => navigate(`/group-chats/${chat.id || payload.chatId || ""}`.replace(/\/$/, ""));
        toast({ title, description, action: <ToastAction altText="Открыть группу" onClick={openGroup}>Открыть</ToastAction> });
        showDesktopNotification(title, description, openGroup);
      }

      if (notification.type === "CALL_INVITE") {
        const call = notification.data as IncomingCall;
        if (call.senderId === currentUserId) return;
        if (!call.targetIds?.includes(currentUserId)) return;
        const active = activeCallRef.current;
        if (active && String(active.chatId) === String(call.chatId) && active.mode === call.mode) return;
        setOfferReady(false);
        setIncomingCall(call);
        startRingtone();
      }

      if (notification.type === "CALL_OFFER") {
        const call = notification.data as IncomingCall;
        if (call.senderId === currentUserId) return;
        if (!call.targetIds?.includes(currentUserId)) return;
        const active = activeCallRef.current;
        const sameActiveCall = active && String(active.chatId) === String(call.chatId) && active.mode === call.mode;
        if (sameActiveCall && peerRef.current && call.description) {
          peerRef.current.setRemoteDescription(new RTCSessionDescription(call.description))
            .then(() => peerRef.current?.createAnswer())
            .then(async (answer) => {
              if (!answer || !peerRef.current) return;
              await peerRef.current.setLocalDescription(answer);
              sendCallSignal("CALL_ANSWER", [call.senderId], { ...call, description: answer });
            })
            .catch(() => undefined);
          return;
        }
        if (call.isRenegotiation || sameActiveCall) return;
        pendingOfferRef.current = call;
        setOfferReady(true);
        setIncomingCall((prev) => ({ ...(prev || call), ...call }));
        startRingtone();
      }

      if (notification.type === "CALL_ICE") {
        const call = notification.data as IncomingCall;
        if (call.senderId === currentUserId) return;
        if (!call.targetIds?.includes(currentUserId)) return;
        // APP_FIX: queue-early-ice
        if (call.candidate) {
          if (peerRef.current?.remoteDescription) {
            peerRef.current.addIceCandidate(new RTCIceCandidate(call.candidate)).catch(() => undefined);
          } else {
            pendingIceCandidatesRef.current.push(call.candidate);
          }
        }
      }

      if (notification.type === "CALL_ANSWER") {
        const call = notification.data as IncomingCall;
        if (call.senderId === currentUserId) return;
        if (!call.targetIds?.includes(currentUserId)) return;
        if (peerRef.current && call.description) {
          peerRef.current.setRemoteDescription(new RTCSessionDescription(call.description)).catch(() => undefined);
        }
      }

      if (notification.type === "CALL_HANGUP") {
        const call = notification.data as IncomingCall;
        if (call.senderId === currentUserId) return;
        if (!call.targetIds?.includes(currentUserId)) return;
        cleanupCall();
      }
    };

    return () => {
      socket.close();
      cleanupCall();
      ringtoneContextRef.current?.close().catch(() => undefined);
      ringtoneContextRef.current = null;
    };
  }, [isAuthenticated, navigate, toast]);

  const activeParticipants = activeCall?.participants?.length
    ? [
        ...(!activeCall.participants.some((participant) => participant.id === activeCall.senderId) && activeCall.senderId
          ? [{ id: activeCall.senderId, username: activeCall.callerName || "Собеседник" }]
          : []),
        ...activeCall.participants,
      ]
    : [{ id: 0, username: activeCall?.title || "Участник" }];

  return (
    <>
      <div
        ref={remoteAudioRef}
        className={activeCall && !panelHidden ? "fixed bottom-[calc(7rem+var(--mobile-safe-bottom))] right-3 z-50 flex max-w-[calc(100vw-24px)] flex-wrap justify-end gap-2 sm:right-6" : "hidden"}
      />
      {activeCall && panelHidden && (
        <Button
          className="fixed bottom-[calc(1rem+var(--mobile-safe-bottom))] right-4 z-50 rounded-full bg-black/90 text-white hover:bg-black"
          onClick={() => setPanelHidden(false)}
        >
          Вернуть звонок
        </Button>
      )}
      {activeCall && (
        activeCall.senderId !== 0 ||
        pathnameRef.current !== (activeCall.mode === "group" ? `/group-chats/${activeCall.chatId}` : `/chats/${activeCall.chatId}`)
      ) && !panelHidden && (
        <div
          className={`${panelPosition ? "fixed" : "fixed inset-x-2 bottom-[calc(1rem+var(--mobile-safe-bottom))] mx-auto"} z-50 flex max-h-[calc(var(--app-viewport-height)-2rem-var(--mobile-safe-bottom))] w-[min(760px,calc(100vw-16px))] flex-col gap-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/95 p-3 text-white shadow-2xl sm:inset-x-4 sm:w-[min(760px,calc(100vw-24px))] sm:gap-5 sm:p-4`}
          style={panelPosition ? { left: panelPosition.x, top: panelPosition.y } : undefined}
        >
          <div
            className={`flex items-start justify-between gap-4 ${panelPinned ? "" : "cursor-move"}`}
            onPointerDown={handlePanelPointerDown}
            onPointerMove={handlePanelPointerMove}
            onPointerUp={handlePanelPointerUp}
          >
            <div className="min-w-0 pt-5">
              <div className="truncate text-sm font-semibold">{activeCall.title || "Звонок"}</div>
              <div className="text-xs text-white/60">
                {activeCall.mode === "group" ? "Групповой звонок" : "Личный звонок"}
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-start justify-end gap-3">
              {activeParticipants.map((participant) => (
                <div key={participant.id || participant.username} className="flex flex-col items-center gap-1">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/30 bg-white/90">
                    <img
                      src={getAvatarUrl(participant.avatar)}
                      alt={participant.username}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  </div>
                  <span className="max-w-24 truncate text-xs text-white/70">{participant.username}</span>
                </div>
              ))}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-white hover:bg-white/15 hover:text-white" onClick={() => setPanelHidden(true)}>
                <Minus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-white hover:bg-white/15 hover:text-white"
                onClick={() => {
                  setPanelPinned((current) => !current);
                  if (!panelPinned) setPanelPosition(null);
                }}
              >
                <Pin className={`h-4 w-4 ${panelPinned ? "text-purple-300" : ""}`} />
              </Button>
            </div>
          </div>

          {/* APP_FIX: incoming-self-preview-ui */}
          {(videoEnabled || screenEnabled) && activeCall.senderId !== 0 && (
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

          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/5 pt-5">
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
                <Video className={`h-4 w-4 ${activeCall.callKind === "video" ? "" : "text-white/35"}`} />
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

            <Button variant="destructive" size="sm" onClick={declineIncomingCall} className="px-6">
              <PhoneOff className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={Boolean(incomingCall)} onOpenChange={(open) => !open && declineIncomingCall()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Входящий {incomingCall?.callKind === "video" ? "видеозвонок" : "голосовой звонок"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {incomingCall?.title || (incomingCall?.mode === "group" ? "Групповой звонок" : "Личный звонок")}
            {!offerReady && <span className="mt-1 block text-xs">Подключение подготавливается...</span>}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={declineIncomingCall} className="gap-2">
              <PhoneOff className="h-4 w-4" />
              Отклонить
            </Button>
            <Button onClick={acceptIncomingCall} className="gap-2">
              <PhoneCall className="h-4 w-4" />
              Ответить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default RealtimeNotifications;

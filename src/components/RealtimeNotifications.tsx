import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { PhoneCall, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { getWsUrl } from "@/lib/settings";
import { writeOnlineUserIds } from "@/lib/realtime";
import { useAuth } from "@/pages/AuthContext";

interface DecodedToken {
  id: number;
}

type IncomingCall = {
  senderId: number;
  targetIds: number[];
  chatId: number | string;
  mode: "private" | "group";
  title?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const getMicrophoneErrorMessage = (error: unknown) => {
  if (error instanceof DOMException && ["NotAllowedError", "PermissionDeniedError"].includes(error.name)) {
    return "Доступ к микрофону запрещен в браузере. Нажмите на значок замка/микрофона в адресной строке, разрешите микрофон для localhost и повторите звонок.";
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
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLDivElement | null>(null);
  const pendingOfferRef = useRef<IncomingCall | null>(null);
  const ringtoneContextRef = useRef<AudioContext | null>(null);
  const ringtoneTimerRef = useRef<number | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [offerReady, setOfferReady] = useState(false);

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!isAuthenticated || !("Notification" in window) || Notification.permission !== "default") return;
    Notification.requestPermission().catch(() => {});
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
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteAudioRef.current?.replaceChildren();
    pendingOfferRef.current = null;
    setOfferReady(false);
    stopRingtone();
    setIncomingCall(null);
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall || !pendingOfferRef.current?.description) return;

    try {
      stopRingtone();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      peerRef.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.ontrack = (event) => {
        if (!remoteAudioRef.current) return;
        let audio = remoteAudioRef.current.querySelector<HTMLAudioElement>("audio[data-call-audio='remote']");
        if (!audio) {
          audio = document.createElement("audio");
          audio.dataset.callAudio = "remote";
          audio.autoplay = true;
          remoteAudioRef.current.appendChild(audio);
        }
        audio.srcObject = event.streams[0];
      };
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          sendCallSignal("CALL_ICE", [incomingCall.senderId], {
            ...incomingCall,
            candidate: event.candidate,
          });
        }
      };

      await peer.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current.description));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendCallSignal("CALL_ACCEPT", [incomingCall.senderId], incomingCall);
      sendCallSignal("CALL_ANSWER", [incomingCall.senderId], { ...incomingCall, description: answer });
      setIncomingCall(null);
    } catch (error) {
      toast({ title: "Доступ к микрофону", description: getMicrophoneErrorMessage(error), variant: "destructive" });
      cleanupCall();
    }
  };

  const declineIncomingCall = () => {
    if (incomingCall) sendCallSignal("CALL_HANGUP", [incomingCall.senderId], incomingCall);
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

    const socket = new WebSocket(getWsUrl());
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

        toast({
          title,
          description,
          action: <ToastAction altText="Открыть чат" onClick={openChat}>Открыть</ToastAction>,
        });
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

        toast({
          title,
          description,
          action: <ToastAction altText="Открыть чат" onClick={openChat}>Открыть</ToastAction>,
        });
        showDesktopNotification(title, description, openChat);
      }

      if (notification.type === "GROUP_MENTION") {
        const message = notification.data;
        if (message.user_id === currentUserId) return;
        if (!message.recipientIds?.includes(currentUserId)) return;
        const title = message.mentionEveryone ? "Упоминание @everyone" : "Вас упомянули";
        const description = `${message.username || "Участник"}: ${message.message || "Файл"}`;
        const openChat = () => navigate(`/group-chats/${message.group_chat_id}`);

        toast({
          title,
          description,
          action: <ToastAction altText="Открыть чат" onClick={openChat}>Открыть</ToastAction>,
        });
        showDesktopNotification(title, description, openChat);
      }

      if (notification.type === "NEW_FORUM_ANSWER") {
        const answer = notification.data;
        if (answer.user_id === currentUserId) return;
        if (!answer.recipientIds?.includes(currentUserId)) return;
        const title = "Форум";
        const description = `Вам пришёл ответ на вопрос: ${answer.forumTitle || "ваш вопрос"}`;
        const openQuestion = () => navigate(`/forums/${answer.forum_id}/answers`);

        toast({
          title,
          description,
          action: <ToastAction altText="Открыть вопрос" onClick={openQuestion}>Открыть</ToastAction>,
        });
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

        toast({
          title,
          description,
          action: <ToastAction altText="Открыть заявки" onClick={openRequests}>Открыть</ToastAction>,
        });
        showDesktopNotification(title, description, openRequests);
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

        toast({
          title,
          description,
          action: <ToastAction altText="Открыть группу" onClick={openGroup}>Открыть</ToastAction>,
        });
        showDesktopNotification(title, description, openGroup);
      }

      if (notification.type === "CALL_INVITE") {
        const call = notification.data as IncomingCall;
        if (call.senderId === currentUserId) return;
        if (!call.targetIds?.includes(currentUserId)) return;
        setOfferReady(false);
        setIncomingCall(call);
        startRingtone();
      }

      if (notification.type === "CALL_OFFER") {
        const call = notification.data as IncomingCall;
        if (call.senderId === currentUserId) return;
        if (!call.targetIds?.includes(currentUserId)) return;
        pendingOfferRef.current = call;
        setOfferReady(true);
        setIncomingCall((prev) => ({ ...(prev || call), ...call }));
        startRingtone();
      }

      if (notification.type === "CALL_ICE") {
        const call = notification.data as IncomingCall;
        if (call.senderId === currentUserId) return;
        if (!call.targetIds?.includes(currentUserId)) return;
        if (peerRef.current && call.candidate) {
          peerRef.current.addIceCandidate(new RTCIceCandidate(call.candidate)).catch(() => undefined);
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

  return (
    <>
      <div ref={remoteAudioRef} className="hidden" />
      <Dialog open={Boolean(incomingCall)} onOpenChange={(open) => !open && declineIncomingCall()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Входящий голосовой звонок</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {incomingCall?.title || (incomingCall?.mode === "group" ? "Групповой звонок" : "Личный звонок")}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={declineIncomingCall} className="gap-2">
              <PhoneOff className="h-4 w-4" />
              Отклонить
            </Button>
            <Button onClick={acceptIncomingCall} className="gap-2" disabled={!offerReady}>
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

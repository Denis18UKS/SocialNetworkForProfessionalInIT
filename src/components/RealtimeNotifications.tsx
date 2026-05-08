import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { getWsUrl } from "@/lib/settings";
import { writeOnlineUserIds } from "@/lib/realtime";
import { useAuth } from "@/pages/AuthContext";

interface DecodedToken {
  id: number;
}

const RealtimeNotifications = () => {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const pathnameRef = useRef(location.pathname);

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

    const notification = new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: title,
    });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
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
          action: (
            <ToastAction altText="Открыть чат" onClick={openChat}>
              Открыть
            </ToastAction>
          ),
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
          action: (
            <ToastAction altText="Открыть чат" onClick={openChat}>
              Открыть
            </ToastAction>
          ),
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
          action: (
            <ToastAction altText="Открыть чат" onClick={openChat}>
              Открыть
            </ToastAction>
          ),
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
          action: (
            <ToastAction altText="Открыть вопрос" onClick={openQuestion}>
              Открыть
            </ToastAction>
          ),
        });
        showDesktopNotification(title, description, openQuestion);
      }
    };

    return () => socket.close();
  }, [isAuthenticated, navigate, toast]);

  return null;
};

export default RealtimeNotifications;

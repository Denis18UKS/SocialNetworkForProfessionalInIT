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

        toast({
          title: "Новое личное сообщение",
          description: `${message.username || "Пользователь"}: ${message.message || "Файл"}`,
          action: (
            <ToastAction altText="Открыть чат" onClick={() => navigate(`/chats/${message.chat_id}`)}>
              Открыть
            </ToastAction>
          ),
        });
      }

      if (notification.type === "NEW_GROUP_MESSAGE") {
        const message = notification.data;
        if (message.user_id === currentUserId) return;
        if (!message.recipientIds?.includes(currentUserId)) return;
        if (pathnameRef.current === `/group-chats/${message.group_chat_id}`) return;

        toast({
          title: "Новое сообщение в группе",
          description: `${message.username || "Участник"}: ${message.message || "Файл"}`,
          action: (
            <ToastAction altText="Открыть чат" onClick={() => navigate(`/group-chats/${message.group_chat_id}`)}>
              Открыть
            </ToastAction>
          ),
        });
      }
    };

    return () => socket.close();
  }, [isAuthenticated, navigate, toast]);

  return null;
};

export default RealtimeNotifications;

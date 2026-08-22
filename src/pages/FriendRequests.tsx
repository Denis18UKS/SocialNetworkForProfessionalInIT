import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, UserPlus, UserX } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { motion } from "framer-motion";
import { jwtDecode } from "jwt-decode";
import { getWsUrl } from "@/lib/settings";
import { useI18n } from "@/lib/i18n";

interface FriendRequest {
    id: number;
    user_id: number;
    friend_id: number;
    status: string;
    created_at: string;
    friend: {
        username: string;
        avatar?: string | null;
    };
}

interface DecodedToken {
    id: number;
}

const FriendRequests = () => {
    const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { toast } = useToast();
    const { t } = useI18n();

    const formatRequest = (req: any, index: number): FriendRequest => ({
        id: req.id || req.user_id || index,
        user_id: req.user_id,
        friend_id: req.friend_id,
        status: req.status,
        created_at: req.created_at || "",
        friend: {
            username: req.user_name || req.friend_name || "User",
            avatar: req.avatar || null,
        },
    });

    useEffect(() => {
        const fetchFriendRequests = async () => {
            const token = localStorage.getItem("token");
            if (!token) {
                setIsLoading(false);
                setError("Вы не авторизованы. Пожалуйста, войдите в систему.");
                return;
            }

            try {
                const response = await fetch("http://localhost:5000/friend-requests", {
                    headers: { "Authorization": `Bearer ${token}` },
                });

                if (response.status === 500) {
                    setError("Функция друзей временно недоступна. Обратитесь к администратору.");
                    setIsLoading(false);
                    return;
                }

                if (!response.ok) throw new Error(`Ошибка: ${response.status}`);
                const data = await response.json();
                if (!Array.isArray(data)) throw new Error("Неверная структура данных");
                setFriendRequests(data.map(formatRequest));
            } catch (error) {
                console.error("Ошибка загрузки заявок:", error);
                setError("Не удалось загрузить заявки в друзья. Попробуйте позже.");
                toast({ title: "Ошибка", description: "Не удалось загрузить заявки", variant: "destructive" });
            } finally {
                setIsLoading(false);
            }
        };

        void fetchFriendRequests();
    }, [toast]);

    useEffect(() => {
        const token = localStorage.getItem("token");
        if (!token) return;

        let currentUserId: number | null = null;
        try {
            currentUserId = jwtDecode<DecodedToken>(token).id;
        } catch {
            return;
        }

        const socket = new WebSocket(getWsUrl());
        socket.onopen = () => socket.send(JSON.stringify({ type: "AUTH", token }));
        socket.onmessage = (event) => {
            const notification = JSON.parse(event.data);
            if (notification.type !== "FRIEND_REQUEST_CREATED") return;
            if (notification.data.recipientId !== currentUserId && !notification.data.recipientIds?.includes(currentUserId)) return;

            const incomingRequest = formatRequest(notification.data.request, Date.now());
            setFriendRequests((prev) => {
                if (prev.some((request) => request.user_id === incomingRequest.user_id)) return prev;
                return [incomingRequest, ...prev];
            });

            toast({
                title: "Новая заявка в друзья",
                description: `${incomingRequest.friend.username} хочет добавить вас в друзья`,
            });
        };

        return () => socket.close();
    }, [toast]);

    const handleAcceptRequest = async (friendId: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;
        try {
            const response = await fetch(`http://localhost:5000/friend-requests/accept/${friendId}`, {
                method: "PATCH",
                headers: { "Authorization": `Bearer ${token}` },
            });
            if (!response.ok) throw new Error(`Ошибка принятия: ${response.status}`);
            setFriendRequests(prev => prev.filter(req => req.user_id !== friendId));
            toast({ title: t("friendRequestAccepted"), description: "Вы стали друзьями!" });
        } catch (error) {
            console.error("Ошибка принятия заявки:", error);
            toast({ title: "Ошибка", description: "Не удалось принять заявку", variant: "destructive" });
        }
    };

    const handleRejectRequest = async (friendId: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;
        try {
            const response = await fetch(`http://localhost:5000/friend-requests/reject/${friendId}`, {
                method: "PATCH",
                headers: { "Authorization": `Bearer ${token}` },
            });
            if (!response.ok) throw new Error(`Ошибка отклонения: ${response.status}`);
            setFriendRequests(prev => prev.filter(req => req.user_id !== friendId));
            toast({ title: t("friendRequestRejected"), description: "", variant: "destructive" });
        } catch (error) {
            console.error("Ошибка отклонения заявки:", error);
            toast({ title: "Ошибка", description: "Не удалось отклонить заявку", variant: "destructive" });
        }
    };

    return (
        <div className="min-h-full w-full min-w-0 overflow-x-hidden bg-gray-50 p-0 dark:bg-gray-900 sm:p-2 lg:p-4">
            <div className="mx-auto w-full min-w-0 max-w-4xl">
                <Card className="w-full min-w-0 overflow-hidden shadow-lg">
                    <CardHeader className="min-w-0 border-b px-3 py-4 sm:px-6">
                        <CardTitle className="flex min-w-0 items-center gap-2 text-xl sm:text-2xl">
                            <UserPlus className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
                            <span className="min-w-0 break-words">{t("friendRequests")}</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="min-w-0 p-0">
                        {isLoading ? (
                            <div className="p-6 text-center text-sm text-muted-foreground">...</div>
                        ) : error ? (
                            <div className="p-4 text-center text-sm text-destructive sm:p-6">{error}</div>
                        ) : friendRequests.length === 0 ? (
                            <div className="p-6 text-center text-gray-500 dark:text-gray-400 sm:p-8">
                                <AlertTriangle className="mx-auto mb-3 h-10 w-10 sm:h-12 sm:w-12" />
                                <p className="text-base sm:text-lg">{t("friendRequestsEmpty")}</p>
                            </div>
                        ) : (
                            <ul className="min-w-0 divide-y divide-gray-200 dark:divide-gray-700">
                                {friendRequests.map((request) => (
                                    <motion.li
                                        key={request.user_id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="min-w-0 p-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 sm:p-4"
                                    >
                                        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1">
                                                <Avatar className="h-10 w-10 shrink-0 sm:h-11 sm:w-11">
                                                    {request.friend.avatar && <AvatarImage src={`http://localhost:5000${request.friend.avatar}`} />}
                                                    <AvatarFallback>{request.friend.username.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="min-w-0 flex-1">
                                                    <p className="min-w-0 break-words font-medium leading-tight sm:truncate">{request.friend.username}</p>
                                                </div>
                                            </div>
                                            <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0">
                                                <Button
                                                    size="sm"
                                                    className="min-w-0 w-full gap-1 bg-green-600 px-2 hover:bg-green-700 sm:w-auto sm:px-3"
                                                    onClick={() => handleAcceptRequest(request.user_id)}
                                                >
                                                    <UserPlus className="h-4 w-4 shrink-0" />
                                                    <span className="truncate">{t("friendRequestAccept")}</span>
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    className="min-w-0 w-full gap-1 px-2 sm:w-auto sm:px-3"
                                                    onClick={() => handleRejectRequest(request.user_id)}
                                                >
                                                    <UserX className="h-4 w-4 shrink-0" />
                                                    <span className="truncate">{t("friendRequestReject")}</span>
                                                </Button>
                                            </div>
                                        </div>
                                    </motion.li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default FriendRequests;

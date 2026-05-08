import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, UserPlus, UserX } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { motion } from "framer-motion";
import { jwtDecode } from "jwt-decode";
import { getWsUrl } from "@/lib/settings";

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
    const navigate = useNavigate();

    const formatRequest = (req: any, index: number): FriendRequest => ({
        id: req.id || req.user_id || index,
        user_id: req.user_id,
        friend_id: req.friend_id,
        status: req.status,
        created_at: req.created_at || "",
        friend: {
            username: req.user_name || req.friend_name,
            avatar: req.avatar || null,
        },
    });

    useEffect(() => {
        const fetchFriendRequests = async () => {
            const token = localStorage.getItem("token");
            if (!token) {
                console.error("Нет токена!");
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
                console.log("Ответ сервера:", data);

                if (!Array.isArray(data)) {
                    throw new Error("Неверная структура данных");
                }

                const formattedRequests = data.map(formatRequest);

                setFriendRequests(formattedRequests);
                setIsLoading(false);
            } catch (error) {
                console.error("Ошибка загрузки заявок:", error);
                setError("Не удалось загрузить заявки в друзья. Попробуйте позже.");
                setIsLoading(false);
                toast({
                    title: "Ошибка",
                    description: "Не удалось загрузить заявки",
                    variant: "destructive",
                });
            }
        };

        fetchFriendRequests();
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

        socket.onmessage = (event) => {
            const notification = JSON.parse(event.data);
            if (notification.type !== "FRIEND_REQUEST_CREATED") return;
            if (notification.data.recipientId !== currentUserId) return;

            const incomingRequest = formatRequest(notification.data.request, Date.now());
            setFriendRequests((prev) => {
                if (prev.some((request) => request.user_id === incomingRequest.user_id)) {
                    return prev;
                }
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
            toast({
                title: "Заявка принята",
                description: "Вы стали друзьями!",
                variant: "default",
            });
        } catch (error) {
            console.error("Ошибка принятия заявки:", error);
            toast({
                title: "Ошибка",
                description: "Не удалось принять заявку",
                variant: "destructive",
            });
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
            toast({
                title: "Заявка отклонена",
                description: "Вы отклонили заявку на дружбу.",
                variant: "destructive",
            });
        } catch (error) {
            console.error("Ошибка отклонения заявки:", error);
            toast({
                title: "Ошибка",
                description: "Не удалось отклонить заявку",
                variant: "destructive",
            });
        }
    };

    const goBackToProfile = () => {
        navigate("/profile");
    };

    return (
        <div className="min-h-full bg-gray-50 p-0 dark:bg-gray-900 sm:p-2 lg:p-4">
            <div className="max-w-4xl mx-auto">
                <Card className="shadow-lg">
                    <CardHeader className="border-b">
                        <CardTitle className="text-2xl flex items-center gap-2">
                            <UserPlus className="w-6 h-6" />
                            Заявки в друзья
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        {friendRequests.length === 0 ? (
                            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                                <AlertTriangle className="mx-auto h-12 w-12 mb-4" />
                                <p className="text-lg">Нет новых заявок</p>
                            </div>
                        ) : (
                            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                                {friendRequests.map((request) => (
                                    <motion.li
                                        key={request.user_id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                        <Avatar>
                            {request.friend.avatar && (
                                <AvatarImage src={`http://localhost:5000${request.friend.avatar}`} />
                            )}
                            <AvatarFallback>
                                                        {request.friend.username.charAt(0)}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <p className="font-medium">{request.friend.username}</p>
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    className="gap-1 bg-green-600 hover:bg-green-700"
                                                    onClick={() => handleAcceptRequest(request.user_id)}
                                                >
                                                    <UserPlus className="h-4 w-4" />
                                                    Принять
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    className="gap-1"
                                                    onClick={() => handleRejectRequest(request.user_id)}
                                                >
                                                    <UserX className="h-4 w-4" />
                                                    Отклонить
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

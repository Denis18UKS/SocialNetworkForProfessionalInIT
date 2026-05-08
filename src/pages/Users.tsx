import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { jwtDecode as jwt_decode } from "jwt-decode";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { Search, UserPlus, User, Clock } from "lucide-react";
import { readOnlineUserIds, subscribeOnlineUserIds } from "@/lib/realtime";

interface User {
    id: number;
    username: string;
    github_username: string;
    avatar: string | null;
    skills: string | null;
    friendshipStatus: "none" | "pending" | "accepted" | "declined";
    isOnline?: boolean;
}

const Users: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterNoSkills, setFilterNoSkills] = useState(false);
    const navigate = useNavigate();
    const { toast } = useToast();

    useEffect(() => {
        const fetchUsers = async () => {
            const token = localStorage.getItem("token");
            if (!token) {
                toast({
                    title: "Ошибка",
                    description: "Токен не найден, необходима авторизация",
                    variant: "destructive",
                });
                navigate("/login");
                return;
            }

            try {
                const response = await fetch("http://localhost:5000/users", {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                if (!response.ok) {
                    const data = await response.json();
                    toast({
                        title: "Ошибка",
                        description: data.message || "Ошибка при получении пользователей",
                        variant: "destructive",
                    });
                    setUsers([]);
                    setLoading(false);
                    return;
                }

                const data = await response.json();
                const decodedToken: any = jwt_decode(token);
                const currentUserId = decodedToken.id;

                const currentOnlineUserIds = readOnlineUserIds();
                setUsers(data
                    .filter((user: User) => user.id !== currentUserId)
                    .map((user: User) => ({ ...user, isOnline: currentOnlineUserIds.includes(user.id) }))
                );
                setLoading(false);
            } catch (error) {
                toast({
                    title: "Ошибка",
                    description: "Ошибка при загрузке пользователей",
                    variant: "destructive",
                });
                setUsers([]);
                setLoading(false);
            }
        };

        fetchUsers();
    }, [navigate, toast]);

    useEffect(() => {
        const applyOnlineUsers = (userIds: number[]) => {
            setUsers(prev => prev.map(user => ({ ...user, isOnline: userIds.includes(user.id) })));
        };

        applyOnlineUsers(readOnlineUserIds());
        return subscribeOnlineUserIds(applyOnlineUsers);
    }, []);

    const filteredUsers = users.filter((user) => {
        const matchesSearch =
            user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (user.skills && user.skills.toLowerCase().includes(searchQuery.toLowerCase()));

        const matchesSkillsFilter = filterNoSkills ? user.skills !== null && user.skills.trim() !== "" : true;

        return matchesSearch && matchesSkillsFilter;
    });

    const openProfile = (username: string) => {
        navigate(`/users-profiles/${username}`);
    };

    const addFriend = async (userId: number) => {
        try {
            const token = localStorage.getItem("token");
            const response = await fetch("http://localhost:5000/add-friend", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ friendId: userId }),
            });

            if (!response.ok) {
                const data = await response.json();
                toast({
                    title: "Ошибка",
                    description: data.message || "Не удалось добавить в друзья",
                    variant: "destructive",
                });
                return;
            }

            setUsers((prevUsers) =>
                prevUsers.map((user) =>
                    user.id === userId ? { ...user, friendshipStatus: "pending" } : user
                )
            );

            toast({
                title: "Успех",
                description: "Заявка в друзья отправлена",
            });
        } catch (error) {
            toast({
                title: "Ошибка",
                description: "Ошибка при добавлении в друзья",
                variant: "destructive",
            });
        }
    };

    return (
        <div className="min-h-full bg-gray-50 px-0 py-4 dark:bg-gray-900 sm:px-4 sm:py-6 lg:px-8">
            <div className="max-w-4xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="mb-8"
                >
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Пользователи</h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Найдите других участников и добавьте их в друзья
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                    className="space-y-6"
                >
                    {/* Search and Filter */}
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                            <Input
                                type="text"
                                className="pl-10 pr-4 py-2 w-full"
                                placeholder="Поиск по имени или навыкам..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center">
                            <label className="inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={filterNoSkills}
                                    onChange={() => setFilterNoSkills(!filterNoSkills)}
                                />
                                <div className={`relative w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-[#6E59A5]`}></div>
                                <span className="ms-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Только с навыками
                                </span>
                            </label>
                        </div>
                    </div>

                    {/* Users List */}
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#6E59A5]"></div>
                        </div>
                    ) : filteredUsers.length > 0 ? (
                        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
                            {filteredUsers.map((user) => (
                                <motion.div
                                    key={user.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden border border-gray-200 dark:border-gray-700"
                                >
                                    <div className="p-5">
                                        <div className="flex items-start space-x-4">
                                            <div className="relative">
                                                <img
                                                    src={user.avatar ? `http://localhost:5000${user.avatar}` : "/images/default-avatar.png"}
                                                    alt={user.username}
                                                    className="w-14 h-14 rounded-full object-cover border-2 border-[#6E59A5]/20"
                                                />
                                                <span className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-gray-800 ${user.isOnline ? "bg-green-500" : "bg-gray-400"}`} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                                                    {user.username}
                                                </h3>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    {user.isOnline ? "Онлайн" : "Оффлайн"}
                                                </p>
                                                <p className={`text-sm ${user.skills ? "text-[#6E59A5] dark:text-[#9b87f5]" : "text-gray-500 dark:text-gray-400"}`}>
                                                    {user.skills || "Навыки не указаны"}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="mt-4 flex flex-wrap gap-2">
                                            <Button
                                                variant="outline"
                                                className="border-[#6E59A5] text-[#6E59A5] hover:bg-[#6E59A5]/10"
                                                onClick={() => openProfile(user.username)}
                                            >
                                                <User className="h-4 w-4 mr-2" />
                                                Профиль
                                            </Button>
                                            
                                            {user.friendshipStatus === "none" ? (
                                                <Button
                                                    className="bg-[#6E59A5] hover:bg-[#5a4a8a]"
                                                    onClick={() => addFriend(user.id)}
                                                >
                                                    <UserPlus className="h-4 w-4 mr-2" />
                                                    Добавить
                                                </Button>
                                            ) : user.friendshipStatus === "pending" ? (
                                                <Button
                                                    variant="outline"
                                                    className="text-gray-500 dark:text-gray-400"
                                                    disabled
                                                >
                                                    <Clock className="h-4 w-4 mr-2" />
                                                    Заявка отправлена
                                                </Button>
                                            ) : null}
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    ) : (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-center py-12"
                        >
                            <div className="bg-gray-100 dark:bg-gray-800 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                                Пользователи не найдены
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400 mt-1">
                                Попробуйте изменить параметры поиска
                            </p>
                        </motion.div>
                    )}
                </motion.div>
            </div>
        </div>
    );
};

export default Users;

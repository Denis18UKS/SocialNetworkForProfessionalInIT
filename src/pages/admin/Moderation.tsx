import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { motion } from "framer-motion";
import { Check, X, Trash2, Search } from "lucide-react";

interface ModerationItem {
    id: number;
    title: string;
    description: string;
    user: string;
    status: "ожидание" | "принят" | "отклонен";
    created_at: string;
    image_url?: string | null;
}

const statusBadgeVariants = {
    ожидание: "bg-yellow-100 text-yellow-800",
    принят: "bg-green-100 text-green-800",
    отклонен: "bg-red-100 text-red-800",
};

const ModerationPage = () => {
    const [news, setNews] = useState<ModerationItem[]>([]);
    const [posts, setPosts] = useState<ModerationItem[]>([]);
    const [loading, setLoading] = useState({
        news: false,
        posts: false,
    });
    const [filters, setFilters] = useState({
        search: "",
        status: "все" as "все" | "ожидание" | "принят" | "отклонен",
    });
    const [pagination, setPagination] = useState({
        news: 1,
        posts: 1,
    });
    const itemsPerPage = 6;
    const { toast } = useToast();

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading({ news: false, posts: true });

            const postsRes = await fetch("http://localhost:5000/admin/posts", {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("token")}`
                }
            });

            const postsData = await postsRes.json();

            setPosts(Array.isArray(postsData) ? postsData : []);
        } catch (error) {
            toast({
                title: "Ошибка загрузки",
                description: "Не удалось загрузить данные для модерации",
                variant: "destructive",
            });
        } finally {
            setLoading({ news: false, posts: false });
        }
    };

    const handleStatusChange = async (
        id: number,
        type: "news" | "posts",
        newStatus: "принят" | "отклонен"
    ) => {
        try {
            const res = await fetch(
                `http://localhost:5000/admin/${type}/${id}/status`,
                {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ status: newStatus }),
                }
            );

            if (!res.ok) throw new Error();

            if (type === "news") {
                setNews(prev =>
                    prev.map(item =>
                        item.id === id ? { ...item, status: newStatus } : item
                    )
                );
            } else {
                setPosts(prev =>
                    prev.map(item =>
                        item.id === id ? { ...item, status: newStatus } : item
                    )
                );
            }

            toast({
                title: "Статус изменен",
                description: `Запись ${newStatus === "принят" ? "одобрена" : "отклонена"}`,
            });
        } catch (error) {
            toast({
                title: "Ошибка",
                description: "Не удалось изменить статус",
                variant: "destructive",
            });
        }
    };

    const handleDelete = async (id: number, type: "news" | "posts") => {
        try {
            const res = await fetch(
                `http://localhost:5000/admin/${type}/${id}`,
                {
                    method: "DELETE",
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`,
                    },
                }
            );

            if (!res.ok) throw new Error();

            if (type === "news") {
                setNews(prev => prev.filter(item => item.id !== id));
            } else {
                setPosts(prev => prev.filter(item => item.id !== id));
            }

            toast({
                title: "Удалено",
                description: "Запись успешно удалена",
            });
        } catch (error) {
            toast({
                title: "Ошибка",
                description: "Не удалось удалить запись",
                variant: "destructive",
            });
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString("ru-RU", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const filterItems = (items: ModerationItem[]) => {
        return items
            .filter(item => {
                const matchesSearch =
                    item.title.toLowerCase().includes(filters.search.toLowerCase()) ||
                    item.user.toLowerCase().includes(filters.search.toLowerCase());
                const matchesStatus =
                    filters.status === "все" || item.status === filters.status;
                return matchesSearch && matchesStatus;
            })
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    };

    const renderContentSection = (
        items: ModerationItem[],
        type: "news" | "posts",
        isLoading: boolean
    ) => {
        const filteredItems = filterItems(items);
        const paginatedItems = filteredItems.slice(
            (pagination[type] - 1) * itemsPerPage,
            pagination[type] * itemsPerPage
        );

        if (isLoading) {
            return (
                <div className="flex justify-center items-center h-32">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400" />
                </div>
            );
        }

        if (filteredItems.length === 0) {
            return (
                <div className="py-8 text-center text-gray-500">
                    Нет данных для отображения
                </div>
            );
        }

        return (
            <>
                <div className="rounded-lg border shadow-sm overflow-hidden">
                    <Table>
                        <TableHeader className="bg-gray-50 dark:bg-gray-800">
                            <TableRow>
                                <TableHead className="w-[100px]">ID</TableHead>
                                <TableHead>Изображение</TableHead>
                                <TableHead>Заголовок</TableHead>
                                <TableHead>Автор</TableHead>
                                <TableHead>Статус</TableHead>
                                <TableHead>Дата</TableHead>
                                <TableHead className="text-right">Действия</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paginatedItems.map(item => (
                                <TableRow key={item.id} className="hover:bg-gray-50">
                                    <TableCell className="font-medium">{item.id}</TableCell>
                                    <TableCell>
                                        {item.image_url && item.image_url !== "null" ? (
                                            <img
                                                src={`http://localhost:5000${item.image_url}`}
                                                alt={item.title}
                                                className="h-12 w-12 object-cover rounded"
                                            />
                                        ) : (
                                            <span className="text-gray-400">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="font-medium line-clamp-1">{item.title}</div>
                                        <div className="text-sm text-gray-500 line-clamp-1">
                                            {item.description}
                                        </div>
                                    </TableCell>
                                    <TableCell>{item.user}</TableCell>
                                    <TableCell>
                                        <Badge className={statusBadgeVariants[item.status]}>
                                            {item.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{formatDate(item.created_at)}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            {item.status === "ожидание" ? (
                                                <>
                                                    <Button
                                                        size="sm"
                                                        onClick={() => handleStatusChange(item.id, type, "принят")}
                                                    >
                                                        <Check className="h-4 w-4 mr-1" />
                                                        Принять
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="destructive"
                                                        onClick={() => handleStatusChange(item.id, type, "отклонен")}
                                                    >
                                                        <X className="h-4 w-4 mr-1" />
                                                        Отклонить
                                                    </Button>
                                                </>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    onClick={() => handleDelete(item.id, type)}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-1" />
                                                    Удалить
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                <CardFooter className="flex justify-between items-center">
                    <div className="text-sm text-gray-500">
                        Показано {paginatedItems.length} из {filteredItems.length} записей
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                setPagination(prev => ({
                                    ...prev,
                                    [type]: Math.max(1, prev[type] - 1)
                                }))
                            }
                            disabled={pagination[type] === 1}
                        >
                            Назад
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                setPagination(prev => ({
                                    ...prev,
                                    [type]: prev[type] + 1
                                }))
                            }
                            disabled={pagination[type] * itemsPerPage >= filteredItems.length}
                        >
                            Вперед
                        </Button>
                    </div>
                </CardFooter>
            </>
        );
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="container mx-auto py-6 space-y-6"
        >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <h1 className="text-2xl font-bold">Модерация контента</h1>

                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Поиск..."
                            className="pl-9"
                            value={filters.search}
                            onChange={(e) =>
                                setFilters({ ...filters, search: e.target.value })
                            }
                        />
                    </div>

                    <Select
                        value={filters.status}
                        onValueChange={(value) =>
                            setFilters({ ...filters, status: value as any })
                        }
                    >
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Статус" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="все">Все статусы</SelectItem>
                            <SelectItem value="ожидание">Ожидание</SelectItem>
                            <SelectItem value="принят">Принятые</SelectItem>
                            <SelectItem value="отклонен">Отклонённые</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>


            <Card>
                <CardHeader>
                    <CardTitle>Посты на модерации</CardTitle>
                </CardHeader>
                <CardContent>
                    {renderContentSection(posts, "posts", loading.posts)}
                </CardContent>
            </Card>
        </motion.div>
    );
};

export default ModerationPage;

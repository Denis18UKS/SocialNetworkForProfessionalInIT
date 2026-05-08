import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useNavigate, useParams } from "react-router-dom";
import { MessageSquare, Plus, Check, ChevronLeft } from "lucide-react";
import { useAuth } from "@/pages/AuthContext";
import { motion } from "framer-motion";
import CodeSnippet, { extractCodeBlocks, textWithoutCodeBlocks } from "@/components/CodeSnippet";

interface Question {
    id: number;
    title: string;
    description: string;
    status: string;
    created_at: string;
    user: string;
    user_id: number;
}

const Forum = () => {
    const [questions, setQuestions] = useState<Question[]>([]);
    const [showAddQuestionModal, setShowAddQuestionModal] = useState(false);
    const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
    const [newQuestion, setNewQuestion] = useState({ title: '', description: '' });
    const { toast } = useToast();
    const { isAuthenticated } = useAuth();
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('userId');
    const navigate = useNavigate();

    const getUserFromToken = () => {
        if (!token) return null;
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(
                atob(base64).split('').map(c =>
                    '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                ).join('')
            );
            return JSON.parse(jsonPayload);
        } catch (error) {
            console.error('Error decoding token:', error);
            return null;
        }
    };

    const currentUser = getUserFromToken();
    const renderTextWithCode = (text = "", source = "forum") => {
        const codeBlocks = extractCodeBlocks(text);
        const plainText = textWithoutCodeBlocks(text);

        return (
            <div className="space-y-4">
                {plainText && <p className="whitespace-pre-wrap">{plainText}</p>}
                {codeBlocks.map((block) => (
                    <CodeSnippet
                        key={`${source}-${block.index}`}
                        code={block.code}
                        language={block.language}
                        source={`${source}-${block.index}`}
                    />
                ))}
            </div>
        );
    };

    const canResolveQuestion = (question: Question) =>
        question.status !== 'решён' &&
        isAuthenticated &&
        currentUser &&
        (currentUser.role === 'admin' || currentUser.id === question.user_id);

    const fetchQuestions = async () => {
        try {
            const response = await fetch('http://localhost:5000/forums');
            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
            const data = await response.json();
            setQuestions(data);
        } catch (error) {
            toast({
                title: "Ошибка",
                description: "Не удалось загрузить вопросы",
                variant: "destructive"
            });
        }
    };

    const addQuestion = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newQuestion.title.trim() || !newQuestion.description.trim()) {
            toast({
                title: "Ошибка",
                description: "Пожалуйста, заполните все поля",
                variant: "destructive"
            });
            return;
        }

        if (!isAuthenticated || !token) {
            toast({
                title: "Ошибка",
                description: "Вы должны быть авторизованы",
                variant: "destructive"
            });
            return;
        }

        const currentUserId = userId || currentUser?.id?.toString();
        if (!currentUserId) {
            toast({
                title: "Ошибка",
                description: "Не удалось идентифицировать пользователя",
                variant: "destructive"
            });
            return;
        }

        try {
            const response = await fetch('http://localhost:5000/forums', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    title: newQuestion.title,
                    description: newQuestion.description,
                    user_id: currentUserId,
                }),
            });

            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

            const newQuestionFromDB = await response.json();
            setQuestions(prev => [...prev, newQuestionFromDB]);
            setShowAddQuestionModal(false);
            setNewQuestion({ title: '', description: '' });
            toast({
                title: "Успешно",
                description: "Вопрос успешно создан"
            });
        } catch (error) {
            toast({
                title: "Ошибка",
                description: error instanceof Error ? error.message : "Не удалось создать вопрос",
                variant: "destructive"
            });
        }
    };

    const handleCloseQuestion = async (questionId: number) => {
        if (!isAuthenticated || !token) {
            toast({
                title: "Ошибка",
                description: "Вы должны быть авторизованы",
                variant: "destructive"
            });
            return;
        }

        try {
            const response = await fetch(`http://localhost:5000/forums/${questionId}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ status: 'решён' }),
            });

            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

            setQuestions(prev =>
                prev.map(q =>
                    q.id === questionId ? { ...q, status: 'решён' } : q
                )
            );
            toast({
                title: "Успешно",
                description: "Вопрос помечен как решённый"
            });
        } catch (error) {
            toast({
                title: "Ошибка",
                description: error instanceof Error ? error.message : "Не удалось обновить статус вопроса",
                variant: "destructive"
            });
        }
    };

    useEffect(() => {
        fetchQuestions();
    }, []);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
            <div className="max-w-6xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <Button
                        variant="ghost"
                        onClick={() => navigate(-1)}
                        className="gap-1"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Назад
                    </Button>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <MessageSquare className="w-8 h-8" />
                        Форум
                    </h1>
                    <Button
                        onClick={() => setShowAddQuestionModal(true)}
                        className="gap-1"
                    >
                        <Plus className="w-4 h-4" />
                        Новый вопрос
                    </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {questions.map((q) => (
                        <motion.div
                            key={q.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <Card 
                                className="h-full flex flex-col hover:shadow-lg transition-shadow cursor-pointer"
                                onClick={() => setSelectedQuestion(q)}
                            >
                                <CardHeader>
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="text-lg line-clamp-2">
                                            {q.title}
                                        </CardTitle>
                                        <Badge
                                            variant={q.status === 'решён' ? 'default' : 'outline'}
                                            className={`ml-2 ${q.status === 'решён'
                                                ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200'
                                                : ''
                                                }`}
                                        >
                                            {q.status}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="flex-grow">
                                    <div className="mb-4 line-clamp-3 text-gray-600 dark:text-gray-300">
                                        {textWithoutCodeBlocks(q.description) || q.description}
                                    </div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                        <p>Автор: {q.user || 'Аноним'}</p>
                                        <p>Дата: {new Date(q.created_at).toLocaleDateString()}</p>
                                    </div>
                                </CardContent>
                                <div className="px-6 pb-4 flex gap-2">
                                    <Button
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigate(`/forums/${q.id}/answers`);
                                        }}
                                    >
                                        Посмотреть ответы
                                    </Button>
                                    {canResolveQuestion(q) && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleCloseQuestion(q.id);
                                            }}
                                            className="gap-1"
                                        >
                                            <Check className="w-4 h-4" />
                                            Пометить как решённый
                                        </Button>
                                    )}
                                </div>
                            </Card>
                        </motion.div>
                    ))}
                </div>

                {/* Модальное окно просмотра вопроса */}
                <Dialog open={!!selectedQuestion} onOpenChange={(open) => !open && setSelectedQuestion(null)}>
                    <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="text-2xl">{selectedQuestion?.title}</DialogTitle>
                            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mt-2">
                                <span>Автор: {selectedQuestion?.user || 'Аноним'}</span>
                                <span>•</span>
                                <span>
                                    {selectedQuestion && new Date(selectedQuestion.created_at).toLocaleDateString()}
                                </span>
                                <Badge
                                    variant={selectedQuestion?.status === 'решён' ? 'default' : 'outline'}
                                    className={`ml-2 ${selectedQuestion?.status === 'решён'
                                        ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200'
                                        : ''
                                        }`}
                                >
                                    {selectedQuestion?.status}
                                </Badge>
                            </div>
                        </DialogHeader>
                        <div className="prose dark:prose-invert max-w-none">
                            {renderTextWithCode(selectedQuestion?.description || "", `forum-question-${selectedQuestion?.id}`)}
                        </div>
                        <div className="flex gap-2 mt-4">
                            <Button
                                onClick={() => selectedQuestion && navigate(`/forums/${selectedQuestion.id}/answers`)}
                            >
                                Посмотреть ответы
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setSelectedQuestion(null)}
                            >
                                Закрыть
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Модальное окно добавления вопроса */}
                <Dialog open={showAddQuestionModal} onOpenChange={setShowAddQuestionModal}>
                    <DialogContent className="sm:max-w-[600px]">
                        <DialogHeader>
                            <DialogTitle className="text-xl">Новый вопрос</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={addQuestion}>
                            <div className="space-y-4">
                                <div>
                                    <Label>Тема вопроса</Label>
                                    <Input
                                        value={newQuestion.title}
                                        onChange={(e) => setNewQuestion({
                                            ...newQuestion,
                                            title: e.target.value
                                        })}
                                        placeholder="Кратко опишите ваш вопрос"
                                        required
                                    />
                                </div>
                                <div>
                                    <Label>Подробное описание</Label>
                                    <Textarea
                                        value={newQuestion.description}
                                        onChange={(e) => setNewQuestion({
                                            ...newQuestion,
                                            description: e.target.value
                                        })}
                                        rows={5}
                                        placeholder="Укажите как можно больше деталей..."
                                        required
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-6">
                                <Button
                                    variant="outline"
                                    type="button"
                                    onClick={() => setShowAddQuestionModal(false)}
                                >
                                    Отмена
                                </Button>
                                <Button type="submit">Опубликовать вопрос</Button>
                            </div>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
};

export default Forum;

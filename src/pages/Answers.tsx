import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from "@/components/ui/use-toast";
import { MessageSquare, Send, ChevronLeft, Reply, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import CodeSnippet, { extractCodeBlocks, textWithoutCodeBlocks } from "@/components/CodeSnippet";

interface Answer {
    id: number;
    answer: string;
    user: string;
    user_id: number;
    created_at: string;
    comments?: Comment[];
}

interface Comment {
    id: number;
    comment: string;
    user: string;
    user_id: number;
    created_at: string;
    is_deleted?: boolean;
}

const Answers = () => {
    const { id: forumId } = useParams<{ id: string }>();
    const [answers, setAnswers] = useState<Answer[]>([]);
    const [newAnswer, setNewAnswer] = useState('');
    const [newComment, setNewComment] = useState<{ text: string, answerId: number | null }>({ text: '', answerId: null });
    const [showAddAnswerModal, setShowAddAnswerModal] = useState(false);
    const [showAddCommentModal, setShowAddCommentModal] = useState(false);
    const [question, setQuestion] = useState<{ title: string, user: string, status?: string } | null>(null);
    const { toast } = useToast();
    const navigate = useNavigate();
    const { t } = useI18n();
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('userId');
    const username = localStorage.getItem('username') || 'You';
    const isQuestionSolved = question?.status === "\u0440\u0435\u0448\u0451\u043d";

    const renderTextWithCode = (text = "", source = "forum-answer") => {
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

    const fetchAnswers = async () => {
        try {
            // Fetch question details
            const questionRes = await fetch(`http://localhost:5000/forums/${forumId}`);
            if (!questionRes.ok) throw new Error('Failed to fetch question');
            const questionData = await questionRes.json();
            setQuestion(questionData);

            // Fetch answers
            const answersRes = await fetch(`http://localhost:5000/forums/${forumId}/answers`);
            if (!answersRes.ok) throw new Error('Failed to fetch answers');
            const answersData = await answersRes.json();

            // Fetch comments for each answer
            const answersWithComments = await Promise.all(
                answersData.map(async (answer: Answer) => {
                    const commentsRes = await fetch(`http://localhost:5000/answers/${answer.id}/comments`);
                    if (!commentsRes.ok) throw new Error('Failed to fetch comments');
                    const comments = await commentsRes.json();
                    return { ...answer, comments };
                })
            );

            setAnswers(answersWithComments);
        } catch (error) {
            toast({
                title: "Error",
                description: error.message,
                variant: "destructive"
            });
        }
    };

    const addAnswer = async () => {
        if (!newAnswer.trim()) {
            toast({
                title: "Error",
                description: "Answer cannot be empty",
                variant: "destructive"
            });
            return;
        }

        if (!token || !userId) {
            toast({
                title: "Error",
                description: "You must be logged in",
                variant: "destructive"
            });
            return;
        }

        try {
            const response = await fetch(`http://localhost:5000/forums/${forumId}/answers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    answer: newAnswer,
                }),
            });

            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

            const newAnswerFromDB = await response.json();
            setAnswers(prev => [...prev, {
                ...newAnswerFromDB,
                user: username,
                user_id: Number(userId),
                comments: []
            }]);
            setNewAnswer('');
            setShowAddAnswerModal(false);
            toast({
                title: "Успешно",
                description: "Ответ был успешно добавлен",
            });
        } catch (error) {
            toast({
                title: "Ошибка",
                description: error.message || "Не удалось добавить ответ",
                variant: "destructive"
            });
        }
    };

    const addComment = async () => {
        if (!newComment.text.trim() || !newComment.answerId) {
            toast({
                title: "Error",
                description: "Comment cannot be empty",
                variant: "destructive"
            });
            return;
        }

        if (!token || !userId) {
            toast({
                title: "Error",
                description: "You must be logged in",
                variant: "destructive"
            });
            return;
        }

        try {
            const response = await fetch(`http://localhost:5000/answers/${newComment.answerId}/comments`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    comment: newComment.text,
                }),
            });

            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

            const newCommentFromDB = await response.json();

            setAnswers(prev => prev.map(answer => {
                if (answer.id === newComment.answerId) {
                    return {
                        ...answer,
                        comments: [...(answer.comments || []), newCommentFromDB]
                    };
                }
                return answer;
            }));

            setNewComment({ text: '', answerId: null });
            setShowAddCommentModal(false);
            toast({
                title: "Успешно",
                description: "Комментарий добавлен",
            });
        } catch (error) {
            toast({
                title: "Ошибка",
                description: error.message || "Не удалось добавить комментарий",
                variant: "destructive"
            });
        }
    };

    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    useEffect(() => {
        fetchAnswers();
    }, [forumId]);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
            <div className="max-w-3xl mx-auto space-y-6">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate(-1)}
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <MessageSquare className="w-6 h-6" />
                            Ответы
                        </h1>
                        {question && (
                            <p className="text-gray-600 dark:text-gray-400">
                                Вопрос: "{question.title}"
                            </p>
                        )}
                    </div>
                </div>

                <div className="space-y-6">
                    {answers.length > 0 ? (
                        answers.map((answer, index) => (
                            <motion.div
                                key={answer.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 }}
                            >
                                <Card className="shadow-sm">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center gap-3">
                                            <Avatar className="w-8 h-8">
                                                <AvatarFallback>
                                                    {answer.user?.charAt(0) || 'A'}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-start">
                                                    <p className="font-medium">{answer.user}</p>
                                                    <Badge variant="outline" className="text-xs">
                                                        {formatDateTime(answer.created_at)}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="mb-4 text-gray-800 dark:text-gray-200">
                                            {renderTextWithCode(answer.answer, `forum-answer-${answer.id}`)}
                                        </div>

                                        {/* Комментарии к ответу */}
                                        {answer.comments && answer.comments.length > 0 && (
                                            <div className="mt-4 border-t pt-4 space-y-4">
                                                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                                    <Reply className="w-4 h-4" />
                                                    Комментарии ({answer.comments.length})
                                                </h3>
                                                <div className="space-y-3 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
                                                    {answer.comments.map(comment => (
                                                        <div key={comment.id} className="group relative hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded-lg transition-colors">
                                                            <div className="flex items-start gap-2">
                                                                <Avatar className="w-6 h-6 mt-1">
                                                                    <AvatarFallback>
                                                                        {comment.user?.charAt(0) || 'C'}
                                                                    </AvatarFallback>
                                                                </Avatar>
                                                                <div className="flex-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <p className="text-sm font-medium">{comment.user}</p>
                                                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                                                            {formatDateTime(comment.created_at)}
                                                                        </span>
                                                                    </div>
                                                                    <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                                                                        {renderTextWithCode(comment.comment, `forum-comment-${comment.id}`)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="mt-3 gap-1 text-sm"
                                            onClick={() => {
                                                setNewComment({ text: '', answerId: answer.id });
                                                setShowAddCommentModal(true);
                                            }}
                                        >
                                            <Reply className="w-4 h-4" />
                                            Добавить комментарий
                                        </Button>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        ))
                    ) : (
                        <Card className="text-center p-8">
                            <div className="text-gray-500 dark:text-gray-400">
                                <MessageSquare className="mx-auto h-10 w-10 mb-4" />
                                <p className="text-lg">Пока нет ответов</p>
                                <p className="text-sm">Будьте первым, кто ответит на этот вопрос!</p>
                            </div>
                        </Card>
                    )}
                </div>

                {!isQuestionSolved ? (
                    <Button
                        className="w-full gap-2"
                        onClick={() => setShowAddAnswerModal(true)}
                    >
                        <Send className="w-4 h-4" />
                        {t("addAnswer")}
                    </Button>
                ) : (
                    <Card className="p-4 text-center text-sm text-muted-foreground">
                        {t("solvedQuestionNoAnswers")}
                    </Card>
                )}

                {/* Модальное окно для добавления ответа */}
                <Dialog open={showAddAnswerModal} onOpenChange={setShowAddAnswerModal}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Ваш ответ</DialogTitle>
                        </DialogHeader>
                        <Textarea
                            value={newAnswer}
                            onChange={(e) => setNewAnswer(e.target.value)}
                            placeholder="Напишите ваш ответ здесь..."
                            rows={8}
                            className="min-h-[200px] text-base"
                        />
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setShowAddAnswerModal(false)}
                            >
                                Отмена
                            </Button>
                            <Button onClick={addAnswer}>Опубликовать ответ</Button>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Модальное окно для добавления комментария */}
                <Dialog open={showAddCommentModal} onOpenChange={setShowAddCommentModal}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Добавить комментарий</DialogTitle>
                        </DialogHeader>
                        <Textarea
                            value={newComment.text}
                            onChange={(e) => setNewComment({ ...newComment, text: e.target.value })}
                            placeholder="Напишите ваш комментарий здесь..."
                            rows={4}
                            className="min-h-[100px] text-base"
                        />
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setShowAddCommentModal(false)}
                            >
                                Отмена
                            </Button>
                            <Button onClick={addComment}>Опубликовать комментарий</Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
};

export default Answers;

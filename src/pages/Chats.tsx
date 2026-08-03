import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    FileIcon,
    FileImageIcon,
    FileVideoIcon,
    FileAudioIcon,
    FileTextIcon,
    FileArchiveIcon,
    FileCheckIcon,
    SendHorizonal,
    Paperclip,
    Trash2,
    Pin,
    PinOff,
    Ban,
    Eraser,
    ChevronLeft,
    ChevronUp,
    MoreVertical,
    X
} from 'lucide-react';
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import { getWsUrl, readSettings } from "@/lib/settings";
import { createReconnectingWebSocket } from "@/lib/reconnecting-websocket";
import { readOnlineUserIds, subscribeOnlineUserIds, writeOnlineUserIds } from "@/lib/realtime";
import VoiceCallControls from "@/components/VoiceCallControls";
import VoiceMessageBubble from "@/components/VoiceMessageBubble";

import { Smile, Mic } from 'lucide-react';
import EmojiPicker, { EmojiClickData } from 'emoji-picker-react';

interface User {
    id: number;
    username: string;
    avatar: string;
    isFriend: boolean;
    isOnline?: boolean;
}

interface Message {
    id: number;
    chat_id: number;
    user_id: number;
    message: string;
    created_at: string;
    username: string;
    read: boolean;
    media?: string;
    file_name?: string;
    file_path?: string;
    file_size?: string;
    is_pinned?: boolean | number;
    self_pinned?: boolean | number;
    duration?: number; // Добавляем поле для длительности
}

interface DecodedToken {
    id: number;
    username: string;
}

type SpeechRecognitionLike = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start: () => void;
    stop: () => void;
    abort: () => void;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: Event) => void) | null;
};

type SpeechRecognitionEventLike = {
    resultIndex: number;
    results: ArrayLike<{
        isFinal: boolean;
        0: { transcript: string };
    }>;
};

const getSpeechRecognition = () => {
    const speechWindow = window as typeof window & {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
};

const Chats = () => {

    const [socket, setSocket] = useState<WebSocket | null>(null);

    const { chatId } = useParams<{ chatId: string }>();
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [users, setUsers] = useState<User[]>([]);
    const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentUser, setCurrentUser] = useState<DecodedToken | null>(null);
    const [unreadMessagesCount, setUnreadMessagesCount] = useState<{ [key: number]: number }>({});
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const navigate = useNavigate();
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});

    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<Blob[]>([]);
    const recordingCancelledRef = useRef(false);
    const sendVoiceMessageRef = useRef<(file: File) => void>(() => undefined);
    const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const voiceTranscriptRef = useRef("");
    const [recordingTime, setRecordingTime] = useState(0);
    const [showCancelRecording, setShowCancelRecording] = useState(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const [showDeleteOptions, setShowDeleteOptions] = useState(false);
    const [messageToDelete, setMessageToDelete] = useState<Message | null>(null);
    const [translatedMessages, setTranslatedMessages] = useState<Record<number, string>>({});
    const [messageTranscriptions, setMessageTranscriptions] = useState<Record<number, string>>({});
    const [translationSettingsVersion, setTranslationSettingsVersion] = useState(0);
    const [revealedVoiceTextIds, setRevealedVoiceTextIds] = useState<Record<number, boolean>>({});
    const [onlineUserIds, setOnlineUserIds] = useState<number[]>(readOnlineUserIds);
    const [isSelectedUserBlocked, setIsSelectedUserBlocked] = useState(false);
    const [isBlockedBySelectedUser, setIsBlockedBySelectedUser] = useState(false);
    const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);

    const isMessagePinned = (message: Message) => Boolean(message.is_pinned || message.self_pinned);
    const getPinLabel = (message: Message) => message.is_pinned ? "Закреплено для всех" : "Закреплено у вас";
    const pinnedForEveryone = messages.find((message) => Boolean(message.is_pinned));
    const pinnedForSelf = messages.find((message) => Boolean(message.self_pinned) && !message.is_pinned);
    const pinnedMessages = [pinnedForEveryone, pinnedForSelf].filter(Boolean) as Message[];
    const getPinnedMessagePreview = (message: Message) => message.message || message.file_name || "Файл";
    const messageRestrictionText = isBlockedBySelectedUser
        ? "Вы не можете написать: пользователь ограничил круг лиц"
        : isSelectedUserBlocked
            ? "Вы добавили пользователя в черный список. Разблокируйте его, чтобы написать."
            : "";

    const formatDuration = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    const isVoiceMessage = (message: Message) => {
        const mediaPath = message.media || message.file_path || "";
        const fileName = (message.file_name || "").toLowerCase();
        const isAudio = /\.(wav|webm|ogg|mp3)$/i.test(mediaPath) || /\.(wav|webm|ogg|mp3)$/i.test(fileName);
        return isAudio && (fileName.includes("voice") || fileName.includes("голос") || fileName === "voice-message.wav");
    };

    const handleEmojiClick = (emojiData: EmojiClickData) => {
        setNewMessage(prev => prev + emojiData.emoji);
        setShowEmojiPicker(false);
    };

    const startRecording = async () => {
        try {
            setRecordingTime(0);
            recordingCancelledRef.current = false;
            voiceTranscriptRef.current = "";
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder.current = new MediaRecorder(stream);
            const settings = readSettings();
            const SpeechRecognition = getSpeechRecognition();

            if (SpeechRecognition) {
                const recognition = new SpeechRecognition();
                recognition.lang = settings.appLanguage === "en" ? "en-US" : "ru-RU";
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.onresult = (event) => {
                    let transcript = "";
                    for (let index = 0; index < event.results.length; index += 1) {
                        transcript += event.results[index][0]?.transcript || "";
                    }
                    voiceTranscriptRef.current = transcript.trim();
                };
                recognition.onerror = () => undefined;
                speechRecognitionRef.current = recognition;
                recognition.start();
            }

            mediaRecorder.current.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunks.current.push(e.data);
                }
            };

            mediaRecorder.current.onstop = async () => {
                const audioBlob = new Blob(audioChunks.current, { type: 'audio/wav' });
                const audioFile = new File([audioBlob], 'voice-message.wav', {
                    type: 'audio/wav',
                    lastModified: Date.now()
                });

                if (!recordingCancelledRef.current && audioBlob.size > 0) {
                    sendVoiceMessageRef.current(audioFile);
                }
                audioChunks.current = [];
                stream.getTracks().forEach(track => track.stop());
                setRecordingTime(0);
                recordingCancelledRef.current = false;
            };

            mediaRecorder.current.start();
            setIsRecording(true);
            setShowCancelRecording(true);

            timerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);
        } catch (error) {
            console.error('Ошибка доступа к микрофону:', error);
            toast.error('Не удалось получить доступ к микрофону');
        }
    };

    const stopRecording = () => {
        if (mediaRecorder.current?.state === 'recording') {
            recordingCancelledRef.current = false;
            mediaRecorder.current.stop();
            speechRecognitionRef.current?.stop();
            speechRecognitionRef.current = null;
            setIsRecording(false);
            setShowCancelRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);
        }
    };

    const cancelRecording = () => {
        if (mediaRecorder.current?.state === 'recording') {
            recordingCancelledRef.current = true;
            mediaRecorder.current.stop();
            speechRecognitionRef.current?.abort();
            speechRecognitionRef.current = null;
            audioChunks.current = [];
            setIsRecording(false);
            setShowCancelRecording(false);
            setRecordingTime(0);
            if (timerRef.current) clearInterval(timerRef.current);
        }
    };

    useEffect(() => {
        const fetchFriends = async () => {
            const token = localStorage.getItem("token");
            if (!token) {
                setIsLoading(false);
                navigate('/login');
                return;
            }

            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), 10000);

            try {
                const decodedToken = jwtDecode<DecodedToken>(token);
                setCurrentUser(decodedToken);

                const response = await fetch('http://localhost:5000/friends', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` },
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error("Не удалось загрузить список друзей");

                const friends = await response.json();
                const safeFriends = Array.isArray(friends) ? friends : [];
                setUsers(safeFriends);
                setFilteredUsers(safeFriends);
            } catch (error) {
                console.error("Ошибка загрузки друзей:", error);
                if (error instanceof DOMException && error.name === "AbortError") {
                    toast.error("Сервер не ответил. Проверьте, запущен ли backend.");
                } else {
                    navigate('/login');
                }
            } finally {
                window.clearTimeout(timeoutId);
                setIsLoading(false);
            }
        };

        fetchFriends();
    }, [navigate]);

    useEffect(() => {
        const applyOnlineUsers = (userIds: number[]) => {
            setOnlineUserIds(userIds);
            setUsers(prev => prev.map(user => ({ ...user, isOnline: userIds.includes(user.id) })));
            setFilteredUsers(prev => prev.map(user => ({ ...user, isOnline: userIds.includes(user.id) })));
        };

        applyOnlineUsers(readOnlineUserIds());
        return subscribeOnlineUserIds(applyOnlineUsers);
    }, []);

    useEffect(() => {
        const handleScroll = () => {
            if (messagesContainerRef.current) {
                const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
                setShowScrollButton(scrollTop < scrollHeight - clientHeight - 100);
            }
        };

        if (messagesContainerRef.current) {
            messagesContainerRef.current.addEventListener('scroll', handleScroll);
        }

        return () => {
            if (messagesContainerRef.current) {
                messagesContainerRef.current.removeEventListener('scroll', handleScroll);
            }
        };
    }, []);

    const scrollToBottom = () => {
        messagesContainerRef.current?.scrollTo({
            top: messagesContainerRef.current.scrollHeight,
            behavior: 'smooth'
        });
    };

    const scrollToMessage = (messageId: number) => {
        const target = messageRefs.current[messageId];
        if (!target) return;

        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedMessageId(messageId);
        window.setTimeout(() => setHighlightedMessageId(null), 1400);
    };

    useEffect(() => {
        if (!chatId) return;

        const fetchChatDetails = async () => {
            const token = localStorage.getItem("token");
            if (!token) return;

            try {
                const response = await fetch(`http://localhost:5000/chats/${chatId}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                if (!response.ok) return;

                const data = await response.json();
                if (data.user) {
                    const userIds = readOnlineUserIds();
                    const chatUser = {
                        ...data.user,
                        isFriend: true,
                        isOnline: userIds.includes(data.user.id),
                    };
                    setSelectedUser(chatUser);
                    setUsers(prev => prev.some(user => user.id === chatUser.id) ? prev : [chatUser, ...prev]);
                    setFilteredUsers(prev => prev.some(user => user.id === chatUser.id) ? prev : [chatUser, ...prev]);
                }
            } catch (error) {
                console.error("Ошибка загрузки чата:", error);
            }
        };

        const fetchMessages = async () => {
            const token = localStorage.getItem("token");
            try {
                const response = await fetch(`http://localhost:5000/messages/${chatId}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                const messagesData = await response.json();
                setMessages(Array.isArray(messagesData) ? messagesData : []);
                setUnreadMessagesCount(prev => ({ ...prev, [Number(chatId)]: 0 }));

                // Прокрутка вниз после загрузки сообщений
                setTimeout(scrollToBottom, 100);
            } catch (error) {
                console.error("Ошибка загрузки сообщений:", error);
            }
        };

        fetchChatDetails();
        fetchMessages();
    }, [chatId]);

    useEffect(() => {
        if (!selectedUser) return;

        const token = localStorage.getItem("token");
        if (!token) return;

        fetch(`http://localhost:5000/blacklist/${selectedUser.id}/status`, {
            headers: { 'Authorization': `Bearer ${token}` },
        })
            .then(response => response.json())
            .then(data => {
                setIsSelectedUserBlocked(Boolean(data.blocked));
                setIsBlockedBySelectedUser(Boolean(data.blockedBy));
            })
            .catch(() => {
                setIsSelectedUserBlocked(false);
                setIsBlockedBySelectedUser(false);
            });
    }, [selectedUser]);

    useEffect(() => {
        const socket = createReconnectingWebSocket(getWsUrl());

        socket.onopen = () => {
            const token = localStorage.getItem("token");
            if (token) {
                socket.send(JSON.stringify({ type: "AUTH", token }));
            }
        };

        socket.onmessage = (event) => {
            const notification = JSON.parse(event.data);

            if (notification.type === 'ONLINE_USERS' || notification.type === 'USER_PRESENCE') {
                const userIds = notification.data.userIds || [];
                writeOnlineUserIds(userIds);
                setOnlineUserIds(userIds);
                setUsers(prev => prev.map(user => ({ ...user, isOnline: userIds.includes(user.id) })));
                setFilteredUsers(prev => prev.map(user => ({ ...user, isOnline: userIds.includes(user.id) })));
            }

            if (notification.type === 'NEW_MESSAGE') {
                const message = notification.data;
                if (message.user_id !== currentUser?.id) {
                    if (message.chat_id !== Number(chatId)) {
                        toast(`Новое сообщение от ${message.username || 'Неизвестный'}`);
                        setUnreadMessagesCount(prev => ({
                            ...prev,
                            [message.chat_id]: (prev[message.chat_id] || 0) + 1
                        }));
                    } else {
                        setMessages(prev => [...prev, message]);
                        setTimeout(scrollToBottom, 100);
                    }
                }
            }
            if (notification.type === 'DELETE_MESSAGE') {
                setMessages(prev => prev.filter(msg => msg.id !== notification.data.messageId));
            }
            if (notification.type === 'CLEAR_CHAT') {
                const clearedChatId = Number(notification.data.chatId);
                if (clearedChatId === Number(chatId)) {
                    setMessages([]);
                    setTranslatedMessages({});
                }
            }
            if (notification.type === 'PIN_MESSAGE') {
                const updatedMessage = notification.data;
                setMessages(prev => prev.map(msg => (
                    msg.id === updatedMessage.id
                        ? { ...msg, ...updatedMessage, self_pinned: updatedMessage.self_pinned ?? msg.self_pinned }
                        : msg
                )));
            }
            if (notification.type === 'USER_BLOCKED') {
                const { blockerId, blockedId } = notification.data;
                if (selectedUser && currentUser?.id === blockedId && selectedUser.id === blockerId) {
                    setIsBlockedBySelectedUser(true);
                }
                if (selectedUser && currentUser?.id === blockerId && selectedUser.id === blockedId) {
                    setIsSelectedUserBlocked(true);
                }
            }
            if (notification.type === 'USER_UNBLOCKED') {
                const { blockerId, blockedId } = notification.data;
                if (selectedUser && currentUser?.id === blockedId && selectedUser.id === blockerId) {
                    setIsBlockedBySelectedUser(false);
                }
                if (selectedUser && currentUser?.id === blockerId && selectedUser.id === blockedId) {
                    setIsSelectedUserBlocked(false);
                }
            }
        };

        return () => socket.close();
    }, [chatId, currentUser?.id, selectedUser]);

    const selectChat = (user: User) => {
        if (selectedUser?.id === user.id) return;

        setSelectedUser(user);
        setMessages([]);
        setIsSelectedUserBlocked(false);
        setIsBlockedBySelectedUser(false);
        setUnreadMessagesCount(prev => ({ ...prev, [user.id]: 0 }));

        const token = localStorage.getItem("token");
        if (!token) return;

        fetch('http://localhost:5000/chats', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ userId2: user.id }),
        })
            .then(response => response.json())
            .then(chatData => {
                if (chatData.id) {
                    navigate(`/chats/${chatData.id}`);
                }
            })
            .catch(err => console.error("Ошибка при создании чата", err));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setMediaFile(e.target.files[0]);
        }
    };

    const sendMediaMessage = async (file: File, messageText = newMessage.trim()) => {
        if (isBlockedBySelectedUser) {
            toast.error("Вы не можете написать: пользователь ограничил круг лиц");
            return;
        }
        if (isSelectedUserBlocked) {
            toast.error("Вы добавили пользователя в черный список");
            return;
        }

        const token = localStorage.getItem("token");
        if (!token) return;
        if (!chatId) return;

        const formData = new FormData();
        formData.append('chatId', String(chatId));
        formData.append('message', messageText);
        formData.append('media', file);

        try {
            const response = await fetch(`http://localhost:5000/messages/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(errorData?.message || 'Ошибка при отправке сообщения');
            }
            const sentMessage = await response.json();
            setMessages(prev => [...prev, sentMessage]);
            setNewMessage('');
            setMediaFile(null);
            setTimeout(scrollToBottom, 100);
        } catch (error) {
            console.error('Ошибка:', error);
            toast.error(error instanceof Error ? error.message : "Не удалось отправить сообщение");
        }
    };

    sendVoiceMessageRef.current = (file: File) => {
        void sendMediaMessage(file, voiceTranscriptRef.current);
    };

    const sendMessage = async () => {
        if (newMessage.trim() === '' && !mediaFile) return;

        if (mediaFile) {
            await sendMediaMessage(mediaFile);
            return;
        }

        if (isBlockedBySelectedUser) {
            toast.error("Вы не можете написать: пользователь ограничил круг лиц");
            return;
        }
        if (isSelectedUserBlocked) {
            toast.error("Вы добавили пользователя в черный список");
            return;
        }

        const token = localStorage.getItem("token");
        if (!token) return;

        const payload: any = {
            chatId: Number(chatId),
            message: newMessage.trim()
        };

        try {
            const response = await fetch(`http://localhost:5000/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(errorData?.message || 'Ошибка при отправке сообщения');
            }
            const sentMessage = await response.json();
            setMessages(prev => [...prev, sentMessage]);
            setNewMessage('');
            setTimeout(scrollToBottom, 100);
        } catch (error) {
            console.error('Ошибка:', error);
            toast.error(error instanceof Error ? error.message : "Не удалось отправить сообщение");
        }
    };

    useEffect(() => {
        const handleSettingsChange = () => {
            setTranslatedMessages({});
            setMessageTranscriptions({});
            setTranslationSettingsVersion((version) => version + 1);
        };

        window.addEventListener("itbird-settings-change", handleSettingsChange);
        window.addEventListener("storage", handleSettingsChange);
        return () => {
            window.removeEventListener("itbird-settings-change", handleSettingsChange);
            window.removeEventListener("storage", handleSettingsChange);
        };
    }, []);

    useEffect(() => {
        const settings = readSettings();
        if (!settings.autoTranslate) {
            setTranslatedMessages({});
            setMessageTranscriptions({});
            return;
        }

        const token = localStorage.getItem("token");
        if (!token) return;

        messages
            .filter((msg) => msg.message && !translatedMessages[msg.id])
            .forEach(async (msg) => {
                try {
                    const response = await fetch("http://localhost:5000/translate", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            text: msg.message,
                            target: settings.translateLanguage,
                            transcription: settings.transcriptionEnabled,
                        }),
                    });
                    if (!response.ok) return;
                    const data = await response.json();
                    setTranslatedMessages((current) => ({ ...current, [msg.id]: data.translated }));
                    if (data.transcription) {
                        setMessageTranscriptions((current) => ({ ...current, [msg.id]: data.transcription }));
                    }
                } catch (error) {
                    console.error("Translation error:", error);
                }
            });
    }, [messages, translatedMessages, translationSettingsVersion]);

    const handleDeleteMessage = async (messageId: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const response = await fetch(`http://localhost:5000/messages/${messageId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                setMessages(prevMessages => prevMessages.filter(msg => msg.id !== messageId));
            } else {
                throw new Error('Ошибка при удалении сообщения');
            }
        } catch (error) {
            console.error('Ошибка:', error);
            toast.error('Ошибка при удалении сообщения');
        } finally {
            setShowDeleteOptions(false);
            setMessageToDelete(null);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const query = e.target.value.toLowerCase();
        setSearchQuery(query);
        setFilteredUsers(users.filter((user: User) => user.username.toLowerCase().includes(query)));
    };

    const handleClearChat = async () => {
        if (!chatId) return;

        const mode = window.prompt("Как очистить чат?\n1 - только у себя\n2 - для всех", "1");
        if (mode === null) return;

        const normalizedMode = mode.trim();
        if (normalizedMode !== "1" && normalizedMode !== "2") {
            toast.error("Выберите вариант 1 или 2");
            return;
        }

        const clearForEveryone = normalizedMode === "2";
        if (clearForEveryone) {
            if (!window.confirm("Вы уверены, что хотите очистить этот чат для всех? Это удалит все сообщения у обоих участников.")) return;
        } else if (!window.confirm("Очистить этот чат только у себя?")) {
            return;
        }

        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const response = await fetch(
                clearForEveryone
                    ? `http://localhost:5000/chats/${chatId}/messages`
                    : `http://localhost:5000/chats/${chatId}/clear`,
                {
                method: clearForEveryone ? 'DELETE' : 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                }
            );
            if (!response.ok) throw new Error();
            setMessages([]);
            setTranslatedMessages({});
            toast.success(clearForEveryone ? "Чат очищен для всех" : "Чат очищен");
        } catch {
            toast.error("Не удалось очистить чат");
        }
    };

    const handleToggleBlockUser = async () => {
        if (!selectedUser) return;
        const actionText = isSelectedUserBlocked ? "разблокировать пользователя" : "добавить пользователя в черный список";
        if (!window.confirm(`Вы уверены, что хотите ${actionText}?`)) return;

        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const response = await fetch(`http://localhost:5000/blacklist/${selectedUser.id}`, {
                method: isSelectedUserBlocked ? 'DELETE' : 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!response.ok) throw new Error();
            setIsSelectedUserBlocked(!isSelectedUserBlocked);
            toast.success(isSelectedUserBlocked ? "Пользователь разблокирован" : "Пользователь добавлен в черный список");
        } catch {
            toast.error("Не удалось изменить черный список");
        }
    };

    const handleTogglePinMessage = async (message: Message) => {
        const token = localStorage.getItem("token");
        if (!token) return;

        const isPinnedForAll = Boolean(message.is_pinned);
        const isPinnedForSelf = Boolean(message.self_pinned);
        let action = "";

        if (isPinnedForAll) {
            if (!window.confirm("Открепить сообщение для всех?")) return;
            action = "unpin";
        } else if (isPinnedForSelf) {
            action = "unpin-self";
        } else {
            const mode = window.prompt("Как закрепить сообщение?\n1 - только для себя\n2 - для всех", "1");
            if (mode === null) return;

            if (mode.trim() === "1") {
                action = "pin-self";
            } else if (mode.trim() === "2") {
                if (!window.confirm("Вы уверены, что хотите закрепить сообщение для всех?")) return;
                action = "pin";
            } else {
                toast.error("Выберите вариант 1 или 2");
                return;
            }
        }

        try {
            const response = await fetch(`http://localhost:5000/messages/${message.id}/${action}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!response.ok) throw new Error();
            const updatedMessage = await response.json();
            setMessages(prev => prev.map(item => (
                item.id === message.id
                    ? { ...item, ...updatedMessage, self_pinned: updatedMessage.self_pinned ?? item.self_pinned }
                    : item
            )));
        } catch {
            toast.error("Не удалось изменить закрепление");
        }
    };

    const getAvatarUrl = (avatar: string) => {
        return avatar ? `http://localhost:5000${avatar}` : '/images/default-avatar.png';
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return format(date, "d MMMM yyyy HH:mm", { locale: ru });
    };

    const getFileIcon = (ext: string) => {
        const fileIcons = {
            jpg: <FileImageIcon className="w-4 h-4 text-pink-500" />,
            jpeg: <FileImageIcon className="w-4 h-4 text-pink-500" />,
            png: <FileImageIcon className="w-4 h-4 text-pink-500" />,
            gif: <FileImageIcon className="w-4 h-4 text-pink-500" />,
            webp: <FileImageIcon className="w-4 h-4 text-pink-500" />,
            mp4: <FileVideoIcon className="w-4 h-4 text-purple-500" />,
            webm: <FileVideoIcon className="w-4 h-4 text-purple-500" />,
            ogg: <FileVideoIcon className="w-4 h-4 text-purple-500" />,
            mp3: <FileAudioIcon className="w-4 h-4 text-green-500" />,
            wav: <FileAudioIcon className="w-4 h-4 text-green-500" />,
            pdf: <FileTextIcon className="w-4 h-4 text-red-500" />,
            zip: <FileArchiveIcon className="w-4 h-4 text-yellow-500" />,
            rar: <FileArchiveIcon className="w-4 h-4 text-yellow-500" />,
            '7z': <FileArchiveIcon className="w-4 h-4 text-yellow-500" />,
            default: <FileIcon className="w-4 h-4 text-gray-500" />
        };

        return fileIcons[ext as keyof typeof fileIcons] || fileIcons.default;
    };

    const formatFileSize = (size: number) => {
        if (size < 1024) return `${size} B`;
        if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
        if (size < 1073741824) return `${(size / 1048576).toFixed(1)} MB`;
        return `${(size / 1073741824).toFixed(1)} GB`;
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#6E59A5]"></div>
            </div>
        );
    }

    if (!currentUser) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 text-center dark:bg-gray-900">
                <div className="rounded-lg border bg-white p-6 text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                    Не удалось определить пользователя. Войдите в аккаунт заново.
                </div>
            </div>
        );
    }

    return (
        <div className="h-full min-h-[calc(100dvh-5rem)] overflow-hidden bg-gray-50 dark:bg-gray-900">
            <ToastContainer position="top-right" autoClose={3000} />
            <div className="flex h-full min-h-0">
                {/* Список чатов */}
                <motion.aside
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    className={`${selectedUser ? "hidden md:block" : "block"} h-full w-full shrink-0 border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 md:w-80`}
                >
                    <Card className="h-full rounded-none border-0">
                        <CardHeader className="border-b border-gray-200 dark:border-gray-700">
                            <CardTitle className="text-xl">Чаты</CardTitle>
                            <Input
                                type="text"
                                placeholder="Поиск друзей..."
                                value={searchQuery}
                                onChange={handleSearchChange}
                                className="w-full mt-2"
                            />
                        </CardHeader>
                        <CardContent className="p-0">
                            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                                {filteredUsers.length === 0 ? (
                                    <li className="p-4 text-center text-gray-500">Нет друзей</li>
                                ) : (
                                    filteredUsers.map(user => (
                                        <motion.li
                                            key={user.id}
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ duration: 0.2 }}
                                            onClick={() => selectChat(user)}
                                            className={`p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${selectedUser?.id === user.id ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
                                        >
                                            <div className="flex items-center space-x-3">
                                                <div className="relative">
                                                <Avatar>
                                                    <AvatarImage src={getAvatarUrl(user.avatar)} />
                                                    <AvatarFallback>{user.username.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                    <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-gray-800 ${user.isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium truncate">{user.username}</p>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                                        {user.isOnline ? "Онлайн" : "Оффлайн"}
                                                    </p>
                                                </div>
                                                {unreadMessagesCount[user.id] > 0 && (
                                                    <Badge variant="destructive" className="ml-2">
                                                        {unreadMessagesCount[user.id]}
                                                    </Badge>
                                                )}
                                            </div>
                                        </motion.li>
                                    ))
                                )}
                            </ul>
                        </CardContent>
                    </Card>
                </motion.aside>

                {/* Основной чат */}
                <div className={`${selectedUser ? "flex" : "hidden md:flex"} min-h-0 flex-1 flex-col`}>
                    {selectedUser ? (
                        <>
                            {/* Шапка чата */}
                            <Card className="shrink-0 rounded-none border-0 border-b border-gray-200 dark:border-gray-700">
                                <CardHeader className="py-3">
                                    <div className="flex min-w-0 items-center space-x-3">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-9 w-9 shrink-0 p-0 md:hidden"
                                            onClick={() => {
                                                setSelectedUser(null);
                                                navigate('/chats');
                                            }}
                                            title="К списку чатов"
                                        >
                                            <ChevronLeft className="h-5 w-5" />
                                        </Button>
                                        <div className="relative">
                                        <Avatar>
                                            <AvatarImage src={getAvatarUrl(selectedUser.avatar)} />
                                            <AvatarFallback>{selectedUser.username.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                            <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-gray-950 ${onlineUserIds.includes(selectedUser.id) ? 'bg-green-500' : 'bg-gray-400'}`} />
                                        </div>
                                        <div className="min-w-0">
                                            <CardTitle className="truncate">{selectedUser.username}</CardTitle>
                                            <CardDescription className="text-sm">
                                                {onlineUserIds.includes(selectedUser.id) ? "Онлайн" : "Оффлайн"}
                                            </CardDescription>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex min-w-0 flex-wrap items-center justify-end gap-2">
                                        {pinnedMessages.map((pinnedMessage) => (
                                            <button
                                                key={`pinned-${pinnedMessage.id}-${pinnedMessage.is_pinned ? 'all' : 'self'}`}
                                                type="button"
                                                onClick={() => scrollToMessage(pinnedMessage.id)}
                                                className="min-w-0 max-w-[260px] rounded-md border border-[#6E59A5]/30 bg-[#6E59A5]/10 px-3 py-2 text-left transition-colors hover:bg-[#6E59A5]/15 dark:bg-[#6E59A5]/20"
                                                title="Перейти к закрепленному сообщению"
                                            >
                                                <div className="flex items-center gap-2 text-xs font-semibold text-[#6E59A5] dark:text-purple-200">
                                                    <Pin className="h-3.5 w-3.5 shrink-0" />
                                                    <span>{getPinLabel(pinnedMessage)}</span>
                                                </div>
                                                <div className="mt-0.5 truncate text-xs text-gray-700 dark:text-gray-200">
                                                    {getPinnedMessagePreview(pinnedMessage)}
                                                </div>
                                            </button>
                                        ))}
                                        <VoiceCallControls
                                            currentUserId={currentUser?.id}
                                            mode="private"
                                            chatId={chatId || selectedUser.id}
                                            title={selectedUser.username}
                                            participants={[selectedUser]}
                                        />
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="outline" size="sm" className="h-9 w-9 p-0" title="Действия чата">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={handleClearChat}>
                                                    <Eraser className="mr-2 h-4 w-4" />
                                                    Очистить чат
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={handleToggleBlockUser}>
                                                    <Ban className={`mr-2 h-4 w-4 ${isSelectedUserBlocked ? 'text-red-500' : ''}`} />
                                                    {isSelectedUserBlocked ? "Разблокировать" : "В черный список"}
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </CardHeader>
                            </Card>

                            {/* Сообщения */}
                            <div
                                ref={messagesContainerRef}
                                className="min-h-0 flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900/50"
                            >
                                <div className="max-w-3xl mx-auto space-y-4">
                                    {messages.map((msg) => (
                                        <motion.div
                                            key={msg.id}
                                            ref={(element) => {
                                                messageRefs.current[msg.id] = element;
                                            }}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className={`flex rounded-xl transition-shadow ${msg.user_id === currentUser?.id ? 'justify-end' : 'justify-start'} ${highlightedMessageId === msg.id ? 'ring-2 ring-[#6E59A5] ring-offset-4 ring-offset-gray-50 dark:ring-offset-gray-900/50' : ''}`}
                                        >
                                            <div
                                                className={`max-w-[80%] rounded-lg p-3 ${msg.user_id === currentUser?.id
                                                    ? 'bg-[#6E59A5] text-white rounded-tr-none'
                                                    : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-tl-none shadow-sm'}`}
                                            >
                                                {msg.user_id !== currentUser?.id && (
                                                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                                        {msg.username}
                                                    </div>
                                                )}

                                                {msg.message && (!isVoiceMessage(msg) || revealedVoiceTextIds[msg.id]) && (
                                                    <div className="space-y-1 text-sm">
                                                        <div>{translatedMessages[msg.id] || msg.message}</div>
                                                        {messageTranscriptions[msg.id] && (
                                                            <div className="text-xs opacity-80">Как читать: {messageTranscriptions[msg.id]}</div>
                                                        )}
                                                        {translatedMessages[msg.id] && translatedMessages[msg.id] !== msg.message && (
                                                            <div className="text-xs opacity-70">{msg.message}</div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Медиафайлы */}
                                                {(msg.media || msg.file_path) && (() => {
                                                    const mediaPath = msg.media || msg.file_path || "";
                                                    const mediaUrl = `http://localhost:5000${mediaPath}`;
                                                    const ext = mediaPath.split('.').pop()?.toLowerCase() || '';
                                                    const fileSize = msg.file_size ? formatFileSize(Number(msg.file_size)) : null;

                                                    const renderDownloadLink = (icon: React.ReactNode, label: string) => (
                                                        <div className="mt-2">
                                                            <a
                                                                href={mediaUrl}
                                                                download={msg.file_name || true} // Добавляем атрибут download
                                                                className="inline-flex items-center gap-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-1 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                onClick={(e) => {
                                                                    // Для Chrome иногда нужно принудительное скачивание
                                                                    if (!msg.file_name) {
                                                                        e.preventDefault();
                                                                        const link = document.createElement('a');
                                                                        link.href = mediaUrl;
                                                                        link.download = msg.file_name || 'file';
                                                                        document.body.appendChild(link);
                                                                        link.click();
                                                                        document.body.removeChild(link);
                                                                    }
                                                                }}
                                                            >
                                                                {icon}
                                                                <span>{label}</span>
                                                                {fileSize && (
                                                                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                                                                        {fileSize}
                                                                    </span>
                                                                )}
                                                            </a>
                                                        </div>
                                                    );

                                                    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                                                        return (
                                                            <div className="mt-2">
                                                                <img
                                                                    src={mediaUrl}
                                                                    alt="Изображение"
                                                                    className="max-w-full max-h-64 object-contain rounded"
                                                                />
                                                                {renderDownloadLink(
                                                                    <FileImageIcon className="w-4 h-4 text-pink-500" />,
                                                                    msg.file_name || 'Скачать изображение'
                                                                )}
                                                            </div>
                                                        );
                                                    }

                                                    if (['mp4', 'webm', 'ogg'].includes(ext)) {
                                                        return (
                                                            <div className="mt-2">
                                                                <video controls className="max-w-full rounded">
                                                                    <source src={mediaUrl} type={`video/${ext}`} />
                                                                </video>
                                                                {renderDownloadLink(
                                                                    <FileVideoIcon className="w-4 h-4 text-purple-500" />,
                                                                    msg.file_name || 'Скачать видео'
                                                                )}
                                                            </div>
                                                        );
                                                    }

                                                    if (['mp3', 'wav', 'ogg'].includes(ext)) {
                                                        const voiceMessage = isVoiceMessage(msg);
                                                        return (
                                                            <div className={voiceMessage ? "mt-2 min-w-0" : "mt-2 w-[280px] max-w-[70vw] overflow-hidden"}>
                                                                {voiceMessage && (
                                                                    <VoiceMessageBubble
                                                                        src={mediaUrl}
                                                                        transcript={msg.message}
                                                                        revealed={Boolean(revealedVoiceTextIds[msg.id])}
                                                                        onToggleTranscript={() => setRevealedVoiceTextIds((current) => ({ ...current, [msg.id]: !current[msg.id] }))}
                                                                        onMissingTranscript={() => toast.info("Для этого голосового сообщения нет сохраненной расшифровки")}
                                                                    />
                                                                )}
                                                                {!voiceMessage && (
                                                                    <audio controls className="block w-full min-w-0">
                                                                        <source src={mediaUrl} type={`audio/${ext}`} />
                                                                    </audio>
                                                                )}
                                                                {renderDownloadLink(
                                                                    <FileAudioIcon className="w-4 h-4 text-green-500" />,
                                                                    msg.file_name || 'Скачать аудио'
                                                                )}
                                                            </div>
                                                        );
                                                    }

                                                    if (ext === 'pdf') {
                                                        return (
                                                            <div className="mt-2">
                                                                <iframe
                                                                    src={mediaUrl}
                                                                    title="PDF файл"
                                                                    className="w-full h-64 rounded border"
                                                                ></iframe>
                                                                {renderDownloadLink(
                                                                    <FileTextIcon className="w-4 h-4" />,
                                                                    msg.file_name || 'Скачать PDF'
                                                                )}
                                                            </div>
                                                        );
                                                    }

                                                    if (['zip', 'rar', '7z'].includes(ext)) {
                                                        return renderDownloadLink(
                                                            <FileArchiveIcon className="w-4 h-4 text-yellow-500" />,
                                                            msg.file_name || 'Скачать архив'
                                                        );
                                                    }

                                                    return renderDownloadLink(
                                                        <FileIcon className="w-4 h-4 text-gray-500" />,
                                                        msg.file_name || 'Скачать файл'
                                                    );
                                                })()}

                                                {isMessagePinned(msg) ? (
                                                    <div className="mt-2 text-xs font-medium opacity-80">{getPinLabel(msg)}</div>
                                                ) : null}

                                                <div className="flex items-center justify-between mt-1">
                                                    <span className={`text-xs ${msg.user_id === currentUser?.id ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}`}>
                                                        {formatDate(msg.created_at)}
                                                    </span>

                                                    <div className="flex items-center gap-2 ml-2">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleTogglePinMessage(msg);
                                                            }}
                                                            className={`text-xs ${msg.user_id === currentUser?.id ? 'text-white/70 hover:text-white' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}
                                                            title={isMessagePinned(msg) ? "Открепить" : "Закрепить"}
                                                        >
                                                            {isMessagePinned(msg) ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                                                        </button>
                                                        {msg.user_id === currentUser?.id && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setMessageToDelete(msg);
                                                                    setShowDeleteOptions(true);
                                                                }}
                                                                className={`text-xs ${msg.user_id === currentUser?.id ? 'text-white/70 hover:text-white' : 'text-gray-500 hover:text-red-500 dark:text-gray-400'} hover:text-red-500`}
                                                                title="Удалить сообщение"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))}
                                    <div ref={messagesEndRef} />
                                </div>
                            </div>

                            {/* Поле ввода сообщения */}
                            <div className="shrink-0 p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                                <div className="max-w-3xl mx-auto">
                                    {messageRestrictionText ? (
                                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-center text-sm font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
                                            {messageRestrictionText}
                                        </div>
                                    ) : (
                                        <>
                                    <div className="flex items-end gap-2">
                                        <div className="flex items-center gap-1 relative">
                                            {/* Кнопка эмодзи */}
                                            <button
                                                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                                                className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                                            >
                                                <Smile className="w-5 h-5 text-gray-500" />
                                            </button>

                                            {/* Кнопка записи аудио */}
                                            <div className="relative">
                                                <button
                                                    onMouseDown={startRecording}
                                                    onMouseUp={stopRecording}
                                                    onTouchStart={startRecording}
                                                    onTouchEnd={stopRecording}
                                                    className={`p-2 rounded-full ${isRecording
                                                        ? 'bg-red-100 dark:bg-red-900/20 animate-pulse'
                                                        : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                                                        }`}
                                                >
                                                    <Mic className={`w-5 h-5 ${isRecording ? 'text-red-600' : 'text-gray-500'}`} />
                                                </button>

                                                {showCancelRecording && (
                                                    <motion.button
                                                        initial={{ opacity: 0, scale: 0.5 }}
                                                        animate={{ opacity: 1, scale: 1 }}
                                                        className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full"
                                                        onClick={cancelRecording}
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </motion.button>
                                                )}
                                            </div>

                                            {isRecording && (
                                                <div className="flex items-center gap-2 ml-2 text-red-600 dark:text-red-400">
                                                    <span className="text-sm">{formatDuration(recordingTime)}</span>
                                                    <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse" />
                                                </div>
                                            )}

                                            {/* Эмодзи-пикер */}
                                            {showEmojiPicker && (
                                                <div className="absolute bottom-14 left-2 z-50">
                                                    <EmojiPicker
                                                        onEmojiClick={handleEmojiClick}
                                                        previewConfig={{ showPreview: false }}
                                                        skinTonesDisabled
                                                        searchDisabled
                                                        width={300}
                                                        height={350}
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        {/* Обработка отображения аудиофайла */}
                                        {mediaFile?.type.startsWith('audio/') && (
                                            <div className="mt-2 flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-md">
                                                <FileAudioIcon className="w-4 h-4 text-green-500" />
                                                <span className="text-sm truncate flex-1">Голосовое сообщение</span>
                                                <button
                                                    onClick={() => setMediaFile(null)}
                                                    className="text-gray-500 hover:text-red-500"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-end gap-2">
                                        <label className="cursor-pointer p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
                                            <Paperclip className="w-5 h-5 text-gray-500" />
                                            <input
                                                type="file"
                                                onChange={handleFileChange}
                                                className="hidden"
                                                accept="image/*,video/*,audio/*,.pdf,.zip,.rar,.7z"
                                            />
                                        </label>

                                        <div className="flex-1 relative">
                                            <Textarea
                                                value={newMessage}
                                                onChange={(e) => setNewMessage(e.target.value)}
                                                onKeyDown={handleKeyDown}
                                                placeholder="Напишите сообщение..."
                                                className="min-h-[40px] max-h-[120px] resize-none pr-10"
                                                rows={1}
                                            />
                                        </div>

                                        <Button
                                            onClick={sendMessage}
                                            size="sm"
                                            className="bg-[#6E59A5] hover:bg-[#5a4a8a] h-10 w-10 p-0 rounded-full"
                                            disabled={!newMessage.trim() && !mediaFile}
                                        >
                                            <SendHorizonal className="w-4 h-4" />
                                        </Button>
                                    </div>

                                    {mediaFile && (
                                        <div className="mt-2 flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-md">
                                            <FileIcon className="w-4 h-4 text-gray-500" />
                                            <span className="text-sm truncate flex-1">{mediaFile.name}</span>
                                            <button
                                                onClick={() => setMediaFile(null)}
                                                className="text-gray-500 hover:text-red-500"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                                </svg>
                                            </button>
                                        </div>
                                    )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
                            <div className="max-w-md text-center">
                                <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-2">Выберите чат</h3>
                                <p className="text-gray-500 dark:text-gray-400">
                                    Выберите собеседника из списка, чтобы начать общение
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Кнопка прокрутки вниз */}
                    <AnimatePresence>
                        {showScrollButton && (
                            <motion.button
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 20 }}
                                onClick={scrollToBottom}
                                className="fixed right-8 bottom-24 bg-[#6E59A5] hover:bg-[#5a4a8a] text-white p-2 rounded-full shadow-lg"
                            >
                                <ChevronUp className="w-5 h-5 rotate-180" />
                            </motion.button>
                        )}
                    </AnimatePresence>
                </div>
            </div>
            <AnimatePresence>
                {showDeleteOptions && messageToDelete && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
                        onClick={() => setShowDeleteOptions(false)}
                    >
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 20, opacity: 0 }}
                            className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md"
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-medium mb-4">Удалить сообщение</h3>
                            <p className="mb-4">Сообщение будет полностью удалено из чата.</p>

                            <div className="space-y-3">
                                <Button
                                    variant="destructive"
                                    className="w-full"
                                    onClick={() => handleDeleteMessage(messageToDelete.id)}
                                >
                                    Удалить
                                </Button>
                            </div>

                            <div className="mt-4 flex justify-end">
                                <Button
                                    variant="ghost"
                                    onClick={() => setShowDeleteOptions(false)}
                                >
                                    Отмена
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div >
    );
};

export default Chats;

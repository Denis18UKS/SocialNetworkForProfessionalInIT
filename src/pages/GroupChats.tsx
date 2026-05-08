import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    Eraser,
    UserMinus,
    LogOut,
    ChevronUp,
    X,
    Users,
    Plus
} from 'lucide-react';
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import { getWsUrl, readSettings } from "@/lib/settings";
import { readOnlineUserIds, subscribeOnlineUserIds, writeOnlineUserIds } from "@/lib/realtime";

import { Smile, Mic } from 'lucide-react';
import EmojiPicker, { EmojiClickData } from 'emoji-picker-react';

interface User {
    id: number;
    username: string;
    user_tag?: string | null;
    avatar: string;
    isOnline?: boolean;
}

interface GroupChat {
    id: number;
    name: string;
    description: string;
    creator_id: number;
    avatar: string;
    created_at: string;
    creator_username: string;
    unread_count?: number;
}

interface GroupMessage {
    id: number;
    group_chat_id: number;
    user_id: number;
    message: string;
    created_at: string;
    username: string;
    avatar: string;
    read: boolean;
    media?: string;
    file_name?: string;
    file_path?: string;
    file_size?: string;
    duration?: number;
    is_deleted?: boolean | number;
    is_pinned?: boolean | number;
    self_pinned?: boolean | number;
}

interface DecodedToken {
    id: number;
    username: string;
}

const GroupChats = () => {
    const { chatId } = useParams<{ chatId: string }>();
    const [selectedChat, setSelectedChat] = useState<GroupChat | null>(null);
    const [messages, setMessages] = useState<GroupMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [groupChats, setGroupChats] = useState<GroupChat[]>([]);
    const [filteredChats, setFilteredChats] = useState<GroupChat[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentUser, setCurrentUser] = useState<DecodedToken | null>(null);
    const [unreadMessagesCount, setUnreadMessagesCount] = useState<{ [key: number]: number }>({});
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [chatName, setChatName] = useState('');
    const [chatDescription, setChatDescription] = useState('');
    const [friends, setFriends] = useState<User[]>([]);
    const [selectedFriends, setSelectedFriends] = useState<User[]>([]);
    const [chatMembers, setChatMembers] = useState<User[]>([]);
    const [showMembersModal, setShowMembersModal] = useState(false);

    const navigate = useNavigate();
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});

    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<Blob[]>([]);
    const [recordingTime, setRecordingTime] = useState(0);
    const [showCancelRecording, setShowCancelRecording] = useState(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const [showDeleteOptions, setShowDeleteOptions] = useState(false);
    const [messageToDelete, setMessageToDelete] = useState<GroupMessage | null>(null);
    const [translatedMessages, setTranslatedMessages] = useState<Record<number, string>>({});
    const [onlineUserIds, setOnlineUserIds] = useState<number[]>(readOnlineUserIds);
    const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);

    const isMessagePinned = (message: GroupMessage) => Boolean(message.is_pinned || message.self_pinned);
    const getPinLabel = (message: GroupMessage) => message.is_pinned ? "Закреплено для всех" : "Закреплено у вас";
    const pinnedMessage = messages.find(isMessagePinned);
    const pinnedMessagePreview = pinnedMessage
        ? (pinnedMessage.message || pinnedMessage.file_name || "Файл")
        : "";

    // Новые состояния для добавления участников
    const [showAddMembersModal, setShowAddMembersModal] = useState(false);
    const [newMembers, setNewMembers] = useState<User[]>([]);

    const addMembersToChat = async () => {
        if (!selectedChat || newMembers.length === 0) return;

        const token = localStorage.getItem("token");
        try {
            const response = await fetch(`http://localhost:5000/group-chats/${selectedChat.id}/members`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    memberIds: newMembers.map(m => m.id)
                })
            });

            if (!response.ok) throw new Error();

            // Обновляем список участников
            const updatedMembers = await fetch(`http://localhost:5000/group-chats/${selectedChat.id}/members`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setChatMembers(await updatedMembers.json());

            setShowAddMembersModal(false);
            setNewMembers([]);
            toast.success("Участники успешно добавлены");
        } catch (error) {
            console.error("Ошибка добавления участников:", error);
            toast.error("Ошибка при добавлении участников");
        }
    };

    const formatDuration = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    const handleEmojiClick = (emojiData: EmojiClickData) => {
        setNewMessage(prev => prev + emojiData.emoji);
        setShowEmojiPicker(false);
    };

    const startRecording = async () => {
        try {
            setRecordingTime(0);
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder.current = new MediaRecorder(stream);

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

                setMediaFile(audioFile);
                audioChunks.current = [];
                stream.getTracks().forEach(track => track.stop());
                setRecordingTime(0);
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
            mediaRecorder.current.stop();
            setIsRecording(false);
            setShowCancelRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);
        }
    };

    const cancelRecording = () => {
        if (mediaRecorder.current?.state === 'recording') {
            mediaRecorder.current.stop();
            audioChunks.current = [];
            setIsRecording(false);
            setShowCancelRecording(false);
            setRecordingTime(0);
            if (timerRef.current) clearInterval(timerRef.current);
        }
    };

    useEffect(() => {
        const fetchGroupChats = async () => {
            const token = localStorage.getItem("token");
            if (!token) {
                navigate('/login');
                return;
            }

            try {
                const decodedToken = jwtDecode<DecodedToken>(token);
                setCurrentUser(decodedToken);

                const response = await fetch('http://localhost:5000/group-chats', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` },
                });

                const chats = await response.json();
                setGroupChats(chats);
                setFilteredChats(chats);
            } catch (error) {
                console.error("Ошибка загрузки групповых чатов:", error);
                navigate('/login');
            } finally {
                setIsLoading(false);
            }
        };

        fetchGroupChats();
    }, [navigate]);

    useEffect(() => {
        const applyOnlineUsers = (userIds: number[]) => {
            setOnlineUserIds(userIds);
            setChatMembers(prev => prev.map(member => ({ ...member, isOnline: userIds.includes(member.id) })));
        };

        applyOnlineUsers(readOnlineUserIds());
        return subscribeOnlineUserIds(applyOnlineUsers);
    }, []);

    useEffect(() => {
        const fetchFriends = async () => {
            const token = localStorage.getItem("token");
            try {
                const response = await fetch('http://localhost:5000/friends', {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                const data = await response.json();
                setFriends(data);
            } catch (error) {
                console.error("Ошибка загрузки друзей:", error);
            }
        };

        fetchFriends();
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

    const handleDeleteMessage = async (messageId: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const response = await fetch(`http://localhost:5000/group-messages/${messageId}`, {
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

    const handleClearGroupChat = async () => {
        if (!selectedChat || !window.confirm("Очистить этот групповой чат только у себя?")) return;
        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const response = await fetch(`http://localhost:5000/group-chats/${selectedChat.id}/clear`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!response.ok) throw new Error();
            setMessages([]);
            toast.success("Чат очищен");
        } catch {
            toast.error("Не удалось очистить чат");
        }
    };

    const handleTogglePinMessage = async (message: GroupMessage) => {
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
            const response = await fetch(`http://localhost:5000/group-messages/${message.id}/${action}`, {
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

    const removeCurrentGroupFromUi = (removedChatId: number) => {
        setGroupChats(prev => prev.filter(chat => chat.id !== removedChatId));
        setFilteredChats(prev => prev.filter(chat => chat.id !== removedChatId));
        if (Number(chatId) === removedChatId) {
            setSelectedChat(null);
            setMessages([]);
            navigate('/group-chats');
        }
    };

    const handleDeleteGroupChat = async () => {
        if (!selectedChat || !window.confirm("Вы уверены, что хотите удалить группу для всех участников?")) return;
        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const response = await fetch(`http://localhost:5000/group-chats/${selectedChat.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!response.ok) throw new Error();
            removeCurrentGroupFromUi(selectedChat.id);
            toast.success("Группа удалена");
        } catch {
            toast.error("Не удалось удалить группу");
        }
    };

    const handleLeaveGroupChat = async () => {
        if (!selectedChat || !window.confirm("Вы уверены, что хотите покинуть эту группу?")) return;
        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const response = await fetch(`http://localhost:5000/group-chats/${selectedChat.id}/leave`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!response.ok) throw new Error();
            removeCurrentGroupFromUi(selectedChat.id);
            toast.success("Вы покинули группу");
        } catch {
            toast.error("Не удалось покинуть группу");
        }
    };

    const handleKickMember = async (memberId: number) => {
        if (!selectedChat || !window.confirm("Исключить участника из группы?")) return;
        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const response = await fetch(`http://localhost:5000/group-chats/${selectedChat.id}/members/${memberId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!response.ok) throw new Error();
            setChatMembers(prev => prev.filter(member => member.id !== memberId));
            toast.success("Участник исключен");
        } catch {
            toast.error("Не удалось исключить участника");
        }
    };

    useEffect(() => {
        if (!chatId) return;

        const fetchMessages = async () => {
            const token = localStorage.getItem("token");
            try {
                const response = await fetch(`http://localhost:5000/group-chats/${chatId}/messages`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                const messagesData = await response.json();
                setMessages(messagesData);
                setUnreadMessagesCount(prev => ({ ...prev, [Number(chatId)]: 0 }));

                setTimeout(scrollToBottom, 100);
            } catch (error) {
                console.error("Ошибка загрузки сообщений:", error);
            }
        };

        fetchMessages();
    }, [chatId]);

    const fetchChatMembers = useCallback(async () => {
        if (!chatId) return;
        const token = localStorage.getItem("token");
        try {
            const response = await fetch(`http://localhost:5000/group-chats/${chatId}/members`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const members = await response.json();
            setChatMembers(members);
        } catch (error) {
            console.error("Ошибка загрузки участников:", error);
        }
    }, [chatId]);

    useEffect(() => {
        if (selectedChat) {
            fetchChatMembers();
        }
    }, [chatId, selectedChat, fetchChatMembers]);

    useEffect(() => {
        const socket = new WebSocket(getWsUrl());

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
                setChatMembers(prev => prev.map(member => ({ ...member, isOnline: userIds.includes(member.id) })));
            }

            if (notification.type === 'NEW_GROUP_MESSAGE') {
                const message = notification.data;
                if (message.mentionRecipientIds?.includes(currentUser?.id)) return;
                if (message.user_id !== currentUser?.id) {
                    if (message.group_chat_id !== Number(chatId)) {
                        toast(`Новое сообщение в чате ${message.group_chat_name || 'Групповой чат'}`);
                        setUnreadMessagesCount(prev => ({
                            ...prev,
                            [message.group_chat_id]: (prev[message.group_chat_id] || 0) + 1
                        }));
                    } else {
                        setMessages(prev => [...prev, message]);
                        setTimeout(scrollToBottom, 100);
                    }
                }
            }

            if (notification.type === 'NEW_GROUP_CHAT') {
                const { chat, memberIds } = notification.data;
                if (memberIds.includes(currentUser?.id)) {
                    setGroupChats(prev => prev.some(item => item.id === chat.id) ? prev : [...prev, chat]);
                    setFilteredChats(prev => prev.some(item => item.id === chat.id) ? prev : [...prev, chat]);
                }
            }

            // Обработка уведомления о новых участниках
            if (notification.type === 'NEW_GROUP_MEMBER') {
                const { chatId: updatedChatId, memberIds, chat } = notification.data;
                if (memberIds.includes(currentUser?.id) && chat) {
                    setGroupChats(prev => prev.some(item => item.id === chat.id) ? prev : [...prev, chat]);
                    setFilteredChats(prev => prev.some(item => item.id === chat.id) ? prev : [...prev, chat]);
                }
                if (updatedChatId === Number(chatId)) {
                    // Вызываем функцию для обновления списка участников
                    fetchChatMembers();
                }
            }

            if (notification.type === 'GROUP_MESSAGE_DELETED') {
                setMessages(prev => prev.filter(msg => msg.id !== notification.data.messageId));
            }
            if (notification.type === 'PIN_GROUP_MESSAGE') {
                const updatedMessage = notification.data;
                setMessages(prev => prev.map(msg => (
                    msg.id === updatedMessage.id
                        ? { ...msg, ...updatedMessage, self_pinned: updatedMessage.self_pinned ?? msg.self_pinned }
                        : msg
                )));
            }
            if (notification.type === 'GROUP_CHAT_DELETED') {
                const removedChatId = Number(notification.data.chatId);
                if (notification.data.memberIds?.includes(currentUser?.id)) {
                    removeCurrentGroupFromUi(removedChatId);
                    toast.info("Группа была удалена");
                }
            }
            if (notification.type === 'GROUP_MEMBER_REMOVED') {
                const removedChatId = Number(notification.data.chatId);
                const memberId = Number(notification.data.memberId);
                if (memberId === currentUser?.id) {
                    removeCurrentGroupFromUi(removedChatId);
                    toast.info(notification.data.kicked ? "Вас исключили из группы" : "Вы вышли из группы");
                } else if (removedChatId === Number(chatId)) {
                    setChatMembers(prev => prev.filter(member => member.id !== memberId));
                }
            }
        };

        return () => socket.close();
    }, [chatId, currentUser?.id, fetchChatMembers]);

    useEffect(() => {
        const settings = readSettings();
        if (!settings.autoTranslate) {
            setTranslatedMessages({});
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
                        body: JSON.stringify({ text: msg.message, target: settings.translateLanguage }),
                    });
                    if (!response.ok) return;
                    const data = await response.json();
                    setTranslatedMessages((current) => ({ ...current, [msg.id]: data.translated }));
                } catch (error) {
                    console.error("Translation error:", error);
                }
            });
    }, [messages, translatedMessages]);

    const selectChat = (chat: GroupChat) => {
        if (selectedChat?.id === chat.id) return;

        setSelectedChat(chat);
        setMessages([]);
        setUnreadMessagesCount(prev => ({ ...prev, [chat.id]: 0 }));
        navigate(`/group-chats/${chat.id}`);
    };

    const createGroupChat = async () => {
        if (!chatName.trim() || selectedFriends.length === 0) {
            toast.error("Укажите название чата и выберите участников");
            return;
        }

        const token = localStorage.getItem("token");
        try {
            const response = await fetch('http://localhost:5000/group-chats', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: chatName,
                    description: chatDescription,
                    memberIds: selectedFriends.map(f => f.id)
                })
            });

            if (!response.ok) throw new Error();

            const newChat = await response.json();
            setGroupChats(prev => [...prev, newChat]);
            setSelectedChat(newChat);
            setShowCreateModal(false);
            setChatName('');
            setChatDescription('');
            setSelectedFriends([]);
            toast.success("Групповой чат успешно создан");
        } catch (error) {
            console.error("Ошибка создания чата:", error);
            let errorMessage = 'Ошибка при создании чата';
            if (error instanceof Error && error.message) {
                errorMessage = error.message;
            }
            toast.error(errorMessage);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setMediaFile(e.target.files[0]);
        }
    };

    const sendMessage = async () => {
        if (newMessage.trim() === '' && !mediaFile) return;

        const token = localStorage.getItem("token");
        if (!token || !selectedChat) {
            toast.error('Чат не выбран или нет токена');
            return;
        }

        try {
            if (mediaFile) {
                const formData = new FormData();
                formData.append('media', mediaFile);
                formData.append('message', newMessage.trim());

                const response = await fetch(`http://localhost:5000/group-chats/${selectedChat.id}/upload`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                    body: formData
                });

                if (!response.ok) throw new Error('Ошибка при отправке сообщения');
                const sentMessage = await response.json();
                setMessages(prev => [...prev, sentMessage]);
                setNewMessage('');
                setMediaFile(null);
                setTimeout(scrollToBottom, 100);
            } else {
                const response = await fetch(`http://localhost:5000/group-chats/${selectedChat.id}/messages`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message: newMessage.trim() })
                });
                if (!response.ok) throw new Error('Ошибка при отправке сообщения');
                const sentMessage = await response.json();
                setMessages(prev => [...prev, sentMessage]);
                setNewMessage('');
                setTimeout(scrollToBottom, 100);
            }
        } catch (error) {
            console.error('Ошибка:', error);
            toast.error('Ошибка при отправке сообщения');
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
        setFilteredChats(groupChats.filter((chat: GroupChat) =>
            chat.name.toLowerCase().includes(query) ||
            (chat.description && chat.description.toLowerCase().includes(query))
        ));
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

    if (!currentUser || isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#6E59A5]"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            <ToastContainer position="top-right" autoClose={3000} />
            <div className="flex h-screen">
                {/* Список групповых чатов */}
                <motion.aside
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    className="w-80 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                >
                    <Card className="h-full rounded-none border-0">
                        <CardHeader className="border-b border-gray-200 dark:border-gray-700">
                            <div className="flex justify-between items-center">
                                <CardTitle className="text-xl">Групповые чаты</CardTitle>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setShowCreateModal(true)}
                                >
                                    <Plus className="w-4 h-4" />
                                </Button>
                            </div>
                            <Input
                                type="text"
                                placeholder="Поиск чатов..."
                                value={searchQuery}
                                onChange={handleSearchChange}
                                className="w-full mt-2"
                            />
                        </CardHeader>
                        <CardContent className="p-0">
                            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                                {filteredChats.length === 0 ? (
                                    <li className="p-4 text-center text-gray-500">Нет групповых чатов</li>
                                ) : (
                                    filteredChats.map(chat => (
                                        <motion.li
                                            key={chat.id}
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ duration: 0.2 }}
                                            onClick={() => selectChat(chat)}
                                            className={`p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${selectedChat?.id === chat.id ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
                                        >
                                            <div className="flex items-center space-x-3">
                                                <Avatar>
                                                    <AvatarImage src={getAvatarUrl(chat.avatar)} />
                                                    <AvatarFallback>{chat.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium truncate">{chat.name}</p>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                                        {chat.description || "Групповой чат"}
                                                    </p>
                                                </div>
                                                {unreadMessagesCount[chat.id] > 0 && (
                                                    <Badge variant="destructive" className="ml-2">
                                                        {unreadMessagesCount[chat.id]}
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
                <div className="flex-1 flex flex-col">
                    {selectedChat ? (
                        <>
                            {/* Шапка чата */}
                            <Card className="rounded-none border-0 border-b border-gray-200 dark:border-gray-700">
                                <CardHeader className="py-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-3">
                                            <Avatar>
                                                <AvatarImage src={getAvatarUrl(selectedChat.avatar)} />
                                                <AvatarFallback>{selectedChat.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <CardTitle>{selectedChat.name}</CardTitle>
                                                <CardDescription className="text-sm">
                                                    {chatMembers.length} участников
                                                </CardDescription>
                                            </div>
                                        </div>
                                        <div className="flex min-w-0 items-center gap-2">
                                            {pinnedMessage && (
                                                <button
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
                                                        {pinnedMessagePreview}
                                                    </div>
                                                </button>
                                            )}
                                            <Button variant="ghost" size="sm" onClick={handleClearGroupChat} title="Очистить чат">
                                                <Eraser className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setShowMembersModal(true)}
                                                title="Участники"
                                            >
                                                <Users className="w-4 h-4" />
                                            </Button>
                                            {selectedChat.creator_id === currentUser?.id ? (
                                                <Button variant="ghost" size="sm" onClick={handleDeleteGroupChat} title="Удалить группу">
                                                    <Trash2 className="w-4 h-4 text-red-500" />
                                                </Button>
                                            ) : (
                                                <Button variant="ghost" size="sm" onClick={handleLeaveGroupChat} title="Покинуть группу">
                                                    <LogOut className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </CardHeader>
                            </Card>

                            {/* Сообщения */}
                            <div
                                ref={messagesContainerRef}
                                className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900/50"
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
                                                    : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-tl-none shadow-sm'
                                                    }`}
                                            >
                                                {msg.user_id !== currentUser?.id && !msg.is_deleted && (
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <Avatar className="w-6 h-6">
                                                            <AvatarImage src={getAvatarUrl(msg.avatar)} />
                                                            <AvatarFallback>{msg.username.charAt(0)}</AvatarFallback>
                                                        </Avatar>
                                                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                                            {msg.username}
                                                        </span>
                                                    </div>
                                                )}

                                                <>
                                                    {msg.message && (
                                                        <div className="space-y-1 text-sm">
                                                            <div>{translatedMessages[msg.id] || msg.message}</div>
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
                                                                        download={msg.file_name || true}
                                                                        className="inline-flex items-center gap-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-1 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        onClick={(e) => {
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
                                                                        {msg.duration && (
                                                                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                                                                                {formatDuration(msg.duration)}
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
                                                                return (
                                                                    <div className="mt-2 w-[280px] max-w-[70vw] overflow-hidden">
                                                                        <audio controls className="block w-full min-w-0">
                                                                            <source src={mediaUrl} type={`audio/${ext}`} />
                                                                        </audio>
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
                                                </>

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
                                                        {msg.user_id === currentUser?.id && !msg.is_deleted && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setMessageToDelete(msg);
                                                                    setShowDeleteOptions(true);
                                                                }}
                                                                className={`text-xs ${msg.user_id === currentUser?.id ? 'text-white/70 hover:text-white' : 'text-gray-500 dark:text-gray-400'} hover:text-red-500`}
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
                            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                                <div className="max-w-3xl mx-auto">
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

                                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-7 px-2 text-xs"
                                            onClick={() => setNewMessage((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@everyone `)}
                                        >
                                            @everyone
                                        </Button>
                                        <span>или упомяните участника через его @username</span>
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

                                    {mediaFile && !mediaFile.type.startsWith('audio/') && (
                                        <div className="mt-2 flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-md">
                                            {getFileIcon(mediaFile.name.split('.').pop() || '')}
                                            <span className="text-sm truncate flex-1">{mediaFile.name}</span>
                                            <button
                                                onClick={() => setMediaFile(null)}
                                                className="text-gray-500 hover:text-red-500"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
                            <div className="max-w-md text-center">
                                <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-2">Выберите чат</h3>
                                <p className="text-gray-500 dark:text-gray-400">
                                    Выберите групповой чат из списка или создайте новый
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

            {/* Модальное окно создания чата */}
            {showCreateModal && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
                    onClick={() => setShowCreateModal(false)}
                >
                    <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 20, opacity: 0 }}
                        className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-medium">Создать групповой чат</h3>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="chatName">Название чата</Label>
                                <Input
                                    id="chatName"
                                    value={chatName}
                                    onChange={(e) => setChatName(e.target.value)}
                                    placeholder="Введите название"
                                />
                            </div>

                            <div>
                                <Label htmlFor="chatDescription">Описание (необязательно)</Label>
                                <Input
                                    id="chatDescription"
                                    value={chatDescription}
                                    onChange={(e) => setChatDescription(e.target.value)}
                                    placeholder="Введите описание"
                                />
                            </div>

                            <div>
                                <Label>Участники</Label>
                                <div className="border rounded-md p-2 max-h-40 overflow-y-auto">
                                    {friends.map(friend => (
                                        <div key={friend.id} className="flex items-center justify-between p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                                            <div className="flex items-center gap-2">
                                                <Avatar className="w-6 h-6">
                                                    <AvatarImage src={getAvatarUrl(friend.avatar)} />
                                                    <AvatarFallback>{friend.username.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <span>{friend.username}</span>
                                            </div>
                                            <Button
                                                size="sm"
                                                variant={selectedFriends.some(f => f.id === friend.id) ? "default" : "outline"}
                                                onClick={() => {
                                                    if (selectedFriends.some(f => f.id === friend.id)) {
                                                        setSelectedFriends(prev => prev.filter(f => f.id !== friend.id));
                                                    } else {
                                                        setSelectedFriends(prev => [...prev, friend]);
                                                    }
                                                }}
                                            >
                                                {selectedFriends.some(f => f.id === friend.id) ? "Убрать" : "Добавить"}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-4">
                                <Button
                                    variant="outline"
                                    onClick={() => setShowCreateModal(false)}
                                >
                                    Отмена
                                </Button>
                                <Button
                                    onClick={createGroupChat}
                                    disabled={!chatName.trim() || selectedFriends.length === 0}
                                >
                                    Создать чат
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}

            {/* Модальное окно участников чата */}
            <AnimatePresence>
                {showMembersModal && selectedChat && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
                        onClick={() => setShowMembersModal(false)}
                    >
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 20, opacity: 0 }}
                            className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-medium">Участники чата</h3>
                                <button
                                    onClick={() => setShowMembersModal(false)}
                                    className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {chatMembers.map(member => (
                                    <div key={member.id} className="flex items-center gap-3 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                                        <div className="relative">
                                        <Avatar>
                                            <AvatarImage src={getAvatarUrl(member.avatar)} />
                                            <AvatarFallback>{member.username.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                            <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-gray-800 ${onlineUserIds.includes(member.id) ? 'bg-green-500' : 'bg-gray-400'}`} />
                                        </div>
                                        <div className="flex-1">
                                            <p className="font-medium">{member.username}</p>
                                            {member.user_tag && (
                                                <p className="text-xs text-primary">@{member.user_tag}</p>
                                            )}
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {member.id === selectedChat.creator_id ? "Создатель · " : ""}
                                                {onlineUserIds.includes(member.id) ? "Онлайн" : "Оффлайн"}
                                            </p>
                                        </div>
                                        {selectedChat.creator_id === currentUser?.id && member.id !== currentUser?.id && (
                                            <Button variant="ghost" size="sm" onClick={() => handleKickMember(member.id)} title="Исключить">
                                                <UserMinus className="w-4 h-4 text-red-500" />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Кнопка добавления участников (видна только создателю чата) */}
                            {selectedChat.creator_id === currentUser?.id && (
                                <div className="mt-4 space-y-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setShowMembersModal(false);
                                            setShowAddMembersModal(true);
                                        }}
                                        className="w-full"
                                    >
                                        <Plus className="w-4 h-4 mr-2" />
                                        Добавить участников
                                    </Button>
                                    <Button variant="destructive" onClick={handleDeleteGroupChat} className="w-full">
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Удалить группу
                                    </Button>
                                </div>
                            )}
                            {selectedChat.creator_id !== currentUser?.id && (
                                <div className="mt-4">
                                    <Button variant="outline" onClick={handleLeaveGroupChat} className="w-full">
                                        <LogOut className="w-4 h-4 mr-2" />
                                        Покинуть группу
                                    </Button>
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Модальное окно добавления участников */}
            <AnimatePresence>
                {showAddMembersModal && selectedChat && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
                        onClick={() => setShowAddMembersModal(false)}
                    >
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 20, opacity: 0 }}
                            className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-medium">Добавить участников</h3>
                                <button
                                    onClick={() => setShowAddMembersModal(false)}
                                    className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <Label>Выберите участников</Label>
                                    <div className="border rounded-md p-2 max-h-60 overflow-y-auto">
                                        {friends
                                            .filter(friend => !chatMembers.some(m => m.id === friend.id))
                                            .map(friend => (
                                                <div key={friend.id} className="flex items-center justify-between p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                                                    <div className="flex items-center gap-2">
                                                        <Avatar className="w-6 h-6">
                                                            <AvatarImage src={getAvatarUrl(friend.avatar)} />
                                                            <AvatarFallback>{friend.username.charAt(0)}</AvatarFallback>
                                                        </Avatar>
                                                        <span>{friend.username}</span>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        variant={newMembers.some(m => m.id === friend.id) ? "default" : "outline"}
                                                        onClick={() => {
                                                            if (newMembers.some(m => m.id === friend.id)) {
                                                                setNewMembers(prev => prev.filter(m => m.id !== friend.id));
                                                            } else {
                                                                setNewMembers(prev => [...prev, friend]);
                                                            }
                                                        }}
                                                    >
                                                        {newMembers.some(m => m.id === friend.id) ? "Убрать" : "Добавить"}
                                                    </Button>
                                                </div>
                                            ))}
                                    </div>
                                </div>

                                <div className="flex justify-end gap-2 pt-4">
                                    <Button
                                        variant="outline"
                                        onClick={() => setShowAddMembersModal(false)}
                                    >
                                        Отмена
                                    </Button>
                                    <Button
                                        onClick={addMembersToChat}
                                        disabled={newMembers.length === 0}
                                    >
                                        Добавить участников
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Модальное окно удаления сообщения */}
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
                            <p className="mb-4">Сообщение будет полностью удалено из группового чата.</p>

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
        </div>
    );
};

export default GroupChats;

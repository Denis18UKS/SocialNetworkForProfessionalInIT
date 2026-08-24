import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const write = (relative, source) => fs.writeFileSync(path.join(root, relative), source, 'utf8');

const replaceRequired = (source, label, from, to) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Chat platform patch failed: ${label}`);
  return source.replace(from, to);
};

const replaceRegexRequired = (source, label, pattern, replacement, alreadyMarker) => {
  if (alreadyMarker && source.includes(alreadyMarker)) return source;
  if (!pattern.test(source)) throw new Error(`Chat platform patch failed: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
};

const patchServer = () => {
  const relative = 'backend/server.js';
  let source = read(relative);
  const marker = '// SOCIALBIRD_CHAT_PLATFORM_V1: resumable-upload-stickers';
  if (!source.includes(marker)) {
    const startMarker = '// Старт сервера\n// PRODUCTION_HARDENING: configurable-listen-address';
    if (!source.includes(startMarker)) throw new Error('Chat platform patch failed: backend start marker');
    const block = `${marker}\nconst { registerResumableChatUpload } = require('./resumable-chat-upload');\nconst { registerStickers } = require('./stickers');\nregisterResumableChatUpload({\n    app,\n    db,\n    verifyToken,\n    notifyClients,\n    resolveGroupMentionRecipients,\n    notifyOfflineUsersByEmail,\n    getChatParticipants,\n    hasUserBlockBetween,\n});\nregisterStickers({\n    app,\n    db,\n    verifyToken,\n    notifyClients,\n    getChatParticipants,\n    hasUserBlockBetween,\n    resolveGroupMentionRecipients,\n});\n\n${startMarker}`;
    source = source.replace(startMarker, block);
  }
  for (const expected of [
    "require('./resumable-chat-upload')",
    "require('./stickers')",
    'registerResumableChatUpload({',
    'registerStickers({',
  ]) {
    if (!source.includes(expected)) throw new Error(`Chat platform backend verification failed: ${expected}`);
  }
  write(relative, source);
};

const injectChatImports = (source) => {
  const anchor = 'import VoiceMessageBubble from "@/components/VoiceMessageBubble";';
  const additions = `${anchor}\nimport { uploadChatFile } from "@/lib/resumable-chat-upload";\nimport { clearChatDraft, readChatDraftFiles, readChatDraftText, writeChatDraftFiles, writeChatDraftText } from "@/lib/chat-drafts";\nimport { openMediaViewer } from "@/components/MediaViewerHost";\nimport StickerPicker from "@/components/StickerPicker";\nimport StickerBubble from "@/components/StickerBubble";\nimport { sendSticker } from "@/lib/stickers";`;
  return replaceRequired(source, 'chat feature imports', anchor, additions);
};

const patchChatPage = (relative, scope) => {
  let source = read(relative);
  const isPersonal = scope === 'personal';
  const scopeLiteral = isPersonal ? 'personal' : 'group';
  source = injectChatImports(source);

  if (!source.includes('sticker_id?: number | null;')) {
    const interfaceMarker = isPersonal
      ? '    duration?: number; // Добавляем поле для длительности\n'
      : '    self_pinned?: boolean | number;\n';
    source = replaceRequired(source, `${scope} sticker interface`, interfaceMarker, `${interfaceMarker}    sticker_id?: number | null;\n`);
  }

  source = source.replace(/\nconst MAX_CHAT_UPLOAD_BYTES = 100 \* 1024 \* 1024;\n/g, '\n');

  const stateMarker = '    const [mediaFile, setMediaFile] = useState<File | null>(null);';
  const stateReplacement = `    // SOCIALBIRD_CHAT_PLATFORM_V1: per-chat-attachment-state\n    const [mediaFiles, setMediaFiles] = useState<File[]>([]);\n    const [uploadProgress, setUploadProgress] = useState(0);\n    const [isDraggingFiles, setIsDraggingFiles] = useState(false);\n    const mediaFile = mediaFiles[0] || null;\n    const setMediaFile = (file: File | null) => {\n        const nextFiles = file ? [file] : [];\n        setMediaFiles(nextFiles);\n        if (chatId) writeChatDraftFiles('${scopeLiteral}', chatId, nextFiles);\n    };`;
  source = replaceRequired(source, `${scope} attachment state`, stateMarker, stateReplacement);

  const highlightMarker = '    const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);';
  if (!source.includes(`SOCIALBIRD_CHAT_PLATFORM_V1: ${scopeLiteral}-draft-load`)) {
    const draftBlock = `${highlightMarker}\n\n    // SOCIALBIRD_CHAT_PLATFORM_V1: ${scopeLiteral}-draft-load\n    useEffect(() => {\n        if (!chatId) return;\n        setNewMessage(readChatDraftText('${scopeLiteral}', chatId));\n        setMediaFiles(readChatDraftFiles('${scopeLiteral}', chatId));\n    }, [chatId]);`;
    source = replaceRequired(source, `${scope} draft load`, highlightMarker, draftBlock);
  }

  const fileHandlerPattern = /    const handleFileChange = \(e: React\.ChangeEvent<HTMLInputElement>\) => \{[\s\S]*?\n    \};\n\n    const sendMediaMessage = async \(file: File, messageText = newMessage\.trim\(\)\) => \{[\s\S]*?\n    \};\n\n    sendVoiceMessageRef\.current = \(file: File\) => \{/;
  const selectedGuard = isPersonal
    ? `        if (isBlockedBySelectedUser) {\n            toast.error("Данный пользователь ограничил круг лиц");\n            return null;\n        }\n        if (isSelectedUserBlocked) {\n            toast.error("Вы добавили пользователя в черный список");\n            return null;\n        }\n        const targetChatId = Number(chatId);\n        if (!targetChatId) return null;`
    : `        if (!selectedChat) {\n            toast.error('Чат не выбран');\n            return null;\n        }\n        const targetChatId = Number(selectedChat.id);`;
  const fileHandlerReplacement = `    // SOCIALBIRD_CHAT_PLATFORM_V1: drag-drop-resumable-upload\n    const appendMediaFiles = (files: File[]) => {\n        const accepted = files.filter((file) => file.size > 0);\n        if (accepted.length === 0) return;\n        const nextFiles = [...mediaFiles, ...accepted];\n        setMediaFiles(nextFiles);\n        if (chatId) writeChatDraftFiles('${scopeLiteral}', chatId, nextFiles);\n    };\n\n    const removeMediaFile = (index: number) => {\n        const nextFiles = mediaFiles.filter((_, itemIndex) => itemIndex !== index);\n        setMediaFiles(nextFiles);\n        if (chatId) writeChatDraftFiles('${scopeLiteral}', chatId, nextFiles);\n    };\n\n    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {\n        appendMediaFiles(Array.from(e.target.files || []));\n        e.target.value = '';\n    };\n\n    const handleFileDrop = (event: React.DragEvent) => {\n        event.preventDefault();\n        setIsDraggingFiles(false);\n        appendMediaFiles(Array.from(event.dataTransfer.files || []));\n    };\n\n    const sendMediaMessage = async (file: File, messageText = newMessage.trim()) => {\n${selectedGuard}\n        try {\n            setUploadProgress(1);\n            const sentMessage = await uploadChatFile({\n                scope: '${scopeLiteral}',\n                chatId: targetChatId,\n                file,\n                message: messageText,\n                onProgress: setUploadProgress,\n            });\n            setMessages(prev => [...prev, sentMessage]);\n            setTimeout(scrollToBottom, 100);\n            return sentMessage;\n        } catch (error) {\n            console.error('Resumable upload error:', error);\n            toast.error(error instanceof Error ? error.message : 'Не удалось загрузить файл');\n            return null;\n        } finally {\n            setUploadProgress(0);\n        }\n    };\n\n    sendVoiceMessageRef.current = (file: File) => {`;
  source = replaceRegexRequired(source, `${scope} resumable upload handlers`, fileHandlerPattern, fileHandlerReplacement, 'SOCIALBIRD_CHAT_PLATFORM_V1: drag-drop-resumable-upload');

  const mediaBranch = `        if (mediaFile) {\n            await sendMediaMessage(mediaFile);\n            return;\n        }`;
  const mediaBranchReplacement = `        if (mediaFiles.length > 0) {\n            const queuedFiles = [...mediaFiles];\n            let completed = true;\n            for (let index = 0; index < queuedFiles.length; index += 1) {\n                const sent = await sendMediaMessage(queuedFiles[index], index === 0 ? newMessage.trim() : '');\n                if (!sent) { completed = false; break; }\n            }\n            if (completed) {\n                setNewMessage('');\n                setMediaFiles([]);\n                if (chatId) clearChatDraft('${scopeLiteral}', chatId);\n            }\n            return;\n        }`;
  source = replaceRequired(source, `${scope} multi-file send`, mediaBranch, mediaBranchReplacement);

  const voiceMarker = `    sendVoiceMessageRef.current = (file: File) => {\n        void sendMediaMessage(file, voiceTranscriptRef.current);\n    };`;
  if (!source.includes(`SOCIALBIRD_CHAT_PLATFORM_V1: ${scopeLiteral}-stickers`)) {
    const stickerChatId = isPersonal ? 'Number(chatId)' : 'Number(selectedChat?.id || chatId)';
    const restriction = isPersonal
      ? `        if (isBlockedBySelectedUser || isSelectedUserBlocked) {\n            toast.error(isBlockedBySelectedUser ? 'Данный пользователь ограничил круг лиц' : 'Сначала разблокируйте пользователя');\n            return;\n        }\n`
      : '';
    const stickerBlock = `${voiceMarker}\n\n    // SOCIALBIRD_CHAT_PLATFORM_V1: ${scopeLiteral}-stickers\n    const handleSendSticker = async (stickerId: number) => {\n${restriction}        const targetChatId = ${stickerChatId};\n        if (!targetChatId) return;\n        try {\n            const sentMessage = await sendSticker('${scopeLiteral}', targetChatId, stickerId);\n            setMessages((current) => [...current, sentMessage]);\n            setTimeout(scrollToBottom, 100);\n        } catch (error) {\n            toast.error(error instanceof Error ? error.message : 'Не удалось отправить стикер');\n        }\n    };`;
    source = replaceRequired(source, `${scope} sticker sender`, voiceMarker, stickerBlock);
  }

  if (!source.includes('socialbird-message-row')) {
    source = source.replace(
      "className={`flex rounded-xl transition-shadow ${msg.user_id === currentUser?.id ? 'justify-end' : 'justify-start'}",
      "className={`socialbird-message-row flex rounded-xl transition-shadow ${msg.user_id === currentUser?.id ? 'justify-end' : 'justify-start'}",
    );
  }
  if (!source.includes('socialbird-message-bubble')) {
    source = source.replace('className={`min-w-0 max-w-[88%] overflow-hidden break-words rounded-lg p-2.5', 'className={`socialbird-message-bubble min-w-0 max-w-[88%] overflow-hidden break-words rounded-lg p-2.5');
    source = source.replace('className={`max-w-[88%] break-words rounded-lg p-3', 'className={`socialbird-message-bubble min-w-0 max-w-[88%] break-words rounded-lg p-3');
  }

  const messageTextMarker = isPersonal
    ? '                                                {msg.message && (!isVoiceMessage(msg) || revealedVoiceTextIds[msg.id]) && ('
    : '                                                    {msg.message && (!isVoiceMessage(msg) || revealedVoiceTextIds[msg.id]) && (';
  if (!source.includes('<StickerBubble stickerId={Number(msg.sticker_id)} />')) {
    const indent = isPersonal ? '                                                ' : '                                                    ';
    source = replaceRequired(
      source,
      `${scope} sticker rendering`,
      messageTextMarker,
      `${indent}{msg.sticker_id ? <StickerBubble stickerId={Number(msg.sticker_id)} /> : null}\n\n${messageTextMarker}`,
    );
  }

  source = source.replace(
    'className="max-w-full max-h-64 object-contain rounded"',
    'data-chat-media="image" onClick={() => openMediaViewer({ type: "image", src: mediaUrl, title: msg.file_name || "Изображение" })} className="max-w-full max-h-64 cursor-zoom-in object-contain rounded"',
  );
  source = source.replace(
    '<video controls className="max-w-full rounded">',
    '<video controls playsInline preload="metadata" data-chat-media="video" className="max-w-full max-h-[52dvh] rounded">',
  );

  const outerClass = '<div className="h-full min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">';
  source = replaceRequired(source, `${scope} workspace class`, outerClass, '<div className="socialbird-chat-workspace h-full min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">');

  const composerClass = '<div className="mobile-bottom-safe shrink-0 border-t border-gray-200 bg-white px-2 pb-2 pt-2 dark:border-gray-700 dark:bg-gray-800 sm:p-4">';
  if (!source.includes('socialbird-chat-composer')) {
    const composerReplacement = `<div\n                                className="socialbird-chat-composer mobile-bottom-safe shrink-0 border-t border-gray-200 bg-white px-2 pb-2 pt-2 dark:border-gray-700 dark:bg-gray-800 sm:p-4"\n                                onDragEnter={(event) => { event.preventDefault(); setIsDraggingFiles(true); }}\n                                onDragOver={(event) => { event.preventDefault(); setIsDraggingFiles(true); }}\n                                onDragLeave={(event) => {\n                                    if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDraggingFiles(false);\n                                }}\n                                onDrop={handleFileDrop}\n                            >\n                                {isDraggingFiles && <div className="socialbird-chat-drop-overlay">Перетащите файлы сюда</div>}`;
    source = replaceRequired(source, `${scope} composer drop zone`, composerClass, composerReplacement);
  }

  source = source.replace('className="flex min-w-0 items-end gap-1.5 sm:gap-2"', 'data-composer-controls="true" className="flex min-w-0 items-end gap-1.5 sm:gap-2"');
  source = source.replace('className="flex items-center gap-1 relative"', 'data-composer-tools="true" className="flex items-center gap-1 relative"');

  const emojiButtonEnd = `                                            </button>\n\n                                            {/* Кнопка записи аудио */}`;
  if (!source.includes('<StickerPicker onSelect={handleSendSticker}')) {
    source = replaceRequired(
      source,
      `${scope} sticker picker`,
      emojiButtonEnd,
      `                                            </button>\n\n                                            <StickerPicker onSelect={handleSendSticker} />\n\n                                            {/* Кнопка записи аудио */}`,
    );
  }

  source = source.replace(
    'onChange={(e) => setNewMessage(e.target.value)}',
    `onChange={(e) => {\n                                                    setNewMessage(e.target.value);\n                                                    if (chatId) writeChatDraftText('${scopeLiteral}', chatId, e.target.value);\n                                                }}`,
  );
  source = source.replace('accept="image/*,video/*,audio/*,.pdf,.zip,.rar,.7z"', 'multiple');
  source = source.replace('disabled={!newMessage.trim() && !mediaFile}', 'disabled={!newMessage.trim() && mediaFiles.length === 0}');

  const queueAnchor = isPersonal ? '                                    {mediaFile && (' : '                                    {mediaFile && !mediaFile.type.startsWith(\'audio/\') && (';
  if (!source.includes('SOCIALBIRD_CHAT_PLATFORM_V1: attachment-queue-ui')) {
    const queueBlock = `                                    {/* SOCIALBIRD_CHAT_PLATFORM_V1: attachment-queue-ui */}\n                                    {mediaFiles.length > 1 && (\n                                        <div className="socialbird-chat-attachment-row mt-2 space-y-1 rounded-lg bg-gray-100 p-2 dark:bg-gray-700">\n                                            {mediaFiles.map((file, index) => (\n                                                <div key={\`${'${file.name}'}-${'${file.lastModified}'}-${'${index}'}\`} className="flex min-w-0 items-center gap-2 text-sm">\n                                                    <FileIcon className="h-4 w-4 shrink-0 text-gray-500" />\n                                                    <span className="min-w-0 flex-1 truncate">{file.name}</span>\n                                                    <button type="button" onClick={() => removeMediaFile(index)} className="shrink-0 text-gray-500 hover:text-red-500"><X className="h-4 w-4" /></button>\n                                                </div>\n                                            ))}\n                                        </div>\n                                    )}\n                                    {uploadProgress > 0 && uploadProgress < 100 && (\n                                        <div className="mt-2 text-xs text-muted-foreground">Загрузка без сжатия: {uploadProgress}%</div>\n                                    )}\n\n${queueAnchor}`;
    source = replaceRequired(source, `${scope} attachment queue`, queueAnchor, queueBlock);
  }

  if (!source.includes(`clearChatDraft('${scopeLiteral}'`)) {
    throw new Error(`Chat platform verification failed: ${scope} draft clear missing`);
  }
  for (const expected of [
    'uploadChatFile({',
    'handleFileDrop',
    'StickerPicker',
    'StickerBubble',
    'openMediaViewer({ type: "image"',
    'mediaFiles.length > 0',
  ]) {
    if (!source.includes(expected)) throw new Error(`Chat platform verification failed in ${relative}: ${expected}`);
  }
  write(relative, source);
};

const patchApp = () => {
  const relative = 'src/App.tsx';
  let source = read(relative);
  const seoImport = "import SeoManager from './components/SeoManager';";
  const imports = `${seoImport}\nimport MediaViewerHost from './components/MediaViewerHost';\nimport './styles/chat-platform-v1.css';`;
  source = replaceRequired(source, 'App media viewer imports', seoImport, imports);
  const toasters = '        <Sonner />\n        <AuthProvider>';
  source = replaceRequired(source, 'App media viewer host', toasters, '        <Sonner />\n        <MediaViewerHost />\n        <AuthProvider>');
  write(relative, source);
};

patchServer();
patchChatPage('src/pages/Chats.tsx', 'personal');
patchChatPage('src/pages/GroupChats.tsx', 'group');
patchApp();
console.log('SocialBIRD chat platform v1 applied: resumable uploads, isolated drafts, drag/drop, media viewer and stickers.');

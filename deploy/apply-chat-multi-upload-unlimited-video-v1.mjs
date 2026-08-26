import fs from 'node:fs';

const markerPersonal = '// SOCIALBIRD_CHAT_MULTI_UPLOAD_V1: personal';
const markerGroup = '// SOCIALBIRD_CHAT_MULTI_UPLOAD_V1: group';
const markerBackend = '// SOCIALBIRD_CHAT_MULTI_UPLOAD_V1: unlimited-video-backend';
const markerNginx = '# SOCIALBIRD_CHAT_MULTI_UPLOAD_V1: unlimited-video-api-body';

const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`Chat multi-upload V1 patch failed: ${label}`);
  return source.replace(from, to);
};

const helpers = (marker) => `${marker}\nconst CHAT_VIDEO_EXTENSION_RE = /\\.(mp4|webm|ogg|ogv|mov|mkv|avi|m4v|mpeg|mpg|3gp|3g2|ts|m2ts|wmv|flv)$/i;\nconst CHAT_UPLOAD_PARALLELISM = 3;\n\nconst isUnlimitedChatVideo = (file: File) =>\n    String(file.type || '').toLowerCase().startsWith('video/') || CHAT_VIDEO_EXTENSION_RE.test(String(file.name || ''));\n\nconst isAllowedChatFileSize = (file: File) => isUnlimitedChatVideo(file) || file.size <= MAX_CHAT_UPLOAD_BYTES;\n\nconst chatFileKey = (file: File) => \`${'${file.name}'}:${'${file.size}'}:${'${file.lastModified}'}\`;`;

const patchChatPage = (file, isGroup) => {
  let source = fs.readFileSync(file, 'utf8');
  const marker = isGroup ? markerGroup : markerPersonal;
  if (source.includes(marker)) return;

  const helperAnchor = `const MAX_CHAT_UPLOAD_BYTES = 100 * 1024 * 1024;\nconst MAX_TRANSPORT_FILENAME_CHARS = 48;`;
  source = replaceRequired(source, helperAnchor, `${helperAnchor}\n${helpers(marker)}`, `${file}: helper anchor`);

  source = replaceRequired(
    source,
    `    const [mediaFile, setMediaFile] = useState<File | null>(null);`,
    `    const [mediaFiles, setMediaFiles] = useState<File[]>([]);\n    const [isUploadingMedia, setIsUploadingMedia] = useState(false);\n    const [mediaUploadProgress, setMediaUploadProgress] = useState({ done: 0, total: 0 });`,
    `${file}: media state`,
  );

  const groupHandler = `    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {\n        if (e.target.files && e.target.files.length > 0) {\n            setMediaFile(e.target.files[0]);\n        }\n    };`;
  const personalHandler = `    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {\n        if (e.target.files && e.target.files.length > 0) {\n            const file = e.target.files[0];\n            if (file.size > MAX_CHAT_UPLOAD_BYTES) {\n                toast.error(\"Файл слишком большой. Максимальный размер — 100 МБ.\");\n                e.target.value = \"\";\n                setMediaFile(null);\n                return;\n            }\n            setMediaFile(file);\n        }\n    };`;
  const newHandler = `    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {\n        const selected = Array.from(e.target.files || []);\n        e.target.value = \"\";\n        if (!selected.length) return;\n\n        const accepted = selected.filter(isAllowedChatFileSize);\n        const rejected = selected.length - accepted.length;\n        if (rejected > 0) {\n            toast.error(\`${'${rejected}'} файл(а/ов) не добавлены: для файлов кроме видео действует лимит 100 МБ. Видео загружаются без ограничения размера.\`);\n        }\n        if (!accepted.length) return;\n\n        setMediaFiles((current) => {\n            const seen = new Set(current.map(chatFileKey));\n            return [...current, ...accepted.filter((file) => !seen.has(chatFileKey(file)))];\n        });\n    };`;
  source = replaceRequired(source, isGroup ? groupHandler : personalHandler, newHandler, `${file}: file selection`);

  const mediaSizeCheck = `        if (file.size > MAX_CHAT_UPLOAD_BYTES) {\n            toast.error(\"Файл слишком большой. Максимальный размер — 100 МБ.\");\n            return;\n        }`;
  if (source.includes(mediaSizeCheck)) {
    source = source.replace(mediaSizeCheck, `        if (!isUnlimitedChatVideo(file) && file.size > MAX_CHAT_UPLOAD_BYTES) {\n            toast.error(\"Файл слишком большой. Для файлов кроме видео действует лимит 100 МБ.\");\n            return false;\n        }`);
  }

  if (isGroup) {
    source = replaceRequired(
      source,
      `            if (!response.ok) throw new Error('Ошибка при отправке сообщения');\n            const sentMessage = await response.json();\n            setMessages(prev => [...prev, sentMessage]);\n            setNewMessage('');\n            setMediaFile(null);\n            setTimeout(scrollToBottom, 100);\n        } catch (error) {\n            console.error('Ошибка:', error);\n            toast.error('Ошибка при отправке сообщения');\n        }\n    };`,
      `            if (!response.ok) {\n                const errorData = await response.json().catch(() => null);\n                throw new Error(errorData?.message || 'Ошибка при отправке сообщения');\n            }\n            const sentMessage = await response.json();\n            setMessages(prev => [...prev, sentMessage]);\n            setTimeout(scrollToBottom, 100);\n            return true;\n        } catch (error) {\n            console.error('Ошибка:', error);\n            toast.error(error instanceof Error ? error.message : 'Ошибка при отправке сообщения');\n            return false;\n        }\n    };`,
      `${file}: media send completion`,
    );
  } else {
    source = replaceRequired(
      source,
      `            const sentMessage = await response.json();\n            setMessages(prev => [...prev, sentMessage]);\n            setNewMessage('');\n            setMediaFile(null);\n            setTimeout(scrollToBottom, 100);\n        } catch (error) {\n            console.error('Ошибка:', error);\n            toast.error(error instanceof Error ? error.message : \"Не удалось отправить сообщение\");\n        }\n    };`,
      `            const sentMessage = await response.json();\n            setMessages(prev => [...prev, sentMessage]);\n            setTimeout(scrollToBottom, 100);\n            return true;\n        } catch (error) {\n            console.error('Ошибка:', error);\n            toast.error(error instanceof Error ? error.message : \"Не удалось отправить сообщение\");\n            return false;\n        }\n    };`,
      `${file}: media send completion`,
    );
  }

  const sendMessageOld = `    const sendMessage = async () => {\n        if (newMessage.trim() === '' && !mediaFile) return;\n\n        if (mediaFile) {\n            await sendMediaMessage(mediaFile);\n            return;\n        }`;
  const sendMessageNew = `    const sendMessage = async () => {\n        if (newMessage.trim() === '' && mediaFiles.length === 0) return;\n        if (isUploadingMedia) return;\n\n        if (mediaFiles.length > 0) {\n            const queue = [...mediaFiles];\n            const caption = newMessage.trim();\n            const results = new Array<boolean>(queue.length).fill(false);\n            let cursor = 0;\n            let completed = 0;\n            setIsUploadingMedia(true);\n            setMediaUploadProgress({ done: 0, total: queue.length });\n\n            const worker = async () => {\n                while (true) {\n                    const index = cursor++;\n                    if (index >= queue.length) return;\n                    results[index] = Boolean(await sendMediaMessage(queue[index], index === 0 ? caption : ''));\n                    completed += 1;\n                    setMediaUploadProgress({ done: completed, total: queue.length });\n                }\n            };\n\n            try {\n                const workers = Array.from({ length: Math.min(CHAT_UPLOAD_PARALLELISM, queue.length) }, () => worker());\n                await Promise.all(workers);\n                const failed = queue.filter((_file, index) => !results[index]);\n                setMediaFiles(failed);\n                if (results.some(Boolean)) setNewMessage('');\n                if (!failed.length) toast.success(queue.length > 1 ? \`Отправлено файлов: ${'${queue.length}'}\` : 'Файл отправлен');\n                else toast.error(\`Не удалось отправить файлов: ${'${failed.length}'}. Они оставлены в очереди.\`);\n            } finally {\n                setIsUploadingMedia(false);\n                setMediaUploadProgress({ done: 0, total: 0 });\n            }\n            return;\n        }`;
  source = replaceRequired(source, sendMessageOld, sendMessageNew, `${file}: multi send queue`);

  source = source.replace(/(<input\n\s+type="file"\n)(\s+onChange=\{handleFileChange\})/g, `$1                                                multiple\n$2`);
  source = source.replace(`                                            disabled={!newMessage.trim() && !mediaFile}`, `                                            disabled={isUploadingMedia || (!newMessage.trim() && mediaFiles.length === 0)}`);

  const audioBlockRe = /\n\s*\{\/\* Обработка отображения аудиофайла \*\/\}\n\s*\{mediaFile\?\.type\.startsWith\('audio\/'\) && \([\s\S]*?\n\s*\)\}\n/;
  source = source.replace(audioBlockRe, '\n');

  const previewStart = isGroup ? `                                    {mediaFile && !mediaFile.type.startsWith('audio/') && (` : `                                    {mediaFile && (`;
  const previewIndex = source.indexOf(previewStart);
  if (previewIndex < 0) throw new Error(`Chat multi-upload V1 patch failed: ${file}: preview start`);
  const previewEndNeedle = `                                    )}`;
  const previewEnd = source.indexOf(previewEndNeedle, previewIndex);
  if (previewEnd < 0) throw new Error(`Chat multi-upload V1 patch failed: ${file}: preview end`);
  const previewNew = `                                    {mediaFiles.length > 0 && (\n                                        <div className=\"mt-2 space-y-1 rounded-md bg-gray-100 p-2 dark:bg-gray-700\">\n                                            <div className=\"flex items-center justify-between gap-2 text-xs text-muted-foreground\">\n                                                <span>Выбрано файлов: {mediaFiles.length}</span>\n                                                {isUploadingMedia && mediaUploadProgress.total > 0 && <span>Отправка {mediaUploadProgress.done}/{mediaUploadProgress.total}</span>}\n                                            </div>\n                                            {mediaFiles.map((file, index) => (\n                                                <div key={chatFileKey(file)} className=\"flex min-w-0 items-center gap-2 rounded bg-background/70 px-2 py-1.5\">\n                                                    <FileIcon className=\"h-4 w-4 shrink-0 text-gray-500\" />\n                                                    <span className=\"min-w-0 flex-1 truncate text-sm\">{file.name}</span>\n                                                    {isUnlimitedChatVideo(file) && <span className=\"shrink-0 text-[10px] font-medium text-purple-500\">видео · без лимита</span>}\n                                                    <button type=\"button\" disabled={isUploadingMedia} onClick={() => setMediaFiles((current) => current.filter((_item, itemIndex) => itemIndex !== index))} className=\"shrink-0 text-gray-500 hover:text-red-500 disabled:opacity-40\" title=\"Убрать файл из отправки\">\n                                                        <X className=\"h-4 w-4\" />\n                                                    </button>\n                                                </div>\n                                            ))}\n                                        </div>\n                                    )}`;
  source = source.slice(0, previewIndex) + previewNew + source.slice(previewEnd + previewEndNeedle.length);

  if (!source.includes('multiple') || !source.includes('mediaFiles.length') || !source.includes(marker)) throw new Error(`Chat multi-upload V1 verification failed: ${file}`);
  fs.writeFileSync(file, source, 'utf8');
};

const patchBackend = () => {
  const file = 'backend/server.js';
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(markerBackend)) return;

  const oldMiddleware = `const uploadChatMedia = (req, res, next) => {\n    upload.single('media')(req, res, (error) => {\n        if (!error) return next();\n        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {\n            return res.status(413).json({\n                message: 'Файл слишком большой. Максимальный размер — 100 МБ.',\n                code: 'FILE_TOO_LARGE',\n            });\n        }\n        console.error('Chat upload middleware error:', error);\n        return res.status(400).json({\n            message: 'Не удалось принять файл. Проверьте файл и повторите попытку.',\n            code: error?.code || 'UPLOAD_ERROR',\n        });\n    });\n};`;
  const newMiddleware = `${markerBackend}\nconst CHAT_NON_VIDEO_MAX_UPLOAD_BYTES = Number(process.env.MAX_CHAT_NON_VIDEO_UPLOAD_BYTES || 100 * 1024 * 1024);\nconst CHAT_VIDEO_EXTENSION_RE = /\\.(mp4|webm|ogg|ogv|mov|mkv|avi|m4v|mpeg|mpg|3gp|3g2|ts|m2ts|wmv|flv)$/i;\nconst chatUpload = multer({ storage, limits: { files: 1 } });\nconst isChatVideoUpload = (file) => Boolean(file) && (\n    String(file.mimetype || '').toLowerCase().startsWith('video/') ||\n    CHAT_VIDEO_EXTENSION_RE.test(String(file.originalname || file.filename || ''))\n);\n\nconst uploadChatMedia = (req, res, next) => {\n    chatUpload.single('media')(req, res, async (error) => {\n        if (error) {\n            console.error('Chat upload middleware error:', error);\n            return res.status(400).json({\n                message: 'Не удалось принять файл. Проверьте файл и повторите попытку.',\n                code: error?.code || 'UPLOAD_ERROR',\n            });\n        }\n        if (req.file && !isChatVideoUpload(req.file) && Number(req.file.size || 0) > CHAT_NON_VIDEO_MAX_UPLOAD_BYTES) {\n            await fs.promises.unlink(req.file.path).catch(() => undefined);\n            return res.status(413).json({\n                message: 'Файл слишком большой. Для файлов кроме видео действует лимит 100 МБ.',\n                code: 'FILE_TOO_LARGE',\n            });\n        }\n        return next();\n    });\n};`;
  source = replaceRequired(source, oldMiddleware, newMiddleware, 'backend upload middleware');
  fs.writeFileSync(file, source, 'utf8');
};

const patchNginxTemplate = () => {
  const file = 'deploy/nginx-socialbird.conf.template';
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(markerNginx)) return;
  const apiIndex = source.indexOf('server_name ${API_DOMAIN};');
  if (apiIndex < 0) throw new Error('Chat multi-upload V1 patch failed: nginx API server block');
  const limitIndex = source.indexOf('client_max_body_size 100m;', apiIndex);
  if (limitIndex < 0) throw new Error('Chat multi-upload V1 patch failed: nginx API body limit');
  source = source.slice(0, limitIndex) + `client_max_body_size 0;\n    ${markerNginx}` + source.slice(limitIndex + 'client_max_body_size 100m;'.length);
  fs.writeFileSync(file, source, 'utf8');
};

patchChatPage('src/pages/Chats.tsx', false);
patchChatPage('src/pages/GroupChats.tsx', true);
patchBackend();
patchNginxTemplate();
console.log('Chat multi-upload V1 applied: multiple queued uploads, up to 3 concurrent transfers, unlimited video size, existing non-video 100 MB policy preserved.');
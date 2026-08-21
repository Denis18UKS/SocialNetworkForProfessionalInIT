import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(deployDirectory, '..');

const patch = (relativePath, transform) => {
  const filePath = path.join(root, relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  const initial = source;
  source = transform(source);
  if (source !== initial) {
    fs.writeFileSync(filePath, source, 'utf8');
    console.log(`Applied call/mobile/upload fixes: ${relativePath}`);
  }
};

const replaceRequired = (source, label, from, to) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Call/mobile/upload fix failed: ${label}`);
  return source.replace(from, to);
};

patch('src/App.tsx', (input) => {
  let source = input;
  if (!source.includes('--app-viewport-bottom')) {
    source = replaceRequired(
      source,
      'visual viewport bottom',
      `      const visibleHeight = Math.max(320, Math.round(viewport?.height || window.innerHeight));
      const visibleTop = Math.max(0, Math.round(viewport?.offsetTop || 0));

      document.documentElement.style.setProperty("--app-viewport-height", \`\${visibleHeight}px\`);
      document.documentElement.style.setProperty("--app-viewport-top", \`\${visibleTop}px\`);`,
      `      const visibleHeight = Math.max(320, Math.round(viewport?.height || window.innerHeight));
      const visibleTop = Math.max(0, Math.round(viewport?.offsetTop || 0));
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);
      const visibleBottom = Math.max(
        0,
        Math.min(140, Math.round(layoutHeight - visibleTop - (viewport?.height || layoutHeight))),
      );

      document.documentElement.style.setProperty("--app-viewport-height", \`\${visibleHeight}px\`);
      document.documentElement.style.setProperty("--app-viewport-top", \`\${visibleTop}px\`);
      document.documentElement.style.setProperty("--app-viewport-bottom", \`\${visibleBottom}px\`);`
    );
  }
  return source;
});

patch('src/index.css', (input) => {
  let source = input;
  if (!source.includes('--app-viewport-bottom:')) {
    source = replaceRequired(
      source,
      'viewport bottom css variable',
      `    --app-viewport-top: 0px;
    --mobile-safe-bottom: max(env(safe-area-inset-bottom, 0px), 10px);`,
      `    --app-viewport-top: 0px;
    --app-viewport-bottom: 0px;
    --mobile-safe-bottom: max(env(safe-area-inset-bottom, 0px), 10px);
    --mobile-visible-bottom: max(var(--mobile-safe-bottom), var(--app-viewport-bottom, 0px));`
    );
  }

  source = replaceRequired(
    source,
    'mobile bottom safe',
    `  .mobile-bottom-safe {
    padding-bottom: var(--mobile-safe-bottom);
  }

  .mobile-floating-bottom {
    bottom: calc(1rem + var(--mobile-safe-bottom));
  }`,
    `  .mobile-bottom-safe {
    padding-bottom: calc(8px + var(--mobile-visible-bottom, var(--mobile-safe-bottom)));
  }

  .mobile-floating-bottom {
    bottom: calc(0.75rem + var(--mobile-visible-bottom, var(--mobile-safe-bottom)));
  }

  .itbird-call-panel {
    bottom: calc(0.75rem + var(--mobile-visible-bottom, var(--mobile-safe-bottom))) !important;
  }

  .itbird-call-remote-video {
    width: min(100%, 320px);
    max-width: 100%;
    aspect-ratio: 16 / 9;
    height: auto !important;
    object-fit: cover;
  }

  @media (max-width: 640px) {
    .itbird-call-panel {
      left: 8px !important;
      right: 8px !important;
      width: auto !important;
      max-width: none !important;
      max-height: min(62dvh, calc(var(--app-viewport-height, 100dvh) - 1rem - var(--mobile-visible-bottom, 0px))) !important;
      padding: 0.75rem !important;
      gap: 0.65rem !important;
      border-radius: 1rem !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      overscroll-behavior: contain;
    }

    .itbird-call-participants {
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      flex-wrap: nowrap !important;
      justify-content: flex-start !important;
      padding-bottom: 2px;
      scrollbar-width: none;
    }

    .itbird-call-participants::-webkit-scrollbar {
      display: none;
    }
  }`
  );
  return source;
});

patch('src/components/VoiceMessageBubble.tsx', (input) => {
  let source = input;
  source = replaceRequired(
    source,
    'voice bubble width',
    `    <div className="mt-2 w-full min-w-0 rounded-2xl bg-[#8064c8] px-3 py-2 text-white shadow-sm sm:w-[300px] sm:max-w-[76vw]">`,
    `    <div className="mt-2 w-full min-w-0 max-w-full overflow-hidden rounded-2xl bg-[#8064c8] px-2.5 py-2 text-white shadow-sm sm:w-[300px] sm:max-w-[76vw] sm:px-3">`
  );
  source = replaceRequired(
    source,
    'voice bubble row gap',
    `      <div className="flex min-w-0 items-center gap-3">`,
    `      <div className="flex min-w-0 max-w-full items-center gap-2 sm:gap-3">`
  );
  return source;
});

patch('src/pages/Chats.tsx', (input) => {
  let source = input;

  if (!source.includes('MAX_CHAT_UPLOAD_BYTES')) {
    source = replaceRequired(
      source,
      'chat upload size constant',
      `const Chats = () => {

    const [socket, setSocket] = useState<WebSocket | null>(null);`,
      `const MAX_CHAT_UPLOAD_BYTES = 100 * 1024 * 1024;

const Chats = () => {

    const [socket, setSocket] = useState<WebSocket | null>(null);`
    );
  }

  source = replaceRequired(
    source,
    'file size validation',
    `    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setMediaFile(e.target.files[0]);
        }
    };`,
    `    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            if (file.size > MAX_CHAT_UPLOAD_BYTES) {
                toast.error("Файл слишком большой. Максимальный размер — 100 МБ.");
                e.target.value = "";
                setMediaFile(null);
                return;
            }
            setMediaFile(file);
        }
    };`
  );

  if (!source.includes('file.size > MAX_CHAT_UPLOAD_BYTES')) {
    throw new Error('Call/mobile/upload fix failed: file size validation missing');
  }

  if (!source.includes('const sendMediaMessage = async (file: File, messageText = newMessage.trim()) => {\n        if (file.size > MAX_CHAT_UPLOAD_BYTES)')) {
    source = replaceRequired(
      source,
      'send media size validation',
      `    const sendMediaMessage = async (file: File, messageText = newMessage.trim()) => {
        if (isBlockedBySelectedUser) {`,
      `    const sendMediaMessage = async (file: File, messageText = newMessage.trim()) => {
        if (file.size > MAX_CHAT_UPLOAD_BYTES) {
            toast.error("Файл слишком большой. Максимальный размер — 100 МБ.");
            return;
        }
        if (isBlockedBySelectedUser) {`
    );
  }

  source = replaceRequired(
    source,
    'mobile main chat width',
    `                <div className={\`\${selectedUser ? "flex" : "hidden md:flex"} min-h-0 flex-1 flex-col\`}>`,
    `                <div className={\`\${selectedUser ? "flex" : "hidden md:flex"} min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-hidden\`}>`
  );

  source = replaceRequired(
    source,
    'chat header width',
    `                            <Card className="shrink-0 rounded-none border-0 border-b border-gray-200 dark:border-gray-700">`,
    `                            <Card className="w-full min-w-0 max-w-full shrink-0 overflow-hidden rounded-none border-0 border-b border-gray-200 dark:border-gray-700">`
  );

  source = replaceRequired(
    source,
    'chat action row width',
    `                                    <div className="mt-2 flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mt-3 sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">`,
    `                                    <div className="mt-2 flex w-full min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mt-3 sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0 sm:pr-0">`
  );

  source = replaceRequired(
    source,
    'messages content width',
    `                                <div className="max-w-3xl mx-auto space-y-4">`,
    `                                <div className="mx-auto w-full min-w-0 max-w-3xl space-y-4 overflow-x-hidden">`
  );

  source = replaceRequired(
    source,
    'message bubble width',
    `                                                className={\`max-w-[88%] break-words rounded-lg p-3 sm:max-w-[80%] \${msg.user_id === currentUser?.id`,
    `                                                className={\`min-w-0 max-w-[88%] overflow-hidden break-words rounded-lg p-2.5 sm:max-w-[80%] sm:p-3 \${msg.user_id === currentUser?.id`
  );

  source = replaceRequired(
    source,
    'download link width',
    `                                                                className="inline-flex items-center gap-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-1 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"`,
    `                                                                className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md border border-gray-200 bg-white px-2.5 py-1 text-gray-800 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 sm:px-3"`
  );

  source = replaceRequired(
    source,
    'download label truncation',
    `                                                                <span>{label}</span>
                                                                {fileSize && (
                                                                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">`,
    `                                                                <span className="min-w-0 flex-1 truncate">{label}</span>
                                                                {fileSize && (
                                                                    <span className="ml-1 shrink-0 text-xs text-gray-500 dark:text-gray-400 sm:ml-2">`
  );

  source = replaceRequired(
    source,
    'composer width',
    `                                <div className="max-w-3xl mx-auto">`,
    `                                <div className="mx-auto w-full min-w-0 max-w-3xl">`
  );

  return source;
});

patch('src/components/VoiceCallControls.tsx', (input) => {
  let source = input;

  source = replaceRequired(
    source,
    'remote video class',
    `      media.className = "h-28 w-44 rounded-lg bg-black object-cover shadow-xl";`,
    `      media.className = "itbird-call-remote-video rounded-lg bg-black object-cover shadow-xl";`
  );

  source = replaceRequired(
    source,
    'hangup targets fallback',
    `    const targetIds = Object.keys(peersRef.current).map(Number);
    if (targetIds.length > 0) sendSignal("CALL_HANGUP", targetIds, { endForAll: true });`,
    `    const targetIds = Array.from(new Set([
      ...Object.keys(peersRef.current).map(Number),
      ...callTargets.map(Number),
    ])).filter(Number.isFinite);
    if (targetIds.length > 0) sendSignal("CALL_HANGUP", targetIds, { endForAll: true });`
  );

  source = replaceRequired(
    source,
    'call ended detail',
    `    window.dispatchEvent(new CustomEvent("itbird-call-ended"));`,
    `    window.dispatchEvent(new CustomEvent("itbird-call-ended", {
      detail: { chatId, mode, source: "VoiceCallControls" },
    }));`
  );

  source = replaceRequired(
    source,
    'outgoing call panel class',
    `        <div className="fixed inset-x-0 bottom-[calc(1rem+var(--mobile-safe-bottom))] z-50 mx-auto flex max-h-[calc(var(--app-viewport-height)-2rem-var(--mobile-safe-bottom))] w-[min(760px,calc(100vw-16px))] flex-col items-center gap-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/90 p-3 text-white shadow-2xl sm:w-[min(760px,calc(100vw-24px))] sm:gap-4 sm:p-4">`,
    `        <div className="itbird-call-panel fixed inset-x-0 z-50 mx-auto flex max-h-[calc(var(--app-viewport-height)-2rem-var(--mobile-safe-bottom))] w-[min(760px,calc(100vw-16px))] flex-col items-center gap-3 overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-black/90 p-3 text-white shadow-2xl sm:w-[min(760px,calc(100vw-24px))] sm:gap-4 sm:p-4">`
  );

  source = replaceRequired(
    source,
    'outgoing participants mobile scroll',
    `            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">`,
    `            <div className="itbird-call-participants flex min-w-0 flex-wrap items-center justify-end gap-2">`
  );

  source = replaceRequired(
    source,
    'outgoing remote media placement',
    `              <div ref={remoteMediaRef} className="flex min-w-0 flex-wrap justify-end gap-2" />
            </div>
          </div>

          {/* APP_FIX: self-video-and-screen-preview */}`,
    `            </div>
          </div>

          <div ref={remoteMediaRef} className="grid w-full min-w-0 grid-cols-1 place-items-center gap-2 sm:grid-cols-2" />

          {/* APP_FIX: self-video-and-screen-preview */}`
  );

  return source;
});

patch('src/components/RealtimeNotifications.tsx', (input) => {
  let source = input;

  source = replaceRequired(
    source,
    'remote video ref',
    `  const remoteAudioRef = useRef<HTMLDivElement | null>(null);`,
    `  const remoteAudioRef = useRef<HTMLDivElement | null>(null);
  const remoteVideoRef = useRef<HTMLDivElement | null>(null);`
  );

  source = replaceRequired(
    source,
    'cleanup remote video',
    `    remoteAudioRef.current?.replaceChildren();
    pendingOfferRef.current = null;`,
    `    remoteAudioRef.current?.replaceChildren();
    remoteVideoRef.current?.replaceChildren();
    pendingOfferRef.current = null;`
  );

  source = replaceRequired(
    source,
    'local call ended hard cleanup',
    `    const handleLocalCallEnded = () => { setActiveCall(null); setSpeakingUserIds([]); };`,
    `    const handleLocalCallEnded = () => {
      cleanupCall();
      setSpeakingUserIds([]);
    };`
  );

  source = replaceRequired(
    source,
    'incoming remote video root',
    `        if (remoteStream.getVideoTracks().length > 0) {
          const streamId = remoteStream.id || \`remote-video-\${event.track.id}\`;
          let video = remoteAudioRef.current.querySelector<HTMLVideoElement>(\`video[data-call-stream-id="\${streamId}"]\`);
          if (!video) {
            video = document.createElement('video');
            video.dataset.callMedia = 'remote';
            video.dataset.callStreamId = streamId;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            video.className = 'mt-3 h-28 w-44 rounded-lg bg-black object-cover';
            remoteAudioRef.current.appendChild(video);
          }
          video.srcObject = new MediaStream(remoteStream.getVideoTracks());
          void video.play().catch(() => undefined);
        }`,
    `        if (remoteStream.getVideoTracks().length > 0) {
          const videoRoot = remoteVideoRef.current;
          if (videoRoot) {
            const streamId = remoteStream.id || \`remote-video-\${event.track.id}\`;
            let video = videoRoot.querySelector<HTMLVideoElement>(\`video[data-call-stream-id="\${streamId}"]\`);
            if (!video) {
              video = document.createElement('video');
              video.dataset.callMedia = 'remote';
              video.dataset.callStreamId = streamId;
              video.autoplay = true;
              video.playsInline = true;
              video.muted = true;
              video.className = 'itbird-call-remote-video rounded-lg bg-black object-cover shadow-xl';
              videoRoot.appendChild(video);
            }
            video.srcObject = new MediaStream(remoteStream.getVideoTracks());
            void video.play().catch(() => undefined);
          }
        }`
  );

  source = replaceRequired(
    source,
    'incoming hidden audio root',
    `      <div
        ref={remoteAudioRef}
        className={activeCall && !panelHidden ? "fixed bottom-[calc(7rem+var(--mobile-safe-bottom))] right-3 z-50 flex max-w-[calc(100vw-24px)] flex-wrap justify-end gap-2 sm:right-6" : "hidden"}
      />`,
    `      <div ref={remoteAudioRef} className="hidden" aria-hidden="true" />`
  );

  source = replaceRequired(
    source,
    'incoming call panel class',
    `          className={\`\${panelPosition ? "fixed" : "fixed inset-x-2 bottom-[calc(1rem+var(--mobile-safe-bottom))] mx-auto"} z-50 flex max-h-[calc(var(--app-viewport-height)-2rem-var(--mobile-safe-bottom))] w-[min(760px,calc(100vw-16px))] flex-col gap-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/95 p-3 text-white shadow-2xl sm:inset-x-4 sm:w-[min(760px,calc(100vw-24px))] sm:gap-5 sm:p-4\`}`,
    `          className={\`\${panelPosition ? "fixed" : "fixed inset-x-2 mx-auto"} itbird-call-panel z-50 flex max-h-[calc(var(--app-viewport-height)-2rem-var(--mobile-safe-bottom))] w-[min(760px,calc(100vw-16px))] flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-black/95 p-3 text-white shadow-2xl sm:inset-x-4 sm:w-[min(760px,calc(100vw-24px))] sm:gap-5 sm:p-4\`}`
  );

  source = replaceRequired(
    source,
    'incoming participants mobile scroll',
    `            <div className="flex min-w-0 flex-wrap items-start justify-end gap-3">`,
    `            <div className="itbird-call-participants flex min-w-0 flex-wrap items-start justify-end gap-3">`
  );

  source = replaceRequired(
    source,
    'incoming remote video visible root',
    `          {soundNeedsTap && (`,
    `          <div ref={remoteVideoRef} className="grid w-full min-w-0 grid-cols-1 place-items-center gap-2 sm:grid-cols-2" />

          {soundNeedsTap && (`
  );

  source = replaceRequired(
    source,
    'restore button viewport bottom',
    `          className="fixed bottom-[calc(1rem+var(--mobile-safe-bottom))] right-4 z-50 rounded-full bg-black/90 text-white hover:bg-black"`,
    `          className="fixed bottom-[calc(0.75rem+var(--mobile-visible-bottom,var(--mobile-safe-bottom)))] right-4 z-50 rounded-full bg-black/90 text-white hover:bg-black"`
  );

  return source;
});

patch('backend/server.js', (input) => {
  let source = input;

  source = source.replace(
    `fileSize: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024),`,
    `fileSize: Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024),`
  );

  if (!source.includes('const uploadChatMedia =')) {
    source = replaceRequired(
      source,
      'chat upload error middleware',
      `const WebSocket = require('ws');`,
      `const uploadChatMedia = (req, res, next) => {
    upload.single('media')(req, res, (error) => {
        if (!error) return next();
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                message: 'Файл слишком большой. Максимальный размер — 100 МБ.',
                code: 'FILE_TOO_LARGE',
            });
        }
        console.error('Chat upload middleware error:', error);
        return res.status(400).json({
            message: 'Не удалось принять файл. Проверьте файл и повторите попытку.',
            code: error?.code || 'UPLOAD_ERROR',
        });
    });
};

const WebSocket = require('ws');`
    );
  }

  source = replaceRequired(
    source,
    'chat upload middleware use',
    `app.post('/messages/upload', verifyToken, upload.single('media'), async (req, res) => {`,
    `app.post('/messages/upload', verifyToken, uploadChatMedia, async (req, res) => {`
  );

  return source;
});

patch('deploy/nginx-socialbird.conf.template', (input) => {
  let source = input.replaceAll('client_max_body_size 25m;', 'client_max_body_size 100m;');

  if (!source.includes('socialbird_cors_origin')) {
    source = replaceRequired(
      source,
      'nginx cors error map',
      `limit_req_zone $binary_remote_addr zone=socialbird_api:10m rate=20r/s;`,
      `limit_req_zone $binary_remote_addr zone=socialbird_api:10m rate=20r/s;

map $http_origin $socialbird_cors_origin {
    default "";
    "https://\${SITE_DOMAIN}" $http_origin;
}`
    );
  }

  if (!source.includes('@socialbird_upload_too_large')) {
    source = replaceRequired(
      source,
      'nginx upload 413 json',
      `    add_header Referrer-Policy "no-referrer" always;

    location / {`,
      `    add_header Referrer-Policy "no-referrer" always;

    error_page 413 = @socialbird_upload_too_large;
    location @socialbird_upload_too_large {
        default_type application/json;
        add_header Access-Control-Allow-Origin $socialbird_cors_origin always;
        add_header Vary Origin always;
        return 413 '{"message":"Файл слишком большой. Максимальный размер — 100 МБ.","code":"FILE_TOO_LARGE"}';
    }

    location / {`
    );
  }

  if (!source.includes('proxy_request_buffering off;')) {
    source = replaceRequired(
      source,
      'nginx upload streaming',
      `        proxy_buffering off;`,
      `        proxy_buffering off;
        proxy_request_buffering off;`
    );
  }

  return source;
});

patch('deploy/install.sh', (input) => {
  let source = input.replace('MAX_UPLOAD_BYTES=26214400', 'MAX_UPLOAD_BYTES=104857600');
  if (!source.includes('apply-call-mobile-upload-fixes.mjs')) {
    source = replaceRequired(
      source,
      'installer new live fixes',
      `sudo -u "$APP_USER" node "\${APP_DIRECTORY}/deploy/apply-call-reliability-fixes.mjs"
sudo -u "$APP_USER" node "\${APP_DIRECTORY}/deploy/harden-source.mjs"`,
      `sudo -u "$APP_USER" node "\${APP_DIRECTORY}/deploy/apply-call-reliability-fixes.mjs"
sudo -u "$APP_USER" node "\${APP_DIRECTORY}/deploy/apply-call-mobile-upload-fixes.mjs"
sudo -u "$APP_USER" node "\${APP_DIRECTORY}/deploy/harden-source.mjs"`
    );
  }
  return source;
});

console.log('Call session, mobile layout, remote video and upload fixes are current.');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(deployDirectory, '..');

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const write = (relative, source) => fs.writeFileSync(path.join(root, relative), source, 'utf8');

const replaceRequired = (source, search, replacement, label) => {
  if (!source.includes(search)) {
    throw new Error(`SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1 patch failed: ${label}`);
  }
  return source.replace(search, replacement);
};

const patchPersonalChat = () => {
  const file = 'src/pages/Chats.tsx';
  let source = read(file);
  if (source.includes('SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: personal-chat')) return;

  source = replaceRequired(
    source,
    'import StickerBubble from "@/components/StickerBubble";\n',
    'import StickerBubble from "@/components/StickerBubble";\nimport ChatMessageText from "@/components/ChatMessageText";\nimport { shouldSendChatOnKeyDown } from "@/lib/chat-text.mjs";\n',
    'personal chat imports',
  );

  source = replaceRequired(
    source,
    `    const handleKeyDown = (e: React.KeyboardEvent) => {\n        if (e.key === 'Enter' && !e.shiftKey) {\n            e.preventDefault();\n            sendMessage();\n        }\n    };`,
    `    // SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: personal-chat\n    const handleKeyDown = (e: React.KeyboardEvent) => {\n        const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;\n        if (shouldSendChatOnKeyDown({ key: e.key, shiftKey: e.shiftKey, coarsePointer })) {\n            e.preventDefault();\n            sendMessage();\n        }\n    };`,
    'personal chat multiline Enter behavior',
  );

  source = replaceRequired(
    source,
    '<div>{translatedMessages[msg.id] || msg.message}</div>',
    '<div><ChatMessageText text={translatedMessages[msg.id] || msg.message} /></div>',
    'personal chat primary message renderer',
  );
  source = replaceRequired(
    source,
    '<div className="text-xs opacity-70">{msg.message}</div>',
    '<div className="text-xs opacity-70"><ChatMessageText text={msg.message} /></div>',
    'personal chat original message renderer',
  );

  write(file, source);
};

const patchGroupChat = () => {
  const file = 'src/pages/GroupChats.tsx';
  let source = read(file);
  if (source.includes('SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: group-chat')) return;

  source = replaceRequired(
    source,
    'import StickerBubble from "@/components/StickerBubble";\n',
    'import StickerBubble from "@/components/StickerBubble";\nimport ChatMessageText from "@/components/ChatMessageText";\nimport { shouldSendChatOnKeyDown } from "@/lib/chat-text.mjs";\n',
    'group chat imports',
  );

  source = replaceRequired(
    source,
    `    const handleKeyDown = (e: React.KeyboardEvent) => {\n        if (e.key === 'Enter' && !e.shiftKey) {\n            e.preventDefault();\n            sendMessage();\n        }\n    };`,
    `    // SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: group-chat\n    const handleKeyDown = (e: React.KeyboardEvent) => {\n        const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;\n        if (shouldSendChatOnKeyDown({ key: e.key, shiftKey: e.shiftKey, coarsePointer })) {\n            e.preventDefault();\n            sendMessage();\n        }\n    };`,
    'group chat multiline Enter behavior',
  );

  source = replaceRequired(
    source,
    '<div>{translatedMessages[msg.id] || msg.message}</div>',
    '<div><ChatMessageText text={translatedMessages[msg.id] || msg.message} /></div>',
    'group chat primary message renderer',
  );
  source = replaceRequired(
    source,
    '<div className="text-xs opacity-70">{msg.message}</div>',
    '<div className="text-xs opacity-70"><ChatMessageText text={msg.message} /></div>',
    'group chat original message renderer',
  );

  write(file, source);
};

const patchSettings = () => {
  const file = 'src/pages/Settings.tsx';
  let source = read(file);
  if (source.includes('SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: settings')) return;

  source = replaceRequired(
    source,
    'import { Progress } from "@/components/ui/progress";\n',
    'import { Progress } from "@/components/ui/progress";\nimport EmailNotificationPreference from "@/components/EmailNotificationPreference";\n',
    'settings email preference import',
  );

  source = replaceRequired(
    source,
    `        <Card>\n          <CardHeader>\n            <CardTitle>{t("callDevices")}</CardTitle>`,
    `        {/* SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: settings */}\n        <EmailNotificationPreference />\n\n        <Card>\n          <CardHeader>\n            <CardTitle>{t("callDevices")}</CardTitle>`,
    'settings email preference card',
  );

  write(file, source);
};

const patchSidebar = () => {
  const file = 'src/components/AppSidebar.tsx';
  let source = read(file);
  if (source.includes('SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: support-nav')) return;

  source = replaceRequired(source, '  Folder,\n  Home,', '  Folder,\n  Heart,\n  Home,', 'support icon import');
  source = replaceRequired(
    source,
    `    { title: androidTitle, url: "/android-app", icon: Smartphone },\n  ];`,
    `    { title: androidTitle, url: "/android-app", icon: Smartphone },\n    // SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: support-nav\n    { title: language === "ru" ? "Поддержать проект" : "Support the project", url: "/support", icon: Heart },\n  ];`,
    'support navigation item',
  );

  write(file, source);
};

const patchApp = () => {
  const file = 'src/App.tsx';
  let source = read(file);
  if (source.includes('SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: support-route')) return;

  source = replaceRequired(
    source,
    "import AndroidApp from './pages/AndroidApp';\n",
    "import AndroidApp from './pages/AndroidApp';\nimport SupportProject from './pages/SupportProject';\n",
    'support page import',
  );
  source = replaceRequired(
    source,
    `                <Route path="/android-app" element={<AndroidApp />} />`,
    `                <Route path="/android-app" element={<AndroidApp />} />\n                {/* SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: support-route */}\n                <Route path="/support" element={<SupportProject />} />`,
    'support route',
  );

  write(file, source);
};

const patchBackend = () => {
  const file = 'backend/server.js';
  let source = read(file);
  if (source.includes('SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: notification-preference-api')) return;

  source = replaceRequired(
    source,
    "const { registerStickers } = require('./stickers');\n",
    "const { registerStickers } = require('./stickers');\nconst { normalizeEmailNotificationsEnabled } = require('./notification-preferences');\n",
    'notification preference helper import',
  );

  source = replaceRequired(
    source,
    "    await addColumnIfMissing('users', 'user_tag', 'VARCHAR(32) NULL');\n",
    "    await addColumnIfMissing('users', 'user_tag', 'VARCHAR(32) NULL');\n    await addColumnIfMissing('users', 'email_notifications_enabled', 'BOOLEAN NOT NULL DEFAULT TRUE');\n",
    'email preference schema column',
  );

  source = replaceRequired(
    source,
    "        const [users] = await db.query('SELECT email, username FROM users WHERE id = ?', [userId]);\n        if (users.length === 0 || !users[0].email) return;\n        if (!transporter) return;",
    "        const [users] = await db.query('SELECT email, username, email_notifications_enabled FROM users WHERE id = ?', [userId]);\n        if (users.length === 0 || !users[0].email) return;\n        if (!normalizeEmailNotificationsEnabled(users[0].email_notifications_enabled, true)) return;\n        if (!transporter) return;",
    'email delivery preference gate',
  );

  const verifyAdminBlock = `const verifyAdmin = (req, res, next) => {\n    console.log('User role:', req.user.role); // Логируем роль пользователя\n    if (!req.user || req.user.role !== 'admin') {\n        return res.status(403).json({ message: 'Доступ запрещен. Вы не администратор.' });\n    }\n    next();\n};`;

  const preferenceRoutes = `${verifyAdminBlock}\n\n// SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: notification-preference-api\napp.get('/notification-preferences', verifyToken, async (req, res) => {\n    try {\n        const [users] = await db.query(\n            'SELECT email_notifications_enabled FROM users WHERE id = ? LIMIT 1',\n            [req.user.id]\n        );\n        if (users.length === 0) return res.status(404).json({ message: 'Пользователь не найден' });\n        res.json({\n            emailNotificationsEnabled: normalizeEmailNotificationsEnabled(\n                users[0].email_notifications_enabled,\n                true\n            ),\n        });\n    } catch (error) {\n        console.error('Notification preferences read error:', error);\n        res.status(500).json({ message: 'Не удалось загрузить настройки уведомлений' });\n    }\n});\n\napp.patch('/notification-preferences', verifyToken, async (req, res) => {\n    const value = req.body?.emailNotificationsEnabled;\n    if (typeof value !== 'boolean') {\n        return res.status(400).json({ message: 'emailNotificationsEnabled должен быть boolean' });\n    }\n\n    try {\n        const [result] = await db.query(\n            'UPDATE users SET email_notifications_enabled = ? WHERE id = ?',\n            [value ? 1 : 0, req.user.id]\n        );\n        if (result.affectedRows === 0) return res.status(404).json({ message: 'Пользователь не найден' });\n        res.json({ emailNotificationsEnabled: value });\n    } catch (error) {\n        console.error('Notification preferences update error:', error);\n        res.status(500).json({ message: 'Не удалось сохранить настройки уведомлений' });\n    }\n});`;

  source = replaceRequired(source, verifyAdminBlock, preferenceRoutes, 'notification preference API routes');
  write(file, source);
};

patchPersonalChat();
patchGroupChat();
patchSettings();
patchSidebar();
patchApp();
patchBackend();

const requiredMarkers = [
  ['src/pages/Chats.tsx', 'SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: personal-chat'],
  ['src/pages/GroupChats.tsx', 'SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: group-chat'],
  ['src/pages/Settings.tsx', 'SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: settings'],
  ['src/components/AppSidebar.tsx', 'SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: support-nav'],
  ['src/App.tsx', 'SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: support-route'],
  ['backend/server.js', 'SOCIALBIRD_SUPPORT_CHAT_EMAIL_V1: notification-preference-api'],
];

for (const [file, marker] of requiredMarkers) {
  if (!read(file).includes(marker)) throw new Error(`Missing ${marker} in ${file}`);
}

console.log('SocialBIRD support page, multiline/linkified chat and email notification preferences are current.');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'backend/server.js');
let source = fs.readFileSync(file, 'utf8');

const oldRoute = "app.post('/group-chats/:chatId/upload', verifyToken, upload.single('media'), async (req, res) => {";
const safeRoute = "app.post('/group-chats/:chatId/upload', verifyToken, uploadChatMedia, async (req, res) => {";

// CHAT_MEDIA_BACKEND_FIX: guarantee the guarded chat middleware exists even on
// older live VPS source trees. Some old deployments had the route-specific name
// only after another patch, so changing the group route to uploadChatMedia could
// otherwise make server.production.js crash at startup with ReferenceError.
if (!source.includes('const uploadChatMedia = (req, res, next) => {')) {
  const routeIndex = source.indexOf(oldRoute) >= 0 ? source.indexOf(oldRoute) : source.indexOf(safeRoute);
  if (routeIndex < 0) {
    throw new Error('Chat media backend fix failed: group upload route not found');
  }

  const uploadDeclarationIndex = source.lastIndexOf('const upload = multer(', routeIndex);
  if (uploadDeclarationIndex < 0) {
    throw new Error('Chat media backend fix failed: multer upload instance not found before chat route');
  }

  const middleware = `// CHAT_MEDIA_BACKEND_FIX: guarded chat upload middleware\nconst uploadChatMedia = (req, res, next) => {\n    upload.single('media')(req, res, (error) => {\n        if (!error) return next();\n        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {\n            return res.status(413).json({\n                message: 'Файл слишком большой. Максимальный размер — 100 МБ.',\n                code: 'FILE_TOO_LARGE',\n            });\n        }\n        console.error('Chat upload middleware error:', error);\n        return res.status(400).json({\n            message: 'Не удалось принять файл. Проверьте файл и повторите попытку.',\n            code: error?.code || 'UPLOAD_ERROR',\n        });\n    });\n};\n\n`;

  source = `${source.slice(0, routeIndex)}${middleware}${source.slice(routeIndex)}`;
}

if (source.includes(oldRoute)) source = source.replace(oldRoute, safeRoute);

const recipientBlock = `        const [members] = await db.query(\n            \`SELECT user_id FROM group_chat_members WHERE group_chat_id = ? AND user_id != ?\`,\n            [chatId, userId]\n        );\n        const recipientIds = members.map((member) => member.user_id);\n\n        const newMessage = {`;
const fixedRecipientBlock = `        const [members] = await db.query(\n            \`SELECT user_id FROM group_chat_members WHERE group_chat_id = ? AND user_id != ?\`,\n            [chatId, userId]\n        );\n        const recipientIds = members.map((member) => member.user_id);\n        // CHAT_MEDIA_BACKEND_FIX: media uploads can contain mentions too.\n        const mentionRecipientIds = await resolveGroupMentionRecipients(chatId, messageText, userId);\n\n        const newMessage = {`;

if (!source.includes('CHAT_MEDIA_BACKEND_FIX: media uploads can contain mentions too.')) {
  if (!source.includes(recipientBlock)) {
    throw new Error('Chat media backend fix failed: group recipient marker not found');
  }
  source = source.replace(recipientBlock, fixedRecipientBlock);
}

if (!source.includes(safeRoute)) {
  throw new Error('Chat media backend fix failed: safe group upload middleware not installed');
}
if (!source.includes('const uploadChatMedia = (req, res, next) => {')) {
  throw new Error('Chat media backend fix failed: uploadChatMedia declaration missing');
}

fs.writeFileSync(file, source, 'utf8');
console.log('Chat media backend upload fix is current.');

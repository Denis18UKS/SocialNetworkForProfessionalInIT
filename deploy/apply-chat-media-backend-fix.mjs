import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'backend/server.js');
let source = fs.readFileSync(file, 'utf8');

const oldRoute = "app.post('/group-chats/:chatId/upload', verifyToken, upload.single('media'), async (req, res) => {";
const safeRoute = "app.post('/group-chats/:chatId/upload', verifyToken, uploadChatMedia, async (req, res) => {";
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

fs.writeFileSync(file, source, 'utf8');
console.log('Chat media backend upload fix is current.');

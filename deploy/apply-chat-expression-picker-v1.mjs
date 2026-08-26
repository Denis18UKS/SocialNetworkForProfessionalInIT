import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');

const componentPath = 'src/components/ChatExpressionPicker.tsx';
if (!fs.existsSync(componentPath)) throw new Error('Chat expression picker component is missing');

const patchMessageInterface = (source, interfaceName) => {
  if (source.includes('sticker_id?: number | null;')) return source;
  const pattern = new RegExp(`interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`);
  const match = source.match(pattern);
  if (!match) throw new Error(`Expression picker patch failed: ${interfaceName} interface`);
  return source.replace(pattern, (full, body) => `interface ${interfaceName} {${body}\n    sticker_id?: number | null;\n}`);
};

const patchPage = (file, scope) => {
  let source = read(file);
  const isPersonal = scope === 'personal';
  const interfaceName = isPersonal ? 'Message' : 'GroupMessage';

  // SOCIALBIRD_CHAT_EXPRESSION_V1: imports
  if (!source.includes('ChatExpressionPicker from "@/components/ChatExpressionPicker"')) {
    const anchor = 'import VoiceMessageBubble from "@/components/VoiceMessageBubble";';
    if (!source.includes(anchor)) throw new Error(`Expression picker patch failed: ${scope} import anchor`);
    source = source.replace(anchor, `${anchor}\nimport ChatExpressionPicker from "@/components/ChatExpressionPicker";\nimport StickerBubble from "@/components/StickerBubble";\nimport { sendSticker } from "@/lib/stickers";`);
  }
  source = source.replace("import { Smile, Mic } from 'lucide-react';", "import { Mic } from 'lucide-react';");
  source = source.replace(/\nimport EmojiPicker, \{ EmojiClickData \} from 'emoji-picker-react';\n/g, '\n');
  source = source.replace(/\nimport EmojiPicker, \{ type EmojiClickData \} from 'emoji-picker-react';\n/g, '\n');

  source = patchMessageInterface(source, interfaceName);

  // Portal owns its own state. Old local popup state is what allowed overflow-clipped invisible panels.
  source = source.replace(/\n\s*const \[showEmojiPicker, setShowEmojiPicker\] = useState\(false\);/g, '');
  source = source.replace(
    /    const handleEmojiClick = \(emojiData: EmojiClickData\) => \{\n        setNewMessage\(prev => prev \+ emojiData\.emoji\);\n        setShowEmojiPicker\(false\);\n    \};/,
    `    // SOCIALBIRD_CHAT_EXPRESSION_V1: portal-expression-handler\n    const handleEmojiClick = (emoji: string) => {\n        setNewMessage(prev => prev + emoji);\n    };`,
  );

  if (!source.includes('SOCIALBIRD_CHAT_EXPRESSION_V1: sticker-send')) {
    const voiceBlock = `    sendVoiceMessageRef.current = (file: File) => {\n        void sendMediaMessage(file, voiceTranscriptRef.current);\n    };`;
    if (!source.includes(voiceBlock)) throw new Error(`Expression picker patch failed: ${scope} voice sender anchor`);
    const targetId = isPersonal ? 'Number(chatId)' : 'Number(selectedChat?.id || chatId)';
    const guards = isPersonal
      ? `        if (isBlockedBySelectedUser || isSelectedUserBlocked) {\n            toast.error(isBlockedBySelectedUser ? 'Данный пользователь ограничил круг лиц' : 'Сначала разблокируйте пользователя');\n            return;\n        }\n`
      : `        if (!selectedChat && !chatId) {\n            toast.error('Чат не выбран');\n            return;\n        }\n`;
    const block = `${voiceBlock}\n\n    // SOCIALBIRD_CHAT_EXPRESSION_V1: sticker-send\n    const handleSendSticker = async (stickerId: number) => {\n${guards}        const targetChatId = ${targetId};\n        if (!targetChatId) return;\n        try {\n            const sentMessage = await sendSticker('${scope}', targetChatId, stickerId);\n            setMessages((current) => [...current, sentMessage]);\n            window.setTimeout(scrollToBottom, 100);\n        } catch (error) {\n            toast.error(error instanceof Error ? error.message : 'Не удалось отправить стикер');\n        }\n    };`;
    source = source.replace(voiceBlock, block);
  }

  // Replace the old inline emoji trigger with one combined emoji+sticker trigger.
  if (!source.includes('SOCIALBIRD_CHAT_EXPRESSION_V1: portal-trigger')) {
    const buttonPattern = /\s*\{\/\* Кнопка эмодзи \*\/\}\s*<button\s+onClick=\{\(\) => setShowEmojiPicker\(!showEmojiPicker\)\}[\s\S]*?<\/button>/;
    if (!buttonPattern.test(source)) throw new Error(`Expression picker patch failed: ${scope} emoji button`);
    source = source.replace(buttonPattern, `\n                                            {/* SOCIALBIRD_CHAT_EXPRESSION_V1: portal-trigger */}\n                                            <ChatExpressionPicker\n                                                onEmojiSelect={handleEmojiClick}\n                                                onStickerSelect={handleSendSticker}\n                                            />`);
  }

  // Remove the old popup entirely. It was absolute inside overflow-hidden chat/composer containers.
  source = source.replace(
    /\n\s*\{\/\* Эмодзи-пикер \*\/\}\s*\{showEmojiPicker && \([\s\S]*?\n\s*\)\}/g,
    '',
  );

  if (!source.includes('<StickerBubble stickerId={Number(msg.sticker_id)} />')) {
    const messageAnchor = '{msg.message && (!isVoiceMessage(msg) || revealedVoiceTextIds[msg.id]) && (';
    if (!source.includes(messageAnchor)) throw new Error(`Expression picker patch failed: ${scope} message render anchor`);
    source = source.replace(
      messageAnchor,
      `{msg.sticker_id ? <StickerBubble stickerId={Number(msg.sticker_id)} /> : null}\n                                                ${messageAnchor}`,
    );
  }

  for (const required of [
    'ChatExpressionPicker',
    'SOCIALBIRD_CHAT_EXPRESSION_V1: portal-trigger',
    'SOCIALBIRD_CHAT_EXPRESSION_V1: sticker-send',
    'sticker_id?: number | null;',
    '<StickerBubble stickerId={Number(msg.sticker_id)} />',
  ]) {
    if (!source.includes(required)) throw new Error(`Expression picker invariant missing in ${file}: ${required}`);
  }
  if (source.includes('showEmojiPicker')) throw new Error(`Legacy clipped emoji state remains in ${file}`);
  write(file, source);
};

patchPage('src/pages/Chats.tsx', 'personal');
patchPage('src/pages/GroupChats.tsx', 'group');

// Ensure sticker API routes are part of canonical backend, not only old one-off deploy history.
{
  const file = 'backend/server.js';
  let source = read(file);
  if (!source.includes("const { registerStickers } = require('./stickers');")) {
    const importAnchor = "const { registerPasswordRecoveryRoutes } = require('./password-recovery');";
    if (!source.includes(importAnchor)) throw new Error('Expression picker patch failed: backend import anchor');
    source = source.replace(importAnchor, `${importAnchor}\nconst { registerStickers } = require('./stickers');`);
  }
  if (!source.includes('// SOCIALBIRD_CHAT_EXPRESSION_V1: sticker-routes')) {
    const startAnchor = `// Старт сервера\n// PRODUCTION_HARDENING: configurable-listen-address`;
    if (!source.includes(startAnchor)) throw new Error('Expression picker patch failed: backend start anchor');
    const registration = `// SOCIALBIRD_CHAT_EXPRESSION_V1: sticker-routes\nregisterStickers({\n    app,\n    db,\n    verifyToken,\n    notifyClients,\n    getChatParticipants,\n    hasUserBlockBetween,\n    resolveGroupMentionRecipients,\n});\n\n${startAnchor}`;
    source = source.replace(startAnchor, registration);
  }
  if (!source.includes('SOCIALBIRD_CHAT_EXPRESSION_V1: sticker-routes')) throw new Error('Sticker routes were not wired');
  write(file, source);
}

console.log('Chat expression picker V1 applied: body portal popup, emoji/sticker tabs, sticker rendering and canonical sticker routes.');

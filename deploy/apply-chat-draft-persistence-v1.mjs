import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const patch = (relative, scope) => {
  const filePath = path.join(root, relative);
  let source = fs.readFileSync(filePath, 'utf8');
  const marker = `// SOCIALBIRD_CHAT_PLATFORM_V1: ${scope}-draft-persist`;
  if (source.includes(marker)) return;

  const loadMarker = `    // SOCIALBIRD_CHAT_PLATFORM_V1: ${scope}-draft-load\n    useEffect(() => {\n        if (!chatId) return;\n        setNewMessage(readChatDraftText('${scope}', chatId));\n        setMediaFiles(readChatDraftFiles('${scope}', chatId));\n    }, [chatId]);`;
  if (!source.includes(loadMarker)) {
    throw new Error(`Draft persistence patch failed: ${relative} load marker not found`);
  }

  const replacement = `${loadMarker}\n\n    ${marker}\n    useEffect(() => {\n        if (!chatId) return;\n        writeChatDraftText('${scope}', chatId, newMessage);\n    }, [chatId, newMessage]);`;
  source = source.replace(loadMarker, replacement);
  fs.writeFileSync(filePath, source, 'utf8');
};

patch('src/pages/Chats.tsx', 'personal');
patch('src/pages/GroupChats.tsx', 'group');
console.log('Per-chat draft persistence enabled for personal and group chats.');

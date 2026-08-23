import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const patch = (relativePath, transform) => {
  const filePath = path.join(root, relativePath);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    console.log(`Applied chat media/mobile fix: ${relativePath}`);
  } else {
    console.log(`Chat media/mobile fix already current: ${relativePath}`);
  }
};

// 48 Unicode code points is intentionally conservative: even a 4-byte UTF-8 name,
// plus an extension and the backend timestamp prefix, stays below common 255-byte
// filesystem filename limits. The selected File itself is not mutated in UI; only
// the multipart transport filename is shortened when necessary.
const uploadHelpers = `const MAX_CHAT_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_TRANSPORT_FILENAME_CHARS = 48;

const makeTransportFile = (file: File) => {
    const originalName = String(file.name || 'file');
    if (Array.from(originalName).length <= MAX_TRANSPORT_FILENAME_CHARS) return file;

    const lastDot = originalName.lastIndexOf('.');
    const extension = lastDot > 0 && lastDot < originalName.length - 1
        ? originalName.slice(lastDot).replace(/[^.a-zA-Z0-9_-]/g, '').slice(0, 20)
        : '';
    const base = lastDot > 0 ? originalName.slice(0, lastDot) : originalName;
    const reserved = extension ? Array.from(extension).length : 0;
    const safeBaseLength = Math.max(16, MAX_TRANSPORT_FILENAME_CHARS - reserved);
    const shortBase = Array.from(base).slice(0, safeBaseLength).join('').trim() || 'file';
    const transportName = `${shortBase}${extension}`;

    return new File([file], transportName, {
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified,
    });
};`;

patch('src/pages/Chats.tsx', (input) => {
  let source = input.replace('const MAX_TRANSPORT_FILENAME_CHARS = 120;', 'const MAX_TRANSPORT_FILENAME_CHARS = 48;');

  if (!source.includes('MAX_TRANSPORT_FILENAME_CHARS')) {
    source = source.replace('const MAX_CHAT_UPLOAD_BYTES = 100 * 1024 * 1024;', uploadHelpers);
  }

  source = source.replace(
    "        formData.append('media', file);",
    "        const transportFile = makeTransportFile(file);\n        formData.append('media', transportFile, transportFile.name);",
  );

  source = source.replace(
    'className="mt-2 flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-md"',
    'className="mt-2 flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md bg-gray-100 p-2 dark:bg-gray-700"',
  );
  source = source.replaceAll(
    'className="text-sm truncate flex-1"',
    'className="min-w-0 flex-1 truncate text-sm"',
  );
  source = source.replaceAll(
    'className="text-gray-500 hover:text-red-500"',
    'className="shrink-0 text-gray-500 hover:text-red-500"',
  );
  source = source.replace(
    'className="mobile-bottom-safe shrink-0 border-t border-gray-200 bg-white px-2 pb-2 pt-2 dark:border-gray-700 dark:bg-gray-800 sm:p-4"',
    'className="mobile-bottom-safe w-full min-w-0 max-w-full shrink-0 overflow-hidden border-t border-gray-200 bg-white px-2 pb-2 pt-2 dark:border-gray-700 dark:bg-gray-800 sm:p-4"',
  );
  source = source.replace(
    'className="mx-auto w-full min-w-0 max-w-3xl"',
    'className="mx-auto w-full min-w-0 max-w-3xl overflow-hidden"',
  );
  source = source.replace(
    'className="flex items-end gap-2"',
    'className="flex w-full min-w-0 max-w-full items-end gap-2 overflow-hidden"',
  );
  source = source.replace(
    'className="cursor-pointer p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"',
    'className="shrink-0 cursor-pointer rounded-full p-2 hover:bg-gray-100 dark:hover:bg-gray-700"',
  );
  source = source.replace(
    'className="bg-[#6E59A5] hover:bg-[#5a4a8a] h-10 w-10 p-0 rounded-full"',
    'className="h-10 w-10 shrink-0 rounded-full bg-[#6E59A5] p-0 hover:bg-[#5a4a8a]"',
  );
  source = source.replace(
    '<div className="mt-2">\n                                                                <video controls className="max-w-full rounded">',
    '<div className="mt-2 min-w-0 max-w-full overflow-hidden">\n                                                                <video controls preload="metadata" playsInline className="block aspect-video max-h-[60vh] w-full min-w-0 max-w-full rounded bg-black object-contain">',
  );

  return source;
});

patch('src/pages/GroupChats.tsx', (input) => {
  let source = input.replace('const MAX_TRANSPORT_FILENAME_CHARS = 120;', 'const MAX_TRANSPORT_FILENAME_CHARS = 48;');

  if (!source.includes('MAX_CHAT_UPLOAD_BYTES')) {
    source = source.replace('const GroupChats = () => {', `${uploadHelpers}\n\nconst GroupChats = () => {`);
  } else if (!source.includes('MAX_TRANSPORT_FILENAME_CHARS')) {
    source = source.replace('const MAX_CHAT_UPLOAD_BYTES = 100 * 1024 * 1024;', uploadHelpers);
  }

  const oldFileChange = `    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {\n        if (e.target.files && e.target.files.length > 0) {\n            setMediaFile(e.target.files[0]);\n        }\n    };`;
  const newFileChange = `    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {\n        if (e.target.files && e.target.files.length > 0) {\n            const file = e.target.files[0];\n            if (file.size > MAX_CHAT_UPLOAD_BYTES) {\n                toast.error("Файл слишком большой. Максимальный размер — 100 МБ.");\n                e.target.value = "";\n                setMediaFile(null);\n                return;\n            }\n            setMediaFile(file);\n        }\n    };`;
  if (source.includes(oldFileChange)) source = source.replace(oldFileChange, newFileChange);

  source = source.replace(
    `    const sendMediaMessage = async (file: File, messageText = newMessage.trim()) => {\n        const token = localStorage.getItem("token");`,
    `    const sendMediaMessage = async (file: File, messageText = newMessage.trim()) => {\n        if (file.size > MAX_CHAT_UPLOAD_BYTES) {\n            toast.error("Файл слишком большой. Максимальный размер — 100 МБ.");\n            return;\n        }\n        const token = localStorage.getItem("token");`,
  );

  source = source.replace(
    "            formData.append('media', file);",
    "            const transportFile = makeTransportFile(file);\n            formData.append('media', transportFile, transportFile.name);",
  );

  source = source.replace(
    "            if (!response.ok) throw new Error('Ошибка при отправке сообщения');",
    "            if (!response.ok) {\n                const errorData = await response.json().catch(() => null);\n                throw new Error(errorData?.message || 'Ошибка при отправке сообщения');\n            }",
  );
  source = source.replace(
    "            toast.error('Ошибка при отправке сообщения');",
    "            toast.error(error instanceof Error ? error.message : 'Ошибка при отправке сообщения');",
  );

  source = source.replace(
    'className="max-w-3xl mx-auto space-y-4"',
    'className="mx-auto w-full min-w-0 max-w-3xl space-y-4 overflow-x-hidden"',
  );
  source = source.replace(
    'className={`max-w-[88%] break-words rounded-lg p-3 sm:max-w-[80%] ${msg.user_id === currentUser?.id',
    'className={`min-w-0 max-w-[88%] overflow-hidden break-words rounded-lg p-3 sm:max-w-[80%] ${msg.user_id === currentUser?.id',
  );
  source = source.replace(
    'className="inline-flex items-center gap-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-1 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"',
    'className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md border border-gray-200 bg-white px-2.5 py-1 text-gray-800 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 sm:px-3"',
  );
  source = source.replace(
    '<span>{label}</span>',
    '<span className="min-w-0 flex-1 truncate">{label}</span>',
  );
  source = source.replaceAll(
    'className="text-xs text-gray-500 dark:text-gray-400 ml-2"',
    'className="ml-1 shrink-0 text-xs text-gray-500 dark:text-gray-400 sm:ml-2"',
  );
  source = source.replace(
    '<div className="mt-2">\n                                                                        <video controls className="max-w-full rounded">',
    '<div className="mt-2 min-w-0 max-w-full overflow-hidden">\n                                                                        <video controls preload="metadata" playsInline className="block aspect-video max-h-[60vh] w-full min-w-0 max-w-full rounded bg-black object-contain">',
  );
  source = source.replace(
    'className="mobile-bottom-safe shrink-0 border-t border-gray-200 bg-white px-2 pb-2 pt-2 dark:border-gray-700 dark:bg-gray-800 sm:p-4"',
    'className="mobile-bottom-safe w-full min-w-0 max-w-full shrink-0 overflow-hidden border-t border-gray-200 bg-white px-2 pb-2 pt-2 dark:border-gray-700 dark:bg-gray-800 sm:p-4"',
  );
  source = source.replace(
    'className="max-w-3xl mx-auto"',
    'className="mx-auto w-full min-w-0 max-w-3xl overflow-hidden"',
  );
  source = source.replace(
    'className="flex items-end gap-2"',
    'className="flex w-full min-w-0 max-w-full items-end gap-2 overflow-hidden"',
  );
  source = source.replace(
    'className="cursor-pointer p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"',
    'className="shrink-0 cursor-pointer rounded-full p-2 hover:bg-gray-100 dark:hover:bg-gray-700"',
  );
  source = source.replace(
    'className="bg-[#6E59A5] hover:bg-[#5a4a8a] h-10 w-10 p-0 rounded-full"',
    'className="h-10 w-10 shrink-0 rounded-full bg-[#6E59A5] p-0 hover:bg-[#5a4a8a]"',
  );
  source = source.replaceAll(
    'className="mt-2 flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-md"',
    'className="mt-2 flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md bg-gray-100 p-2 dark:bg-gray-700"',
  );
  source = source.replaceAll(
    'className="text-sm truncate flex-1"',
    'className="min-w-0 flex-1 truncate text-sm"',
  );
  source = source.replaceAll(
    'className="text-gray-500 hover:text-red-500"',
    'className="shrink-0 text-gray-500 hover:text-red-500"',
  );

  return source;
});

console.log('Chat media/mobile upload fix is current.');

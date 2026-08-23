import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_DECL = 'const MAX_TRANSPORT_FILENAME_CHARS = 48;';
const MAX_UPLOAD = 'const MAX_CHAT_UPLOAD_BYTES = 100 * 1024 * 1024;';

const helperFunction = `const makeTransportFile = (file: File) => {
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
    const transportName = \`${shortBase}\${extension}\`;

    return new File([file], transportName, {
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified,
    });
};`;

const patchFile = (relativePath, componentMarker) => {
    const filePath = path.join(root, relativePath);
    let source = fs.readFileSync(filePath, 'utf8');
    const before = source;

    // Normalize any older declaration first.
    source = source.replace(/const MAX_TRANSPORT_FILENAME_CHARS\s*=\s*\d+\s*;/g, MAX_DECL);

    const hasTransportFunction = source.includes('const makeTransportFile = (file: File) => {');
    const hasMaxDecl = source.includes(MAX_DECL);

    if (!hasMaxDecl && !hasTransportFunction) {
        if (source.includes(MAX_UPLOAD)) {
            source = source.replace(MAX_UPLOAD, `${MAX_UPLOAD}\n${MAX_DECL}\n\n${helperFunction}`);
        } else if (source.includes(componentMarker)) {
            source = source.replace(componentMarker, `${MAX_UPLOAD}\n${MAX_DECL}\n\n${helperFunction}\n\n${componentMarker}`);
        } else {
            throw new Error(`Chat media v3 failed: cannot place upload helpers in ${relativePath}`);
        }
    } else if (!hasMaxDecl && hasTransportFunction) {
        if (source.includes(MAX_UPLOAD)) source = source.replace(MAX_UPLOAD, `${MAX_UPLOAD}\n${MAX_DECL}`);
        else if (source.includes(componentMarker)) source = source.replace(componentMarker, `${MAX_DECL}\n\n${componentMarker}`);
        else throw new Error(`Chat media v3 failed: cannot place filename limit in ${relativePath}`);
    } else if (hasMaxDecl && !hasTransportFunction) {
        source = source.replace(MAX_DECL, `${MAX_DECL}\n\n${helperFunction}`);
    }

    // Avoid duplicate transport wrappers while upgrading older source.
    source = source.replace(
        /formData\.append\('media',\s*file\);/g,
        "const transportFile = makeTransportFile(file);\n        formData.append('media', transportFile, transportFile.name);",
    );

    // If indentation differs, normalize the inserted block enough for TS formatting.
    source = source.replace(
        /^\s*const transportFile = makeTransportFile\(file\);\n\s*formData\.append\('media', transportFile, transportFile\.name\);/gm,
        (block) => block,
    );

    // Bound all legacy chat video elements to the viewport.
    source = source.replaceAll(
        '<video controls className="max-w-full rounded">',
        '<video controls preload="metadata" playsInline className="block aspect-video max-h-[60vh] w-full min-w-0 max-w-full rounded bg-black object-contain">',
    );

    // File preview / composer must never widen the mobile viewport.
    source = source.replaceAll(
        'className="mt-2 flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-md"',
        'className="mt-2 flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md bg-gray-100 p-2 dark:bg-gray-700"',
    );
    source = source.replaceAll('className="text-sm truncate flex-1"', 'className="min-w-0 flex-1 truncate text-sm"');
    source = source.replaceAll('className="text-gray-500 hover:text-red-500"', 'className="shrink-0 text-gray-500 hover:text-red-500"');
    source = source.replaceAll(
        'className="mobile-bottom-safe shrink-0 border-t border-gray-200 bg-white px-2 pb-2 pt-2 dark:border-gray-700 dark:bg-gray-800 sm:p-4"',
        'className="mobile-bottom-safe w-full min-w-0 max-w-full shrink-0 overflow-hidden border-t border-gray-200 bg-white px-2 pb-2 pt-2 dark:border-gray-700 dark:bg-gray-800 sm:p-4"',
    );
    source = source.replaceAll('className="flex items-end gap-2"', 'className="flex w-full min-w-0 max-w-full items-end gap-2 overflow-hidden"');
    source = source.replaceAll(
        'className="cursor-pointer p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"',
        'className="shrink-0 cursor-pointer rounded-full p-2 hover:bg-gray-100 dark:hover:bg-gray-700"',
    );
    source = source.replaceAll(
        'className="bg-[#6E59A5] hover:bg-[#5a4a8a] h-10 w-10 p-0 rounded-full"',
        'className="h-10 w-10 shrink-0 rounded-full bg-[#6E59A5] p-0 hover:bg-[#5a4a8a]"',
    );

    if (relativePath.endsWith('/Chats.tsx')) {
        source = source.replaceAll('className="mx-auto w-full min-w-0 max-w-3xl"', 'className="mx-auto w-full min-w-0 max-w-3xl overflow-hidden"');
    } else {
        source = source.replaceAll('className="max-w-3xl mx-auto space-y-4"', 'className="mx-auto w-full min-w-0 max-w-3xl space-y-4 overflow-x-hidden"');
        source = source.replaceAll('className="max-w-3xl mx-auto"', 'className="mx-auto w-full min-w-0 max-w-3xl overflow-hidden"');
        source = source.replaceAll(
            'className="inline-flex items-center gap-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-1 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"',
            'className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md border border-gray-200 bg-white px-2.5 py-1 text-gray-800 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 sm:px-3"',
        );
        source = source.replaceAll('<span>{label}</span>', '<span className="min-w-0 flex-1 truncate">{label}</span>');
    }

    if (source !== before) {
        fs.writeFileSync(filePath, source, 'utf8');
        console.log(`Applied chat media/mobile fix v3: ${relativePath}`);
    } else {
        console.log(`Chat media/mobile fix v3 already current: ${relativePath}`);
    }

    const current = fs.readFileSync(filePath, 'utf8');
    for (const marker of [MAX_DECL, "formData.append('media', transportFile, transportFile.name)", 'playsInline']) {
        if (!current.includes(marker)) throw new Error(`Chat media v3 verification failed: ${relativePath} missing ${marker}`);
    }
};

patchFile('src/pages/Chats.tsx', 'const Chats = () => {');
patchFile('src/pages/GroupChats.tsx', 'const GroupChats = () => {');

console.log('Chat media/mobile upload fix v3 is current.');

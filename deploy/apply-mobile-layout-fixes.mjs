import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(deployDirectory, '..');

const patchFile = (relativePath, replacements) => {
  const filePath = path.join(root, relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  const initial = source;

  for (const [from, to] of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) {
      throw new Error(`Mobile layout fix failed for ${relativePath}: pattern not found: ${from}`);
    }
    source = source.replace(from, to);
  }

  if (source !== initial) {
    fs.writeFileSync(filePath, source, 'utf8');
    console.log(`Applied mobile layout fixes: ${relativePath}`);
  }
};

patchFile('src/pages/Chats.tsx', [
  [
    'className="h-full min-h-[calc(100dvh-5rem)] overflow-hidden bg-gray-50 dark:bg-gray-900"',
    'className="h-full min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900"',
  ],
  [
    'className="shrink-0 p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"',
    'className="mobile-bottom-safe shrink-0 border-t border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"',
  ],
  [
    'className="fixed right-8 bottom-24 bg-[#6E59A5] hover:bg-[#5a4a8a] text-white p-2 rounded-full shadow-lg"',
    'className="fixed right-8 bottom-[calc(6rem+var(--mobile-safe-bottom))] bg-[#6E59A5] hover:bg-[#5a4a8a] text-white p-2 rounded-full shadow-lg"',
  ],
]);

patchFile('src/pages/GroupChats.tsx', [
  [
    'className="h-full min-h-[calc(100dvh-5rem)] overflow-hidden bg-gray-50 dark:bg-gray-900"',
    'className="h-full min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900"',
  ],
  [
    'className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"',
    'className="mobile-bottom-safe shrink-0 border-t border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"',
  ],
  [
    'className="fixed right-8 bottom-24 bg-[#6E59A5] hover:bg-[#5a4a8a] text-white p-2 rounded-full shadow-lg"',
    'className="fixed right-8 bottom-[calc(6rem+var(--mobile-safe-bottom))] bg-[#6E59A5] hover:bg-[#5a4a8a] text-white p-2 rounded-full shadow-lg"',
  ],
]);

patchFile('src/components/VoiceCallControls.tsx', [
  [
    'root.className = "fixed bottom-28 right-6 z-[60] flex max-w-[calc(100vw-32px)] flex-wrap justify-end gap-2";',
    'root.className = "fixed bottom-[calc(7rem+var(--mobile-safe-bottom))] right-3 z-[60] flex max-w-[calc(100vw-24px)] flex-wrap justify-end gap-2 sm:right-6";',
  ],
  [
    'className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(760px,calc(100vw-24px))] flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/90 p-4 text-white shadow-2xl"',
    'className="fixed inset-x-0 bottom-[calc(1rem+var(--mobile-safe-bottom))] z-50 mx-auto flex max-h-[calc(var(--app-viewport-height)-2rem-var(--mobile-safe-bottom))] w-[min(760px,calc(100vw-24px))] flex-col items-center gap-4 overflow-y-auto rounded-2xl border border-white/10 bg-black/90 p-4 text-white shadow-2xl"',
  ],
]);

patchFile('src/components/RealtimeNotifications.tsx', [
  [
    'className={activeCall && !panelHidden ? "fixed bottom-28 right-6 z-50 flex max-w-[calc(100vw-32px)] flex-wrap justify-end gap-2" : "hidden"}',
    'className={activeCall && !panelHidden ? "fixed bottom-[calc(7rem+var(--mobile-safe-bottom))] right-3 z-50 flex max-w-[calc(100vw-24px)] flex-wrap justify-end gap-2 sm:right-6" : "hidden"}',
  ],
  [
    'className="fixed bottom-4 right-4 z-50 rounded-full bg-black/90 text-white hover:bg-black"',
    'className="fixed bottom-[calc(1rem+var(--mobile-safe-bottom))] right-4 z-50 rounded-full bg-black/90 text-white hover:bg-black"',
  ],
  [
    'className={`${panelPosition ? "fixed" : "fixed inset-x-4 bottom-4 mx-auto"} z-50 flex w-[min(760px,calc(100vw-24px))] flex-col gap-5 rounded-2xl border border-white/10 bg-black/95 p-4 text-white shadow-2xl`}',
    'className={`${panelPosition ? "fixed" : "fixed inset-x-4 bottom-[calc(1rem+var(--mobile-safe-bottom))] mx-auto"} z-50 flex max-h-[calc(var(--app-viewport-height)-2rem-var(--mobile-safe-bottom))] w-[min(760px,calc(100vw-24px))] flex-col gap-5 overflow-y-auto rounded-2xl border border-white/10 bg-black/95 p-4 text-white shadow-2xl`}',
  ],
]);

console.log('Mobile layout fixes are current.');

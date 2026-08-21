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
    '<Card className="h-full rounded-none border-0">',
    '<Card className="flex h-full min-h-0 flex-col rounded-none border-0">',
  ],
  [
    '<CardContent className="p-0">',
    '<CardContent className="min-h-0 flex-1 overflow-y-auto p-0">',
  ],
  [
    '<CardHeader className="py-3">',
    '<CardHeader className="shrink-0 px-3 py-2 sm:px-6 sm:py-3">',
  ],
  [
    'className="mt-3 flex min-w-0 flex-wrap items-center justify-end gap-2"',
    'className="mt-2 flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mt-3 sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0"',
  ],
  [
    'className="min-w-0 max-w-[260px] rounded-md border border-[#6E59A5]/30 bg-[#6E59A5]/10 px-3 py-2 text-left transition-colors hover:bg-[#6E59A5]/15 dark:bg-[#6E59A5]/20"',
    'className="w-[190px] shrink-0 rounded-md border border-[#6E59A5]/30 bg-[#6E59A5]/10 px-2 py-1.5 text-left transition-colors hover:bg-[#6E59A5]/15 dark:bg-[#6E59A5]/20 sm:w-auto sm:min-w-0 sm:max-w-[260px] sm:px-3 sm:py-2"',
  ],
  [
    'className="min-h-0 flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900/50"',
    'className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-2 overscroll-contain dark:bg-gray-900/50 sm:p-4"',
  ],
  [
    "className={`max-w-[80%] rounded-lg p-3 ${msg.user_id === currentUser?.id",
    "className={`max-w-[88%] break-words rounded-lg p-3 sm:max-w-[80%] ${msg.user_id === currentUser?.id",
  ],
  [
    'className="shrink-0 p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"',
    'className="mobile-bottom-safe shrink-0 border-t border-gray-200 bg-white px-2 pb-2 pt-2 dark:border-gray-700 dark:bg-gray-800 sm:p-4"',
  ],
  [
    'className="flex items-end gap-2"',
    'className="flex min-w-0 items-end gap-1.5 sm:gap-2"',
  ],
  [
    'className="flex-1 relative"',
    'className="relative min-w-0 flex-1"',
  ],
  [
    'className="min-h-[40px] max-h-[120px] resize-none pr-10"',
    'className="min-h-[40px] max-h-[120px] min-w-0 resize-none pr-10 text-[16px]"',
  ],
  [
    'className="fixed right-8 bottom-24 bg-[#6E59A5] hover:bg-[#5a4a8a] text-white p-2 rounded-full shadow-lg"',
    'className="fixed right-3 bottom-[calc(5.5rem+var(--mobile-safe-bottom))] bg-[#6E59A5] hover:bg-[#5a4a8a] text-white p-2 rounded-full shadow-lg sm:right-8 sm:bottom-[calc(6rem+var(--mobile-safe-bottom))]"',
  ],
]);

patchFile('src/pages/GroupChats.tsx', [
  [
    'className="h-full min-h-[calc(100dvh-5rem)] overflow-hidden bg-gray-50 dark:bg-gray-900"',
    'className="h-full min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900"',
  ],
  [
    '<Card className="h-full rounded-none border-0">',
    '<Card className="flex h-full min-h-0 flex-col rounded-none border-0">',
  ],
  [
    '<CardContent className="p-0">',
    '<CardContent className="min-h-0 flex-1 overflow-y-auto p-0">',
  ],
  [
    '<CardHeader className="py-3">',
    '<CardHeader className="shrink-0 px-3 py-2 sm:px-6 sm:py-3">',
  ],
  [
    'className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end"',
    'className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:pb-0 lg:justify-end"',
  ],
  [
    'className="min-w-0 max-w-[260px] rounded-md border border-[#6E59A5]/30 bg-[#6E59A5]/10 px-3 py-2 text-left transition-colors hover:bg-[#6E59A5]/15 dark:bg-[#6E59A5]/20"',
    'className="w-[190px] shrink-0 rounded-md border border-[#6E59A5]/30 bg-[#6E59A5]/10 px-2 py-1.5 text-left transition-colors hover:bg-[#6E59A5]/15 dark:bg-[#6E59A5]/20 sm:w-auto sm:min-w-0 sm:max-w-[260px] sm:px-3 sm:py-2"',
  ],
  [
    'className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900/50"',
    'className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-2 overscroll-contain dark:bg-gray-900/50 sm:p-4"',
  ],
  [
    "className={`max-w-[80%] rounded-lg p-3 ${msg.user_id === currentUser?.id",
    "className={`max-w-[88%] break-words rounded-lg p-3 sm:max-w-[80%] ${msg.user_id === currentUser?.id",
  ],
  [
    'className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"',
    'className="mobile-bottom-safe shrink-0 border-t border-gray-200 bg-white px-2 pb-2 pt-2 dark:border-gray-700 dark:bg-gray-800 sm:p-4"',
  ],
  [
    'className="flex items-end gap-2"',
    'className="flex min-w-0 items-end gap-1.5 sm:gap-2"',
  ],
  [
    'className="flex-1 relative"',
    'className="relative min-w-0 flex-1"',
  ],
  [
    'className="min-h-[40px] max-h-[120px] resize-none pr-10"',
    'className="min-h-[40px] max-h-[120px] min-w-0 resize-none pr-10 text-[16px]"',
  ],
  [
    'className="fixed right-8 bottom-24 bg-[#6E59A5] hover:bg-[#5a4a8a] text-white p-2 rounded-full shadow-lg"',
    'className="fixed right-3 bottom-[calc(5.5rem+var(--mobile-safe-bottom))] bg-[#6E59A5] hover:bg-[#5a4a8a] text-white p-2 rounded-full shadow-lg sm:right-8 sm:bottom-[calc(6rem+var(--mobile-safe-bottom))]"',
  ],
]);

patchFile('src/components/VoiceCallControls.tsx', [
  [
    'root.className = "fixed bottom-28 right-6 z-[60] flex max-w-[calc(100vw-32px)] flex-wrap justify-end gap-2";',
    'root.className = "fixed bottom-[calc(7rem+var(--mobile-safe-bottom))] right-3 z-[60] flex max-w-[calc(100vw-24px)] flex-wrap justify-end gap-2 sm:right-6";',
  ],
  [
    'className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(760px,calc(100vw-24px))] flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/90 p-4 text-white shadow-2xl"',
    'className="fixed inset-x-0 bottom-[calc(1rem+var(--mobile-safe-bottom))] z-50 mx-auto flex max-h-[calc(var(--app-viewport-height)-2rem-var(--mobile-safe-bottom))] w-[min(760px,calc(100vw-16px))] flex-col items-center gap-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/90 p-3 text-white shadow-2xl sm:w-[min(760px,calc(100vw-24px))] sm:gap-4 sm:p-4"',
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
    'className={`${panelPosition ? "fixed" : "fixed inset-x-2 bottom-[calc(1rem+var(--mobile-safe-bottom))] mx-auto"} z-50 flex max-h-[calc(var(--app-viewport-height)-2rem-var(--mobile-safe-bottom))] w-[min(760px,calc(100vw-16px))] flex-col gap-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/95 p-3 text-white shadow-2xl sm:inset-x-4 sm:w-[min(760px,calc(100vw-24px))] sm:gap-5 sm:p-4`}',
  ],
]);

patchFile('src/components/AppSidebar.tsx', [
  [
    '<SidebarContent className="min-w-0 overflow-y-auto">',
    '<SidebarContent className="mobile-bottom-safe min-w-0 overflow-y-auto">',
  ],
]);

console.log('Mobile layout fixes are current.');
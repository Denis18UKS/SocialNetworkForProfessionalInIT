import fs from 'node:fs';

const patcherPath = 'deploy/apply-chat-platform-v1.mjs';
let source = fs.readFileSync(patcherPath, 'utf8');

if (source.includes('SOCIALBIRD_CHAT_PLATFORM_V4_COMPAT')) {
  console.log('Chat Platform v4 compatibility patch is already applied locally.');
  process.exit(0);
}

const composerFollowAnchor = `  source = source.replace('className="flex min-w-0 items-end gap-1.5 sm:gap-2"'`;

const outerStart = source.indexOf("  const outerClass = '<div className=");
const composerStartBefore = source.indexOf('  const composerClass =', Math.max(0, outerStart));
if (outerStart < 0 || composerStartBefore < 0) {
  throw new Error('Could not find the known workspace/composer patch section. Refusing to modify an unknown patcher revision.');
}

const workspaceBlock = [
  "  // SOCIALBIRD_CHAT_PLATFORM_V4_COMPAT: locate the actual page root by its ToastContainer child",
  "  if (!source.includes('socialbird-chat-workspace')) {",
  "    const workspacePattern = /(return\\s*\\(\\s*<div className=\")([^\"]*)(\">\\s*<ToastContainer\\b)/;",
  "    const match = source.match(workspacePattern);",
  "    if (!match) throw new Error('Chat platform patch failed: ' + scope + ' workspace root anchor');",
  "    source = source.replace(workspacePattern, (fullMatch, prefix, classNames, suffix) => {",
  "      return prefix + 'socialbird-chat-workspace ' + classNames + suffix;",
  "    });",
  "  }",
].join('\n');

source = source.slice(0, outerStart) + workspaceBlock + '\n\n' + source.slice(composerStartBefore);

const composerStart = source.indexOf('  const composerClass =');
const composerEnd = source.indexOf(composerFollowAnchor, composerStart);
if (composerStart < 0 || composerEnd < 0) {
  throw new Error('Could not find the known composer patch block. Refusing to modify an unknown patcher revision.');
}

const composerBlock = [
  "  // SOCIALBIRD_CHAT_PLATFORM_V4_COMPAT: locate composer by the stable Russian section comment, never by an exact CSS class list",
  "  if (!source.includes('socialbird-chat-composer')) {",
  "    const composerPattern = /(\\{\\/\\*\\s*Поле ввода сообщения\\s*\\*\\/\\}\\s*)<div className=\"([^\"]*)\">/;",
  "    const match = source.match(composerPattern);",
  "    if (!match) throw new Error('Chat platform patch failed: ' + scope + ' composer root anchor');",
  "    const composerReplacement = match[1] + `<div",
  "                                className=\"socialbird-chat-composer ${match[2]}\"",
  "                                onDragEnter={(event) => { event.preventDefault(); setIsDraggingFiles(true); }}",
  "                                onDragOver={(event) => { event.preventDefault(); setIsDraggingFiles(true); }}",
  "                                onDragLeave={(event) => {",
  "                                    if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDraggingFiles(false);",
  "                                }}",
  "                                onDrop={handleFileDrop}",
  "                            >",
  "                                {isDraggingFiles && <div className=\"socialbird-chat-drop-overlay\">Перетащите файлы сюда</div>}`;",
  "    source = source.replace(composerPattern, composerReplacement);",
  "  }",
].join('\n');

source = source.slice(0, composerStart) + composerBlock + '\n\n' + source.slice(composerEnd);
fs.writeFileSync(patcherPath, source, 'utf8');
console.log('Chat Platform patcher v4 installed: workspace and composer use stable structural anchors.');

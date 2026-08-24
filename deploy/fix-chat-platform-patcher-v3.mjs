import fs from 'node:fs';

const patcherPath = 'deploy/apply-chat-platform-v1.mjs';
let source = fs.readFileSync(patcherPath, 'utf8');

const oldBlock = [
  "  const outerClass = '<div className=\"h-full min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900\">';",
  "  source = replaceRequired(source, `${scope} workspace class`, outerClass, '<div className=\"socialbird-chat-workspace h-full min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900\">');",
].join('\n');

const newBlock = [
  "  // SOCIALBIRD_CHAT_PLATFORM_V3_COMPAT: anchor the real chat root by ToastContainer instead of exact live classes",
  "  if (!source.includes('socialbird-chat-workspace')) {",
  "    const workspacePattern = /(return\\s*\\(\\s*<div className=\")([^\"]*)(\">\\s*<ToastContainer\\b)/;",
  "    const match = source.match(workspacePattern);",
  "    if (!match) throw new Error('Chat platform patch failed: ' + scope + ' workspace root anchor');",
  "    source = source.replace(workspacePattern, (fullMatch, prefix, classNames, suffix) => {",
  "      return prefix + 'socialbird-chat-workspace ' + classNames + suffix;",
  "    });",
  "  }",
].join('\n');

if (source.includes('SOCIALBIRD_CHAT_PLATFORM_V3_COMPAT')) {
  console.log('Chat Platform v3 compatibility patch is already applied locally.');
  process.exit(0);
}

if (source.includes(oldBlock)) {
  source = source.replace(oldBlock, newBlock);
} else {
  const v2Pattern = /  \/\/ SOCIALBIRD_CHAT_PLATFORM_V2_COMPAT: preserve existing live workspace classes\n  if \(!source\.includes\('socialbird-chat-workspace'\)\) \{[\s\S]*?\n  \}\n/;
  if (!v2Pattern.test(source)) {
    throw new Error('Could not find a known workspace patch block. Refusing to modify an unknown patcher revision.');
  }
  source = source.replace(v2Pattern, `${newBlock}\n`);
}

fs.writeFileSync(patcherPath, source, 'utf8');
console.log('Chat Platform patcher v3 installed: workspace root is detected by the ToastContainer anchor.');

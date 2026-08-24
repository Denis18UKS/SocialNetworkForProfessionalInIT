import fs from 'node:fs';

const patcherPath = 'deploy/apply-chat-platform-v1.mjs';
let source = fs.readFileSync(patcherPath, 'utf8');

const oldBlock = [
  "  const outerClass = '<div className=\"h-full min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900\">';",
  "  source = replaceRequired(source, `${scope} workspace class`, outerClass, '<div className=\"socialbird-chat-workspace h-full min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900\">');",
].join('\n');

const newBlock = [
  "  // SOCIALBIRD_CHAT_PLATFORM_V2_COMPAT: preserve existing live workspace classes",
  "  if (!source.includes('socialbird-chat-workspace')) {",
  "    const workspacePattern = /<div className=\"([^\"]*)\">/g;",
  "    let workspaceMatched = false;",
  "    source = source.replace(workspacePattern, (fullMatch, classNames) => {",
  "      if (workspaceMatched) return fullMatch;",
  "      const requiredClasses = ['h-full', 'min-h-0', 'overflow-hidden', 'bg-gray-50', 'dark:bg-gray-900'];",
  "      if (!requiredClasses.every((token) => classNames.includes(token))) return fullMatch;",
  "      workspaceMatched = true;",
  "      return '<div className=\"socialbird-chat-workspace ' + classNames + '\">';",
  "    });",
  "    if (!workspaceMatched) throw new Error('Chat platform patch failed: ' + scope + ' workspace class');",
  "  }",
].join('\n');

if (source.includes('SOCIALBIRD_CHAT_PLATFORM_V2_COMPAT: preserve existing live workspace classes')) {
  console.log('Chat Platform v2 compatibility patch is already applied locally.');
  process.exit(0);
}

if (!source.includes(oldBlock)) {
  throw new Error('Could not find the Chat Platform v1 workspace patch block. Refusing to modify an unknown patcher revision.');
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(patcherPath, source, 'utf8');
console.log('Chat Platform patcher updated for current live workspace class variants.');

import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');

const replaceOnce = (source, label, from, to) => {
  if (!source.includes(from)) throw new Error(`Final platform patch failed: ${label}`);
  return source.replace(from, to);
};

const patchServer = () => {
  const file = 'backend/server.js';
  let source = read(file);
  const earlyMarker = '// SOCIALBIRD_FINAL_PLATFORM_V1: early-middleware';
  const routesMarker = '// SOCIALBIRD_FINAL_PLATFORM_V1: final-routes';

  if (!source.includes(earlyMarker)) {
    const anchor = 'const app = express();';
    source = replaceOnce(source, 'backend early middleware anchor', anchor, `${anchor}\nconst { registerStrictPrivacyGate } = require('./strict-privacy-gate');\nconst { registerStableNewsTime } = require('./stable-news-time');\n\n${earlyMarker}\n// These middlewares must precede legacy /users and news routes. getDb is lazy, so db may be declared later.\nregisterStrictPrivacyGate({ app, getDb: () => db });\nregisterStableNewsTime({ app, getDb: () => db });`);
  }

  if (!source.includes(routesMarker)) {
    const anchor = '// Старт сервера';
    const block = `${routesMarker}\nconst { registerSocialBirdFinalPlatform } = require('./socialbird-final-platform');\nconst { registerCinemaQr } = require('./cinema-qr');\nconst { registerCinemaStream } = require('./cinema-stream');\n\nregisterSocialBirdFinalPlatform({ app, db, verifyToken, transporter, notifyClients });\nregisterCinemaQr({ app, db, verifyToken });\nregisterCinemaStream({ app, db });\n\n${anchor}`;
    source = replaceOnce(source, 'backend final route anchor', anchor, block);
  }

  for (const expected of [earlyMarker, routesMarker, 'registerStrictPrivacyGate({ app', 'registerSocialBirdFinalPlatform({ app', 'registerCinemaQr({ app', 'registerCinemaStream({ app']) {
    if (!source.includes(expected)) throw new Error(`Final backend verification failed: ${expected}`);
  }
  write(file, source);
};

const patchGroupChats = () => {
  const file = 'src/pages/GroupChats.tsx';
  let source = read(file);
  const marker = '// SOCIALBIRD_FINAL_PLATFORM_V1: creator-clear-all';
  if (source.includes(marker)) return;

  const functionAnchor = '    const handleDeleteGroupChat = async () => {';
  const creatorClear = `    ${marker}\n    const handleClearGroupChatForEveryone = async () => {\n        if (!selectedChat || selectedChat.creator_id !== currentUser?.id) return;\n        if (!window.confirm("Удалить всю историю сообщений этого группового чата у всех участников? Это действие нельзя отменить.")) return;\n        const token = localStorage.getItem("token");\n        if (!token) return;\n\n        try {\n            const response = await fetch(\`http://localhost:5000/group-chats/\${selectedChat.id}/messages/all-v2\`, {\n                method: 'DELETE',\n                headers: { 'Authorization': \`Bearer \${token}\` },\n            });\n            const data = await response.json().catch(() => ({}));\n            if (!response.ok) throw new Error(data?.message || "Не удалось очистить чат у всех");\n            setMessages([]);\n            toast.success("История группового чата очищена у всех участников");\n        } catch (error) {\n            toast.error(error instanceof Error ? error.message : "Не удалось очистить чат у всех");\n        }\n    };\n\n${functionAnchor}`;
  source = replaceOnce(source, 'group creator clear function', functionAnchor, creatorClear);

  const menuAnchor = '                                                    {selectedChat.creator_id === currentUser?.id ? (';
  const menuBlock = `                                                    {selectedChat.creator_id === currentUser?.id && (\n                                                        <DropdownMenuItem onClick={handleClearGroupChatForEveryone} className="text-red-600 focus:text-red-600">\n                                                            <Eraser className="mr-2 h-4 w-4" />\n                                                            Очистить чат у всех\n                                                        </DropdownMenuItem>\n                                                    )}\n${menuAnchor}`;
  source = replaceOnce(source, 'group creator clear menu', menuAnchor, menuBlock);

  if (!source.includes('/messages/all-v2') || !source.includes('Очистить чат у всех')) {
    throw new Error('Final group clear verification failed');
  }
  write(file, source);
};

const patchUsers = () => {
  const file = 'src/pages/Users.tsx';
  let source = read(file);
  const marker = '// SOCIALBIRD_FINAL_PLATFORM_V1: restricted-user-card';
  if (source.includes(marker)) return;

  source = replaceOnce(
    source,
    'users restricted fields',
    '    isOnline?: boolean;\n}',
    `    isOnline?: boolean;\n    restricted?: boolean;\n    profile_restricted?: boolean;\n    message?: string;\n    ${marker}\n}`,
  );

  source = replaceOnce(
    source,
    'users profile guard',
    '    const openProfile = (username: string) => {\n        navigate(`/users-profiles/${username}`);\n    };',
    '    const openProfile = (user: User) => {\n        if (user.restricted || user.profile_restricted) return;\n        navigate(`/users-profiles/${user.username}`);\n    };',
  );

  source = replaceOnce(
    source,
    'users profile button guard',
    '                                                onClick={() => openProfile(user.username)}',
    '                                                disabled={Boolean(user.restricted || user.profile_restricted)}\n                                                onClick={() => openProfile(user)}',
  );

  if (!source.includes('disabled={Boolean(user.restricted || user.profile_restricted)}')) {
    throw new Error('Restricted user card verification failed');
  }
  write(file, source);
};

const patchSettings = () => {
  const file = 'src/pages/Settings.tsx';
  let source = read(file);
  const marker = '{/* SOCIALBIRD_FINAL_PLATFORM_V1: account-email-card */}';
  if (source.includes(marker)) return;

  const anchor = `        <Card>\n          <CardHeader>\n            <CardTitle>{t("callDevices")}</CardTitle>`;
  const block = `        ${marker}\n        <Card>\n          <CardHeader>\n            <CardTitle>Аккаунт</CardTitle>\n            <CardDescription>Безопасность и контактные данные аккаунта SocialBIRD</CardDescription>\n          </CardHeader>\n          <CardContent>\n            <Button type="button" variant="outline" onClick={() => window.location.assign("/settings/email")}>\n              Сменить email с подтверждением\n            </Button>\n          </CardContent>\n        </Card>\n\n${anchor}`;
  source = replaceOnce(source, 'settings account card', anchor, block);
  write(file, source);
};

const patchCinemaRoom = () => {
  const file = 'src/pages/CinemaPartyRoom.tsx';
  let source = read(file);
  const bad = '      video.src = `${api}/cinema/stream/${roomId}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}&t=${Date.now()}`;';
  const good = '      video.src = `${api}/cinema/stream/${roomId}?${invite ? `invite=${encodeURIComponent(invite)}&` : ""}t=${Date.now()}`;';
  if (source.includes(bad)) source = source.replace(bad, good);
  if (!source.includes(good)) throw new Error('Cinema episode stream URL verification failed');
  write(file, source);
};

patchServer();
patchGroupChats();
patchUsers();
patchSettings();
patchCinemaRoom();

console.log('SocialBIRD final runtime patch applied: backend wiring, creator clear, restricted cards, email settings and C-Party episode URLs are current.');

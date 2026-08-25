import fs from 'node:fs';

const file = 'src/pages/CinemaParty.tsx';
const marker = '// SOCIALBIRD_CPARTY_PUBLIC_ROOMS_V1: live-refresh';
const source = fs.readFileSync(file, 'utf8');

if (source.includes(marker)) {
  console.log('C-Party public rooms live refresh already applied.');
  process.exit(0);
}

let next = source;

const loadOld = `    const [roomsResponse, mineResponse, libraryResponse] = await Promise.all([\n      fetch(\`${'${api}'}/cinema/rooms\`, { headers }),\n      fetch(\`${'${api}'}/cinema/rooms?mine=1\`, { headers }),\n      fetch(\`${'${api}'}/cinema/library\`, { headers }),\n    ]);`;
const loadNew = `    const refreshKey = Date.now();\n    const [roomsResponse, mineResponse, libraryResponse] = await Promise.all([\n      fetch(\`${'${api}'}/cinema/rooms?_=${'${refreshKey}'}\`, { headers, cache: \"no-store\" }),\n      fetch(\`${'${api}'}/cinema/rooms?mine=1&_=${'${refreshKey}'}\`, { headers, cache: \"no-store\" }),\n      fetch(\`${'${api}'}/cinema/library?_=${'${refreshKey}'}\`, { headers, cache: \"no-store\" }),\n    ]);`;
if (!next.includes(loadOld)) throw new Error('C-Party public rooms patch failed: load() fetch block not found');
next = next.replace(loadOld, loadNew);

const effectOld = `  useEffect(() => { void load(); }, []);`;
const effectNew = `  useEffect(() => { void load(); }, []);\n\n  ${marker}\n  useEffect(() => {\n    const refresh = () => {\n      if (document.visibilityState !== \"hidden\") void load();\n    };\n    const timer = window.setInterval(refresh, 3000);\n    window.addEventListener(\"focus\", refresh);\n    window.addEventListener(\"pageshow\", refresh);\n    document.addEventListener(\"visibilitychange\", refresh);\n    window.addEventListener(\"itbird-cinema-room-changed\", refresh);\n    return () => {\n      window.clearInterval(timer);\n      window.removeEventListener(\"focus\", refresh);\n      window.removeEventListener(\"pageshow\", refresh);\n      document.removeEventListener(\"visibilitychange\", refresh);\n      window.removeEventListener(\"itbird-cinema-room-changed\", refresh);\n    };\n  }, []);`;
if (!next.includes(effectOld)) throw new Error('C-Party public rooms patch failed: initial load effect not found');
next = next.replace(effectOld, effectNew);

const roomsTabOld = `onClick={() => setTab(\"rooms\")}`;
const roomsTabNew = `onClick={() => { setTab(\"rooms\"); void load(); }}`;
if (!next.includes(roomsTabOld)) throw new Error('C-Party public rooms patch failed: public rooms tab not found');
next = next.replace(roomsTabOld, roomsTabNew);

const mineTabOld = `onClick={() => setTab(\"mine\")}`;
const mineTabNew = `onClick={() => { setTab(\"mine\"); void load(); }}`;
if (next.includes(mineTabOld)) next = next.replace(mineTabOld, mineTabNew);

const createSuccessOld = `      if (!response.ok) throw new Error(data?.message || \"Не удалось создать комнату\");\n      navigate(\`/c-party/room/${'${data.id}'}?invite=${'${data.inviteToken}'}\`);`;
const createSuccessNew = `      if (!response.ok) throw new Error(data?.message || \"Не удалось создать комнату\");\n      window.dispatchEvent(new CustomEvent(\"itbird-cinema-room-changed\", { detail: { roomId: data.id, visibility } }));\n      navigate(\`/c-party/room/${'${data.id}'}?invite=${'${data.inviteToken}'}\`);`;
if (!next.includes(createSuccessOld)) throw new Error('C-Party public rooms patch failed: create success block not found');
next = next.replace(createSuccessOld, createSuccessNew);

if (!next.includes(marker) || !next.includes('cache: "no-store"') || !next.includes('window.setInterval(refresh, 3000)')) {
  throw new Error('C-Party public rooms verification failed');
}

fs.writeFileSync(file, next, 'utf8');
console.log('C-Party public rooms fixed: no-store fetches, focus/visibility refresh, periodic refresh and immediate tab refresh enabled.');

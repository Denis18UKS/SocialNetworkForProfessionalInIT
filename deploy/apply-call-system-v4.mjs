import fs from 'node:fs';

const realtimeFile = 'src/components/RealtimeNotifications.tsx';
let realtime = fs.readFileSync(realtimeFile, 'utf8').replace(/\r\n/g, '\n');
const marker = '// SOCIALBIRD_CALL_SYSTEM_V4: CallProvider owns CALL_* signalling';

if (!realtime.includes(marker)) {
  const pattern = /(\s+const notification = JSON\.parse\(event\.data\);\n)/;
  if (!pattern.test(realtime)) {
    throw new Error('Call system V4 patch failed: RealtimeNotifications websocket parse anchor not found');
  }
  realtime = realtime.replace(
    pattern,
    `$1\n      ${marker}\n      if (String(notification.type || '').startsWith('CALL_')) return;\n`,
  );
  fs.writeFileSync(realtimeFile, realtime, 'utf8');
}

const requiredFiles = [
  'src/components/call/CallProvider.tsx',
  'src/components/VoiceCallControls.tsx',
  'src/components/GlobalCallOverlay.tsx',
  'src/App.tsx',
  'src/lib/webrtc.ts',
  'src/lib/screen-share.ts',
];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Call system V4 missing file: ${file}`);
}

const provider = fs.readFileSync('src/components/call/CallProvider.tsx', 'utf8');
const overlay = fs.readFileSync('src/components/GlobalCallOverlay.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const webrtc = fs.readFileSync('src/lib/webrtc.ts', 'utf8');

for (const expected of [
  'export const CallProvider',
  'CALL_SCREEN_START',
  'switchCamera',
  'itbird-native-call-action',
  'createSpeakingMonitor',
]) {
  if (!provider.includes(expected)) throw new Error(`Call system V4 provider verification failed: ${expected}`);
}
for (const expected of ['Перевернуть камеру', 'Демонстрация экрана', 'Говорит']) {
  if (!overlay.includes(expected)) throw new Error(`Call system V4 overlay verification failed: ${expected}`);
}
if (!app.includes('<CallProvider>')) throw new Error('Call system V4 App provider is not mounted');
if (!webrtc.includes('CameraFacingMode') || !webrtc.includes('facingMode')) {
  throw new Error('Call system V4 mobile camera controls missing');
}
if (!realtime.includes(marker)) throw new Error('Call system V4 realtime isolation marker missing');

console.log('Call system V4 applied: one CallProvider owns signalling/media; legacy RealtimeNotifications CALL_* handling is disabled.');

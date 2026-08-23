import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'backend/server.js');
let source = fs.readFileSync(serverPath, 'utf8');

const replaceRequired = (label, from, to) => {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Native FCM patch failed: ${label}`);
  source = source.replace(from, to);
};

if (!source.includes('NATIVE_FCM_PUSH: dispatcher-slot')) {
  replaceRequired(
    'dispatcher slot',
    '// WebSocket уведомление\n// PRODUCTION_HARDENING: authenticated-targeted-notifications\nconst notifyClients = (notification) => {',
    `// WebSocket уведомление\n// NATIVE_FCM_PUSH: dispatcher-slot\nlet nativeFcmPush = null;\n// PRODUCTION_HARDENING: authenticated-targeted-notifications\nconst notifyClients = (notification) => {`,
  );
}

if (!source.includes('NATIVE_FCM_PUSH: dispatch-targeted-notification')) {
  const marker = `    wss.clients.forEach((client) => {\n        if (client.readyState !== WebSocket.OPEN || !client.userId) return;\n        if (hasExplicitTargets && !targetIds.has(Number(client.userId))) return;\n        client.send(serializedNotification);\n    });\n};`;
  const replacement = `    wss.clients.forEach((client) => {\n        if (client.readyState !== WebSocket.OPEN || !client.userId) return;\n        if (hasExplicitTargets && !targetIds.has(Number(client.userId))) return;\n        client.send(serializedNotification);\n    });\n\n    // NATIVE_FCM_PUSH: dispatch-targeted-notification\n    // FCM is a wake-up/OS notification transport only. React/WebRTC remains the\n    // interactive call implementation and durable OFFER/ICE replay stays unchanged.\n    if (nativeFcmPush && hasExplicitTargets) {\n        void nativeFcmPush.dispatch(notification).catch((error) => {\n            console.warn('Native FCM dispatch error:', error.message);\n        });\n    }\n};`;
  replaceRequired('notifyClients FCM dispatch', marker, replacement);
}

if (!source.includes('NATIVE_FCM_PUSH: register-routes')) {
  const marker = '// Старт сервера\n// PRODUCTION_HARDENING: configurable-listen-address';
  const block = `// NATIVE_FCM_PUSH: register-routes\nconst { registerNativeFcmPush } = require('./native-fcm-push');\nnativeFcmPush = registerNativeFcmPush({ app, db, verifyToken });\n\n${marker}`;
  replaceRequired('register native FCM routes', marker, block);
}

fs.writeFileSync(serverPath, source, 'utf8');
console.log('Native Android FCM push backend wiring is current.');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/components/VoiceCallControls.tsx');
let source = fs.readFileSync(filePath, 'utf8');

if (!source.includes('CALL_HANGUP_LIFECYCLE_FIX: active-call-guard')) {
  const oldStart = `  const endCall = () => {\n    liveCallRef.current = false;`;
  const newStart = `  const endCall = (notifyRemote = true) => {\n    // CALL_HANGUP_LIFECYCLE_FIX: active-call-guard\n    // A VoiceCallControls instance may unmount even when it never owned an active\n    // call. Never emit CALL_HANGUP just because the component disappeared.\n    const hadActiveCall = Boolean(\n      isCallingRef.current ||\n      liveCallRef.current ||\n      localStreamRef.current ||\n      Object.keys(peersRef.current).length > 0\n    );\n    liveCallRef.current = false;`;
  if (!source.includes(oldStart)) throw new Error('Call hangup lifecycle fix: endCall start marker not found');
  source = source.replace(oldStart, newStart);

  const oldSend = `    if (targetIds.length > 0) sendSignal("CALL_HANGUP", targetIds, { endForAll: true });`;
  const newSend = `    if (notifyRemote && hadActiveCall && targetIds.length > 0) {\n      sendSignal("CALL_HANGUP", targetIds, { endForAll: true });\n    }`;
  if (!source.includes(oldSend)) throw new Error('Call hangup lifecycle fix: hangup send marker not found');
  source = source.replace(oldSend, newSend);

  source = source.replace(
    `      if (payload.type === "CALL_HANGUP") {\n        if (mode === 'group' && !data.endForAll) {\n          removeGroupPeer(Number(data.senderId));\n        } else {\n          endCall();\n        }\n      }`,
    `      if (payload.type === "CALL_HANGUP") {\n        if (mode === 'group' && !data.endForAll) {\n          removeGroupPeer(Number(data.senderId));\n        } else {\n          // Remote hangup is terminal locally; do not echo another HANGUP back.\n          endCall(false);\n        }\n      }`,
  );

  source = source.replace(
    `    return () => {\n      if (isCallingRef.current || liveCallRef.current || localStreamRef.current || Object.keys(peersRef.current).length > 0) return;\n      socket.close();\n      endCall();\n    };`,
    `    return () => {\n      if (isCallingRef.current || liveCallRef.current || localStreamRef.current || Object.keys(peersRef.current).length > 0) return;\n      socket.close();\n      // Component lifecycle cleanup is not a user hangup.\n      endCall(false);\n    };`,
  );

  source = source.replace(
    `    windowWithCall.__itbirdActiveCallEnd = endCall;`,
    `    windowWithCall.__itbirdActiveCallEnd = () => endCall(true);`,
  );

  source = source.replace(
    `            <Button variant="destructive" size="sm" onClick={endCall} className="px-6">`,
    `            <Button variant="destructive" size="sm" onClick={() => endCall(true)} className="px-6">`,
  );

  fs.writeFileSync(filePath, source, 'utf8');
  console.log('Applied call hangup lifecycle fix: src/components/VoiceCallControls.tsx');
} else {
  console.log('Call hangup lifecycle fix already applied.');
}

const verify = fs.readFileSync(filePath, 'utf8');
if (!verify.includes('CALL_HANGUP_LIFECYCLE_FIX: active-call-guard')) throw new Error('Call hangup lifecycle marker missing');
if (!verify.includes('endCall(false);')) throw new Error('Local-only cleanup marker missing');
if (!verify.includes('notifyRemote && hadActiveCall')) throw new Error('Remote hangup guard missing');

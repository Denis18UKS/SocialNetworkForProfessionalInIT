import fs from 'node:fs';

const file = 'src/components/call/CallProvider.tsx';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const marker = '// SOCIALBIRD_CALL_SYSTEM_V5: cold-start-user-id-defer';
if (!source.includes(marker)) {
  const from = `    if (acceptingRef.current) return;\n    acceptingRef.current = true;\n    const selfId = currentUserIdRef.current;\n    if (!selfId) return;`;
  const to = `    if (acceptingRef.current) return;\n    const selfId = currentUserIdRef.current;\n    if (!selfId) {\n      // SOCIALBIRD_CALL_SYSTEM_V5: cold-start-user-id-defer\n      autoAnswerRef.current = true;\n      pendingPushAnswerRef.current = true;\n      return;\n    }\n    acceptingRef.current = true;`;
  if (!source.includes(from)) throw new Error('Call V5 push-state fix failed: accept user-id lock anchor');
  source = source.replace(from, to);
}

const nativeMarker = '// SOCIALBIRD_CALL_SYSTEM_V5: native-state-follows-real-phase';
if (!source.includes(nativeMarker)) {
  const from = `  const publishActive = useCallback((snapshot: CallSnapshot) => {\n    setCall(snapshot);\n    window.dispatchEvent(new CustomEvent("itbird-call-active", { detail: snapshot }));\n    window.dispatchEvent(new CustomEvent("itbird-native-call-state", { detail: { active: true } }));\n  }, []);`;
  const to = `  const publishActive = useCallback((snapshot: CallSnapshot) => {\n    setCall(snapshot);\n    window.dispatchEvent(new CustomEvent("itbird-call-active", { detail: snapshot }));\n    // SOCIALBIRD_CALL_SYSTEM_V5: native-state-follows-real-phase\n    window.dispatchEvent(new CustomEvent("itbird-native-call-state", {\n      detail: { active: snapshot.phase === "active", connecting: snapshot.phase !== "active", phase: snapshot.phase },\n    }));\n  }, []);`;
  if (!source.includes(from)) throw new Error('Call V5 push-state fix failed: publishActive anchor');
  source = source.replace(from, to);
}

fs.writeFileSync(file, source, 'utf8');

for (const expected of [marker, nativeMarker]) {
  if (!source.includes(expected)) throw new Error(`Call V5 push-state verification failed: ${expected}`);
}
console.log('Call V5 push-state fix applied: cold-start user identity no longer locks acceptance and native active state waits for real WebRTC connection.');

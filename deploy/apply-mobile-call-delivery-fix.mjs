import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const patchFile = (relativePath, transform) => {
  const filePath = path.join(root, relativePath);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    console.log(`Applied mobile-call delivery fix: ${relativePath}`);
  }
};

const replaceRequired = (source, label, from, to) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Mobile-call delivery fix failed: ${label}`);
  return source.replace(from, to);
};

patchFile('backend/social-next-features.js', (input) => {
  let source = input;
  if (!source.includes('MOBILE_CALL_DELIVERY_FIX: push-even-if-presence-is-stale')) {
    source = replaceRequired(
      source,
      'push target selection',
      `        const uniqueTargets = Array.from(new Set((targetIds || []).map(Number).filter(Number.isFinite)))\n            .filter((userId) => !isUserOnline(userId));`,
      `        // MOBILE_CALL_DELIVERY_FIX: push-even-if-presence-is-stale\n        // Mobile browsers can keep a WebSocket looking online on the server while the\n        // tab is actually suspended. Push every subscribed target; the service worker\n        // suppresses the system notification when a visible SocialBIRD window exists.\n        const uniqueTargets = Array.from(new Set((targetIds || []).map(Number).filter(Number.isFinite)));`,
    );
  }
  return source;
});

patchFile('backend/offline-call-queue.js', (input) => {
  let source = input;

  if (!source.includes('MOBILE_CALL_DELIVERY_FIX: durable-signals')) {
    source = replaceRequired(
      source,
      'durable target selection',
      `            if (!['CALL_INVITE', 'CALL_OFFER', 'CALL_ICE', 'CALL_RELAY_TRACK'].includes(type)) return;\n            const offlineTargets = uniqueTargets.filter((userId) => !isUserOnline(userId));\n            if (offlineTargets.length === 0) return;\n\n            for (const targetUserId of offlineTargets) {`,
      `            if (!['CALL_INVITE', 'CALL_OFFER', 'CALL_ICE', 'CALL_RELAY_TRACK'].includes(type)) return;\n\n            // MOBILE_CALL_DELIVERY_FIX: durable-signals\n            // Store the short-lived signaling path even when presence currently says\n            // "online". A suspended mobile tab can have a stale OPEN socket. If it\n            // reconnects, AUTH replays these signals and the incoming call still works.\n            for (const targetUserId of uniqueTargets) {`,
    );
  }

  if (!source.includes('MOBILE_CALL_DELIVERY_FIX: clear-accepted-incoming-signals')) {
    const marker = `            await db.query('DELETE FROM pending_call_signals WHERE expires_at <= NOW()');`;
    const replacement = `${marker}\n\n            // MOBILE_CALL_DELIVERY_FIX: clear-accepted-incoming-signals\n            // CALL_ANSWER/HANGUP sent by the callee contains the original caller id in\n            // data.senderId. Remove the caller -> callee durable invite/offer/ICE rows\n            // so a later reconnect cannot resurrect an already answered/ended call.\n            const originalCallerId = Number(data?.senderId);\n            if (['CALL_ANSWER', 'CALL_HANGUP'].includes(type) && originalCallerId && originalCallerId !== Number(senderId)) {\n                const incomingCallKey = buildCallKey(originalCallerId, data);\n                await db.query(\n                    'DELETE FROM pending_call_signals WHERE target_user_id = ? AND sender_user_id = ? AND call_key = ?',\n                    [Number(senderId), originalCallerId, incomingCallKey]\n                );\n            }`;
    source = replaceRequired(source, 'accepted incoming signal cleanup', marker, replacement);
  }

  return source;
});

patchFile('src/components/RealtimeNotifications.tsx', (input) => {
  let source = input;

  if (!source.includes('suppressIncomingDialogDeclineRef')) {
    source = replaceRequired(
      source,
      'incoming dialog suppression ref',
      '  const ringtoneTimerRef = useRef<number | null>(null);',
      '  const ringtoneTimerRef = useRef<number | null>(null);\n  const suppressIncomingDialogDeclineRef = useRef(false);',
    );
  }

  if (!source.includes('MOBILE_CALL_DELIVERY_FIX: answer-without-dialog-decline')) {
    source = replaceRequired(
      source,
      'accept incoming suppression start',
      `    try {\n      stopRingtone();`,
      `    try {\n      // MOBILE_CALL_DELIVERY_FIX: answer-without-dialog-decline\n      // The controlled Dialog becomes closed when incomingCall is cleared below.\n      // Do not let that programmatic close be interpreted as pressing "Decline".\n      suppressIncomingDialogDeclineRef.current = true;\n      stopRingtone();`,
    );

    source = replaceRequired(
      source,
      'accept incoming suppression finish',
      `      sendCallSignal("CALL_ACCEPT", [incomingCall.senderId], incomingCall);\n      sendCallSignal("CALL_ANSWER", [incomingCall.senderId], { ...incomingCall, description: answer });\n    } catch (error) {`,
      `      sendCallSignal("CALL_ACCEPT", [incomingCall.senderId], incomingCall);\n      sendCallSignal("CALL_ANSWER", [incomingCall.senderId], { ...incomingCall, description: answer });\n      window.setTimeout(() => {\n        suppressIncomingDialogDeclineRef.current = false;\n      }, 750);\n    } catch (error) {\n      suppressIncomingDialogDeclineRef.current = false;`,
    );
  }

  source = replaceRequired(
    source,
    'controlled incoming dialog close',
    '<Dialog open={Boolean(incomingCall)} onOpenChange={(open) => !open && declineIncomingCall()}>',
    `<Dialog\n        open={Boolean(incomingCall)}\n        onOpenChange={(open) => {\n          if (!open && !suppressIncomingDialogDeclineRef.current) declineIncomingCall();\n        }}\n      >`,
  );

  if (!source.includes('MOBILE_CALL_DELIVERY_FIX: ignore-unrelated-hangup')) {
    source = replaceRequired(
      source,
      'stale hangup guard',
      `      if (notification.type === "CALL_HANGUP") {\n        const call = notification.data as IncomingCall & { endForAll?: boolean };\n        if (call.senderId === currentUserId) return;\n        if (!call.targetIds?.includes(currentUserId)) return;`,
      `      if (notification.type === "CALL_HANGUP") {\n        const call = notification.data as IncomingCall & { endForAll?: boolean };\n        if (call.senderId === currentUserId) return;\n        if (!call.targetIds?.includes(currentUserId)) return;\n        // MOBILE_CALL_DELIVERY_FIX: ignore-unrelated-hangup\n        const currentCall = activeCallRef.current || pendingOfferRef.current;\n        if (currentCall && (String(currentCall.chatId) !== String(call.chatId) || currentCall.mode !== call.mode)) return;`,
    );
  }

  return source;
});

console.log('Mobile PC-to-phone call delivery fix is current.');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/components/RealtimeNotifications.tsx');
let source = fs.readFileSync(filePath, 'utf8');

const marker = '// CALL_VIDEO_FIX: mount-panel-before-remote-description';
if (!source.includes(marker)) {
  const from = `      await peer.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current.description));
      // APP_FIX: flush-pending-ice
      for (const candidate of pendingIceCandidatesRef.current.splice(0)) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
      }
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendCallSignal("CALL_ACCEPT", [incomingCall.senderId], incomingCall);
      sendCallSignal("CALL_ANSWER", [incomingCall.senderId], { ...incomingCall, description: answer });
      setActiveCall(incomingCall);
      setIncomingCall(null);`;

  const to = `      // CALL_VIDEO_FIX: mount-panel-before-remote-description
      // Mount the visible call panel before setRemoteDescription can fire ontrack.
      setActiveCall(incomingCall);
      setIncomingCall(null);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

      await peer.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current.description));
      // APP_FIX: flush-pending-ice
      for (const candidate of pendingIceCandidatesRef.current.splice(0)) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
      }
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendCallSignal("CALL_ACCEPT", [incomingCall.senderId], incomingCall);
      sendCallSignal("CALL_ANSWER", [incomingCall.senderId], { ...incomingCall, description: answer });`;

  if (!source.includes(from)) {
    throw new Error('Call video mount fix failed: accept sequence not found');
  }
  source = source.replace(from, to);
  fs.writeFileSync(filePath, source, 'utf8');
  console.log('Applied incoming remote video mount fix.');
} else {
  console.log('Incoming remote video mount fix is current.');
}

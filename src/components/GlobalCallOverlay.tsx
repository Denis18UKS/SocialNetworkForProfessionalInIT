import { useEffect, useRef, useState } from "react";
import { Maximize2, Mic, MicOff, Minimize2, PhoneOff, ScreenShare, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";

type Participant = { id: number; username: string; avatar?: string | null };
type CallState = {
  chatId?: number | string;
  mode?: "private" | "group";
  title?: string;
  callKind?: "voice" | "video";
  participants?: Participant[];
  micEnabled?: boolean;
  soundEnabled?: boolean;
  videoEnabled?: boolean;
  screenEnabled?: boolean;
  localStream?: MediaStream | null;
  screenStream?: MediaStream | null;
};

type RemoteStreamEvent = { peerId: number; stream: MediaStream; label?: string };
type CallWindow = Window & {
  __itbirdActiveCallEnd?: () => void;
  __itbirdActiveCallToggleMic?: () => void;
  __itbirdActiveCallToggleSound?: () => void;
  __itbirdActiveCallToggleVideo?: () => void;
  __itbirdActiveCallToggleScreen?: () => void;
  __itbirdActiveCallState?: CallState | null;
};

const fullscreen = async (element: HTMLElement | null) => {
  if (!element) return;
  try {
    if (!document.fullscreenElement) await element.requestFullscreen?.();
    else await document.exitFullscreen?.();
  } catch {}
};

const RemoteVideo = ({ peerId, stream }: { peerId: number; stream: MediaStream }) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    void ref.current.play().catch(() => undefined);
  }, [stream]);
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
      <div className="absolute left-2 top-2 z-10 rounded bg-black/65 px-2 py-1 text-[11px]">Участник #{peerId}</div>
      <video ref={ref} autoPlay playsInline muted className="max-h-[52dvh] w-full cursor-zoom-in object-contain" onDoubleClick={() => void fullscreen(ref.current)} />
      <button type="button" onClick={() => void fullscreen(ref.current)} className="absolute bottom-2 right-2 rounded-lg bg-black/70 p-2 hover:bg-black/90" title="На весь экран"><Maximize2 className="h-4 w-4" /></button>
    </div>
  );
};

const GlobalCallOverlay = () => {
  const [call, setCall] = useState<CallState | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<number, MediaStream>>({});
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  const syncFromWindow = () => {
    const state = (window as CallWindow).__itbirdActiveCallState || null;
    setCall(state ? { ...state } : null);
    if (!state) {
      setMinimized(false);
      setRemoteStreams({});
    }
  };

  useEffect(() => {
    const onActive = (event: Event) => {
      const detail = (event as CustomEvent<CallState>).detail || {};
      const state = (window as CallWindow).__itbirdActiveCallState;
      setCall({ ...(state || {}), ...detail });
      setMinimized(false);
    };
    const onState = () => syncFromWindow();
    const onRemote = (event: Event) => {
      const detail = (event as CustomEvent<RemoteStreamEvent>).detail;
      if (!detail?.stream || !Number.isFinite(Number(detail.peerId))) return;
      const stream = detail.stream.getVideoTracks().length > 0 ? new MediaStream(detail.stream.getVideoTracks()) : null;
      if (!stream) return;
      setRemoteStreams((current) => ({ ...current, [Number(detail.peerId)]: stream }));
    };
    const onPeerLeft = (event: Event) => {
      const peerId = Number((event as CustomEvent<{ peerId: number }>).detail?.peerId);
      if (!Number.isFinite(peerId)) return;
      setRemoteStreams((current) => {
        const next = { ...current };
        delete next[peerId];
        return next;
      });
    };
    const onEnded = () => {
      setCall(null);
      setMinimized(false);
      setRemoteStreams({});
    };
    window.addEventListener("itbird-call-active", onActive);
    window.addEventListener("itbird-call-state", onState);
    window.addEventListener("itbird-call-remote-stream", onRemote);
    window.addEventListener("itbird-call-peer-left", onPeerLeft);
    window.addEventListener("itbird-call-ended", onEnded);
    syncFromWindow();
    return () => {
      window.removeEventListener("itbird-call-active", onActive);
      window.removeEventListener("itbird-call-state", onState);
      window.removeEventListener("itbird-call-remote-stream", onRemote);
      window.removeEventListener("itbird-call-peer-left", onPeerLeft);
      window.removeEventListener("itbird-call-ended", onEnded);
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = call?.localStream || null;
      if (call?.localStream) void localVideoRef.current.play().catch(() => undefined);
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = call?.screenStream || null;
      if (call?.screenStream) void screenVideoRef.current.play().catch(() => undefined);
    }
  }, [call?.localStream, call?.screenStream, call?.videoEnabled, call?.screenEnabled]);

  if (!call) return null;

  const controls = window as CallWindow;
  const participants = call.participants || [];

  if (minimized) {
    return (
      <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-3 z-[100] flex max-w-[calc(100vw-24px)] items-center gap-2 rounded-full border border-white/15 bg-black/90 px-3 py-2 text-white shadow-2xl">
        <span className="max-w-40 truncate text-sm font-medium">{call.title || "Активный звонок"}</span>
        <Button size="sm" variant="ghost" className="h-8 w-8 rounded-full p-0 text-white hover:bg-white/15" onClick={() => setMinimized(false)}><Maximize2 className="h-4 w-4" /></Button>
        <Button size="sm" variant="destructive" className="h-8 w-8 rounded-full p-0" onClick={() => controls.__itbirdActiveCallEnd?.()}><PhoneOff className="h-4 w-4" /></Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-2 top-[calc(.5rem+var(--app-viewport-top,0px))] z-[100] mx-auto flex max-h-[calc(var(--app-viewport-height,100dvh)-1rem)] w-[min(920px,calc(100vw-16px))] flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/95 text-white shadow-2xl backdrop-blur sm:inset-x-4 sm:top-4">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{call.title || "Активный звонок"}</div>
          <div className="text-xs text-white/60">Звонок работает независимо от открытой страницы SocialBIRD</div>
        </div>
        <Button size="sm" variant="ghost" className="shrink-0 text-white hover:bg-white/15" onClick={() => setMinimized(true)}><Minimize2 className="h-4 w-4" /></Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {participants.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {participants.map((participant) => <div key={participant.id} className="rounded-full bg-white/10 px-2.5 py-1 text-xs">{participant.username}</div>)}
          </div>
        )}

        {Object.keys(remoteStreams).length > 0 && <div className="grid min-h-0 w-full grid-cols-1 gap-3 sm:grid-cols-2">{Object.entries(remoteStreams).map(([peerId, stream]) => <RemoteVideo key={`${peerId}-${stream.id}`} peerId={Number(peerId)} stream={stream} />)}</div>}

        {(call.videoEnabled || call.screenEnabled) && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {call.videoEnabled && call.localStream && (
              <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
                <div className="absolute left-2 top-2 z-10 rounded bg-black/65 px-2 py-1 text-[11px]">Вы — камера</div>
                <video ref={localVideoRef} autoPlay muted playsInline className="max-h-[42dvh] w-full object-contain" />
                <button type="button" onClick={() => void fullscreen(localVideoRef.current)} className="absolute bottom-2 right-2 rounded-lg bg-black/70 p-2 hover:bg-black/90" title="На весь экран"><Maximize2 className="h-4 w-4" /></button>
              </div>
            )}
            {call.screenEnabled && call.screenStream && (
              <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
                <div className="absolute left-2 top-2 z-10 rounded bg-black/65 px-2 py-1 text-[11px]">Вы — демонстрация экрана</div>
                <video ref={screenVideoRef} autoPlay muted playsInline className="max-h-[52dvh] w-full object-contain" />
                <button type="button" onClick={() => void fullscreen(screenVideoRef.current)} className="absolute bottom-2 right-2 rounded-lg bg-black/70 p-2 hover:bg-black/90" title="Демонстрация на весь экран"><Maximize2 className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 p-3">
        <Button size="sm" variant="ghost" className="bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => controls.__itbirdActiveCallToggleMic?.()}>{call.micEnabled === false ? <MicOff className="h-4 w-4 text-red-300" /> : <Mic className="h-4 w-4" />}</Button>
        <Button size="sm" variant="ghost" className="bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => controls.__itbirdActiveCallToggleSound?.()}>{call.soundEnabled === false ? <VolumeX className="h-4 w-4 text-red-300" /> : <Volume2 className="h-4 w-4" />}</Button>
        <Button size="sm" variant="ghost" className="bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => controls.__itbirdActiveCallToggleVideo?.()}>{call.videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}</Button>
        <Button size="sm" variant="ghost" className="bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => controls.__itbirdActiveCallToggleScreen?.()}><ScreenShare className={`h-4 w-4 ${call.screenEnabled ? "text-emerald-300" : ""}`} /></Button>
        <Button size="sm" variant="destructive" className="px-5" onClick={() => controls.__itbirdActiveCallEnd?.()}><PhoneOff className="mr-2 h-4 w-4" />Завершить</Button>
      </div>
    </div>
  );
};

export default GlobalCallOverlay;

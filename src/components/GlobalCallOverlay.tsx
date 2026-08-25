import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Headphones,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneCall,
  PhoneOff,
  PictureInPicture2,
  RefreshCw,
  ScreenShare,
  ScreenShareOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCallManager, type CallParticipant } from "@/components/call/CallProvider";

const fullscreen = async (element: HTMLElement | null) => {
  if (!element) return;
  try {
    if (!document.fullscreenElement) await element.requestFullscreen?.();
    else await document.exitFullscreen?.();
  } catch {}
};

const VideoSurface = ({ stream, label, muted = true }: { stream: MediaStream; label: string; muted?: boolean }) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="relative min-h-36 overflow-hidden rounded-xl border border-white/10 bg-black sm:min-h-48">
      <div className="absolute left-2 top-2 z-10 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
        {label}
      </div>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className="h-full max-h-[52dvh] min-h-36 w-full cursor-zoom-in object-contain sm:min-h-48"
        onDoubleClick={() => void fullscreen(ref.current)}
      />
      <button
        type="button"
        className="absolute bottom-2 right-2 rounded-lg bg-black/70 p-2 text-white hover:bg-black/90"
        title="На весь экран"
        onClick={() => void fullscreen(ref.current)}
      >
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  );
};

const participantName = (participants: CallParticipant[], id: number) =>
  participants.find((participant) => Number(participant.id) === Number(id))?.username || `Участник #${id}`;

const GlobalCallOverlay = () => {
  const {
    call,
    incoming,
    remoteMedia,
    speakingUserIds,
    currentUserId,
    isMobile,
    acceptIncoming,
    declineIncoming,
    hangup,
    toggleMic,
    toggleSound,
    toggleCamera,
    switchCamera,
    toggleScreenShare,
    toggleSpeaker,
    enterPictureInPicture,
    forceRemoteAudioPlayback,
  } = useCallManager();

  const [minimized, setMinimized] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localScreenRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!call) setMinimized(false);
  }, [call?.callId]);

  useEffect(() => {
    const blocked = () => setAudioBlocked(true);
    window.addEventListener("itbird-call-audio-blocked", blocked);
    return () => window.removeEventListener("itbird-call-audio-blocked", blocked);
  }, []);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) return;
    video.srcObject = call?.localStream || null;
    if (call?.localStream) void video.play().catch(() => undefined);
  }, [call?.localStream, call?.cameraEnabled]);

  useEffect(() => {
    const video = localScreenRef.current;
    if (!video) return;
    video.srcObject = call?.screenStream || null;
    if (call?.screenStream) void video.play().catch(() => undefined);
  }, [call?.screenStream, call?.screenEnabled]);

  const remoteSurfaces = useMemo(() => Object.entries(remoteMedia).flatMap(([peerKey, media]) => {
    const peerId = Number(peerKey);
    const name = call ? participantName(call.participants, peerId) : `Участник #${peerId}`;
    const surfaces: Array<{ key: string; stream: MediaStream; label: string }> = [];
    if (media.camera) surfaces.push({ key: `camera-${peerId}-${media.camera.id}`, stream: media.camera, label: `${name} — камера` });
    if (media.screen) surfaces.push({ key: `screen-${peerId}-${media.screen.id}`, stream: media.screen, label: `${name} — экран` });
    return surfaces;
  }), [call?.participants, remoteMedia]);

  if (incoming && !call) {
    const isVideo = incoming.callKind === "video";
    const caller = incoming.callerName || incoming.title || "Пользователь SocialBIRD";
    return (
      <div className="fixed inset-x-3 top-[calc(.75rem+var(--app-viewport-top,0px))] z-[120] mx-auto w-[min(460px,calc(100vw-24px))] rounded-2xl border border-white/15 bg-black/95 p-4 text-white shadow-2xl backdrop-blur sm:top-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10">
            {isVideo ? <Video className="h-6 w-6" /> : <PhoneCall className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wide text-white/55">{isVideo ? "Входящий видеозвонок" : "Входящий звонок"}</div>
            <div className="truncate text-lg font-semibold">{caller}</div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button type="button" variant="destructive" className="h-12 gap-2" onClick={declineIncoming}>
            <X className="h-5 w-5" />Отклонить
          </Button>
          <Button type="button" className="h-12 gap-2 bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => void acceptIncoming()}>
            <Check className="h-5 w-5" />Принять
          </Button>
        </div>
      </div>
    );
  }

  if (!call) return null;

  if (minimized) {
    return (
      <div className="fixed bottom-[calc(.75rem+env(safe-area-inset-bottom))] right-3 z-[120] flex max-w-[calc(100vw-24px)] items-center gap-2 rounded-full border border-white/15 bg-black/95 px-3 py-2 text-white shadow-2xl">
        <span className="max-w-40 truncate text-sm font-medium">{call.title || "Активный звонок"}</span>
        {speakingUserIds.length > 0 && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" title="Кто-то говорит" />}
        <Button size="sm" variant="ghost" className="h-9 w-9 rounded-full p-0 text-white hover:bg-white/15" onClick={() => setMinimized(false)}>
          <Maximize2 className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="destructive" className="h-9 w-9 rounded-full p-0" onClick={hangup}>
          <PhoneOff className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const controlClass = "h-11 w-11 rounded-full p-0 text-white hover:bg-white/20 sm:h-10 sm:w-10";
  const phaseLabel = call.phase === "calling"
    ? "Вызов…"
    : call.phase === "connecting"
      ? "Подключение…"
      : "Звонок активен";

  return (
    <div className="fixed inset-x-2 top-[calc(.5rem+var(--app-viewport-top,0px))] z-[120] mx-auto flex max-h-[calc(var(--app-viewport-height,100dvh)-1rem)] w-[min(980px,calc(100vw-16px))] flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/95 text-white shadow-2xl backdrop-blur sm:inset-x-4 sm:top-4">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{call.title || "Активный звонок"}</div>
          <div className="flex items-center gap-2 text-xs text-white/55">
            <span>{phaseLabel}</span>
            <span>•</span>
            <span>{call.mode === "group" ? "групповой" : "личный"}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isMobile && (
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-white hover:bg-white/15" onClick={enterPictureInPicture} title="Картинка в картинке">
              <PictureInPicture2 className="h-4 w-4" />
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-white hover:bg-white/15" onClick={() => setMinimized(true)} title="Свернуть">
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {call.participants.map((participant) => {
            const id = Number(participant.id);
            const speaking = speakingUserIds.includes(id);
            const self = id === currentUserId;
            return (
              <div
                key={id}
                className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition ${speaking ? "border-emerald-400 bg-emerald-400/15 shadow-[0_0_14px_rgba(52,211,153,.25)]" : "border-white/10 bg-white/5"}`}
              >
                <span className={`h-2 w-2 rounded-full ${speaking ? "animate-pulse bg-emerald-400" : "bg-white/25"}`} />
                <span className="max-w-36 truncate">{self ? `${participant.username} (вы)` : participant.username}</span>
                {speaking && <span className="text-[10px] font-semibold text-emerald-300">Говорит</span>}
              </div>
            );
          })}
        </div>

        {audioBlocked && call.soundEnabled && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mb-3 w-full sm:w-auto"
            onClick={() => {
              void forceRemoteAudioPlayback().finally(() => setAudioBlocked(false));
            }}
          >
            Нажмите, чтобы включить звук собеседника
          </Button>
        )}

        {remoteSurfaces.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {remoteSurfaces.map((surface) => <VideoSurface key={surface.key} stream={surface.stream} label={surface.label} />)}
          </div>
        )}

        {(call.cameraEnabled || call.screenEnabled) && (
          <div className={`grid grid-cols-1 gap-3 ${remoteSurfaces.length > 0 ? "mt-3" : ""} sm:grid-cols-2`}>
            {call.cameraEnabled && call.localStream && (
              <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
                <div className="absolute left-2 top-2 z-10 rounded-md bg-black/70 px-2 py-1 text-[11px]">Вы — камера</div>
                <video ref={localVideoRef} autoPlay muted playsInline className="max-h-[42dvh] min-h-36 w-full object-contain" />
                <button type="button" className="absolute bottom-2 right-2 rounded-lg bg-black/70 p-2" onClick={() => void fullscreen(localVideoRef.current)}>
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            )}
            {call.screenEnabled && call.screenStream && (
              <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
                <div className="absolute left-2 top-2 z-10 rounded-md bg-black/70 px-2 py-1 text-[11px]">Вы — демонстрация экрана</div>
                <video ref={localScreenRef} autoPlay muted playsInline className="max-h-[52dvh] min-h-36 w-full object-contain" />
                <button type="button" className="absolute bottom-2 right-2 rounded-lg bg-black/70 p-2" onClick={() => void fullscreen(localScreenRef.current)}>
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {remoteSurfaces.length === 0 && !call.cameraEnabled && !call.screenEnabled && (
          <div className="flex min-h-40 items-center justify-center rounded-xl border border-white/10 bg-white/[.03] text-center text-sm text-white/50">
            Голосовой звонок
          </div>
        )}
      </div>

      <div className="border-t border-white/10 bg-black/80 px-2 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:px-3 sm:pb-3">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" size="sm" variant="ghost" className={`${controlClass} bg-white/10`} onClick={toggleMic} title={call.micEnabled ? "Выключить микрофон" : "Включить микрофон"}>
            {call.micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5 text-red-300" />}
          </Button>

          <Button type="button" size="sm" variant="ghost" className={`${controlClass} bg-white/10`} onClick={toggleSound} title={call.soundEnabled ? "Выключить звук" : "Включить звук"}>
            {call.soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5 text-red-300" />}
          </Button>

          {isMobile && (
            <Button type="button" size="sm" variant="ghost" className={`${controlClass} ${call.speakerEnabled ? "bg-emerald-500/20" : "bg-white/10"}`} onClick={toggleSpeaker} title={call.speakerEnabled ? "Переключить на разговорный динамик" : "Включить громкий динамик"}>
              {call.speakerEnabled ? <Volume2 className="h-5 w-5 text-emerald-300" /> : <Headphones className="h-5 w-5" />}
            </Button>
          )}

          <Button type="button" size="sm" variant="ghost" className={`${controlClass} ${call.cameraEnabled ? "bg-emerald-500/20" : "bg-white/10"}`} onClick={() => void toggleCamera()} title={call.cameraEnabled ? "Выключить камеру" : "Включить камеру"}>
            {call.cameraEnabled ? <Video className="h-5 w-5 text-emerald-300" /> : <VideoOff className="h-5 w-5 text-red-300" />}
          </Button>

          {call.cameraEnabled && (
            <Button type="button" size="sm" variant="ghost" className={`${controlClass} bg-white/10`} onClick={() => void switchCamera()} title={isMobile ? "Перевернуть камеру" : "Следующая камера"}>
              <RefreshCw className="h-5 w-5" />
            </Button>
          )}

          <Button type="button" size="sm" variant="ghost" className={`${controlClass} ${call.screenEnabled ? "bg-emerald-500/20" : "bg-white/10"}`} onClick={() => void toggleScreenShare()} title={call.screenEnabled ? "Остановить демонстрацию" : "Демонстрация экрана"}>
            {call.screenEnabled ? <ScreenShareOff className="h-5 w-5 text-emerald-300" /> : <ScreenShare className="h-5 w-5" />}
          </Button>

          <Button type="button" size="sm" variant="destructive" className="h-11 min-w-14 rounded-full px-4 sm:h-10" onClick={hangup} title="Завершить звонок">
            <PhoneOff className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default GlobalCallOverlay;

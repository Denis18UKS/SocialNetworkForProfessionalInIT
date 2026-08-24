import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";

type MediaViewerPayload = {
  type: "image" | "video";
  src: string;
  title?: string;
};

const EVENT_NAME = "socialbird-open-media";

export const openMediaViewer = (payload: MediaViewerPayload) => {
  window.dispatchEvent(new CustomEvent<MediaViewerPayload>(EVENT_NAME, { detail: payload }));
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const MediaViewerHost = () => {
  const [media, setMedia] = useState<MediaViewerPayload | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const payload = (event as CustomEvent<MediaViewerPayload>).detail;
      if (!payload?.src) return;
      setMedia(payload);
      setScale(1);
      setOffset({ x: 0, y: 0 });
    };
    window.addEventListener(EVENT_NAME, handleOpen);
    return () => window.removeEventListener(EVENT_NAME, handleOpen);
  }, []);

  useEffect(() => {
    if (!media) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMedia(null);
      if (event.key === "+" || event.key === "=") setScale((value) => clamp(value + 0.25, 1, 5));
      if (event.key === "-") setScale((value) => clamp(value - 0.25, 1, 5));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [media]);

  useEffect(() => {
    if (scale <= 1) setOffset({ x: 0, y: 0 });
  }, [scale]);

  const transform = useMemo(
    () => `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
    [offset, scale],
  );

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const fullscreen = async () => {
    try {
      if (!document.fullscreenElement) await rootRef.current?.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch {}
  };

  const pointerDistance = () => {
    const values = Array.from(pointers.current.values());
    if (values.length < 2) return 0;
    return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (media?.type !== "image") return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      dragStart.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
    } else if (pointers.current.size === 2) {
      pinchStart.current = { distance: pointerDistance(), scale };
      dragStart.current = null;
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (media?.type !== "image" || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinchStart.current) {
      const distance = pointerDistance();
      if (pinchStart.current.distance > 0) {
        setScale(clamp(pinchStart.current.scale * (distance / pinchStart.current.distance), 1, 5));
      }
      return;
    }
    if (scale > 1 && dragStart.current) {
      setOffset({
        x: dragStart.current.offsetX + event.clientX - dragStart.current.x,
        y: dragStart.current.offsetY + event.clientY - dragStart.current.y,
      });
    }
  };

  const releasePointer = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) dragStart.current = null;
  };

  if (!media) return null;

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[200] flex h-[100dvh] w-screen flex-col bg-black/95 text-white"
      role="dialog"
      aria-modal="true"
      aria-label={media.type === "image" ? "Просмотр изображения" : "Просмотр видео"}
    >
      <div className="mobile-top-safe flex shrink-0 items-center justify-between gap-2 px-3 py-2 sm:px-5">
        <div className="min-w-0 flex-1 truncate text-sm text-white/80">{media.title || (media.type === "image" ? "Изображение" : "Видео")}</div>
        <div className="flex shrink-0 items-center gap-1">
          {media.type === "image" && (
            <>
              <button type="button" className="rounded-full p-2 hover:bg-white/10" onClick={() => setScale((value) => clamp(value - 0.25, 1, 5))} title="Уменьшить"><Minus className="h-5 w-5" /></button>
              <button type="button" className="min-w-12 rounded-full px-2 py-2 text-xs hover:bg-white/10" onClick={reset} title="Сбросить масштаб">{Math.round(scale * 100)}%</button>
              <button type="button" className="rounded-full p-2 hover:bg-white/10" onClick={() => setScale((value) => clamp(value + 0.25, 1, 5))} title="Увеличить"><Plus className="h-5 w-5" /></button>
              <button type="button" className="rounded-full p-2 hover:bg-white/10" onClick={reset} title="Сбросить"><RotateCcw className="h-5 w-5" /></button>
            </>
          )}
          <button type="button" className="rounded-full p-2 hover:bg-white/10" onClick={() => void fullscreen()} title="Полный экран"><Maximize2 className="h-5 w-5" /></button>
          <button type="button" className="rounded-full p-2 hover:bg-white/10" onClick={() => setMedia(null)} title="Закрыть"><X className="h-6 w-6" /></button>
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onWheel={(event) => {
          if (media.type !== "image") return;
          event.preventDefault();
          setScale((value) => clamp(value + (event.deltaY < 0 ? 0.2 : -0.2), 1, 5));
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        style={{ touchAction: media.type === "image" ? "none" : "auto" }}
      >
        {media.type === "image" ? (
          <div className="absolute inset-0 flex items-center justify-center p-2 sm:p-6">
            <img
              src={media.src}
              alt={media.title || "Изображение"}
              draggable={false}
              className="max-h-full max-w-full select-none object-contain will-change-transform"
              style={{ transform, transformOrigin: "center center" }}
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-2 sm:p-6">
            <video src={media.src} controls autoPlay playsInline preload="metadata" className="max-h-full max-w-full bg-black object-contain" />
          </div>
        )}
      </div>
    </div>
  );
};

export default MediaViewerHost;

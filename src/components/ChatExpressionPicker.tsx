import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";
import { Smile } from "lucide-react";
import {
  loadRecentStickers,
  loadStickerPacks,
  stickerImageUrl,
  type StickerItem,
  type StickerPack,
} from "@/lib/stickers";

type Props = {
  onEmojiSelect: (emoji: string) => void;
  onStickerSelect: (stickerId: number) => void | Promise<void>;
  disabled?: boolean;
};

type PopupPosition = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const EDGE = 8;
const GAP = 8;
const DESKTOP_WIDTH = 360;
const DESKTOP_HEIGHT = 430;

const getViewport = () => {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
};

const calculatePopupPosition = (trigger: HTMLElement): PopupPosition => {
  const rect = trigger.getBoundingClientRect();
  const viewport = getViewport();
  const width = Math.max(260, Math.min(DESKTOP_WIDTH, viewport.width - EDGE * 2));
  const height = Math.max(300, Math.min(DESKTOP_HEIGHT, viewport.height - EDGE * 2));

  const minLeft = viewport.left + EDGE;
  const maxLeft = viewport.left + viewport.width - width - EDGE;
  const preferredLeft = rect.left + rect.width / 2 - width / 2;
  const left = Math.min(Math.max(preferredLeft, minLeft), Math.max(minLeft, maxLeft));

  const roomAbove = rect.top - viewport.top - GAP - EDGE;
  const roomBelow = viewport.top + viewport.height - rect.bottom - GAP - EDGE;
  let top: number;
  if (roomAbove >= Math.min(height, DESKTOP_HEIGHT) || roomAbove >= roomBelow) {
    top = Math.max(viewport.top + EDGE, rect.top - GAP - height);
  } else {
    top = Math.min(viewport.top + viewport.height - height - EDGE, rect.bottom + GAP);
  }

  return { left, top, width, height };
};

const ChatExpressionPicker = ({ onEmojiSelect, onStickerSelect, disabled = false }: Props) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"emoji" | "stickers">("emoji");
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [recent, setRecent] = useState<StickerItem[]>([]);
  const [activePackId, setActivePackId] = useState<number | "recent">("recent");
  const [stickersLoading, setStickersLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    setPosition(calculatePopupPosition(triggerRef.current));
  }, []);

  const loadStickers = useCallback(async () => {
    setStickersLoading(true);
    try {
      const [loadedPacks, loadedRecent] = await Promise.all([
        loadStickerPacks(),
        loadRecentStickers(),
      ]);
      setPacks(loadedPacks);
      setRecent(loadedRecent);
      if (loadedRecent.length === 0 && loadedPacks[0]) {
        setActivePackId(Number(loadedPacks[0].id));
      }
    } finally {
      setStickersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const update = () => updatePosition();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open || tab !== "stickers") return;
    void loadStickers();
  }, [loadStickers, open, tab]);

  const activeStickers = useMemo(() => {
    if (activePackId === "recent") return recent;
    return packs.find((pack) => Number(pack.id) === Number(activePackId))?.stickers || [];
  }, [activePackId, packs, recent]);

  const handleEmoji = (emojiData: EmojiClickData) => {
    onEmojiSelect(emojiData.emoji);
    setOpen(false);
  };

  const handleSticker = async (stickerId: number) => {
    await onStickerSelect(stickerId);
    setOpen(false);
  };

  const popup = open && position && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={popupRef}
          data-chat-expression-picker="true"
          className="fixed z-[2147483000] flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            height: position.height,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "calc(100dvh - 16px)",
          }}
          role="dialog"
          aria-label="Эмодзи и стикеры"
        >
          <div className="flex shrink-0 gap-1 border-b border-border p-2">
            <button
              type="button"
              onClick={() => setTab("emoji")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${tab === "emoji" ? "bg-primary/15 text-primary" : "hover:bg-accent"}`}
            >
              Эмодзи
            </button>
            <button
              type="button"
              onClick={() => setTab("stickers")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${tab === "stickers" ? "bg-primary/15 text-primary" : "hover:bg-accent"}`}
            >
              Стикеры
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === "emoji" ? (
              <div className="h-full w-full [&_.epr-main]:!h-full [&_.epr-main]:!w-full [&_.epr-main]:!border-0 [&_.epr-main]:!rounded-none">
                <EmojiPicker
                  onEmojiClick={handleEmoji}
                  previewConfig={{ showPreview: false }}
                  skinTonesDisabled
                  width="100%"
                  height="100%"
                  lazyLoadEmojis
                />
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto p-3 overscroll-contain">
                  {stickersLoading ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Загрузка стикеров…</div>
                  ) : activeStickers.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Здесь пока пусто</div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                      {activeStickers.map((sticker) => (
                        <button
                          type="button"
                          key={sticker.id}
                          onClick={() => void handleSticker(Number(sticker.id))}
                          className="aspect-square rounded-xl p-1.5 transition hover:bg-accent active:scale-95"
                          title="Отправить стикер"
                        >
                          <img
                            src={stickerImageUrl(sticker.image_url)}
                            alt="Стикер"
                            className="h-full w-full select-none object-contain"
                            draggable={false}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-border p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <button
                    type="button"
                    onClick={() => setActivePackId("recent")}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${activePackId === "recent" ? "bg-primary/15" : "hover:bg-accent"}`}
                    title="Недавние"
                  >
                    🕘
                  </button>
                  {packs.map((pack) => (
                    <button
                      type="button"
                      key={pack.id}
                      onClick={() => setActivePackId(Number(pack.id))}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg p-1 ${Number(activePackId) === Number(pack.id) ? "bg-primary/15" : "hover:bg-accent"}`}
                      title={pack.name}
                    >
                      {pack.icon_url ? (
                        <img src={stickerImageUrl(pack.icon_url)} alt={pack.name} className="h-full w-full object-contain" draggable={false} />
                      ) : (
                        <span>⭐</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!open) updatePosition();
          setOpen((value) => !value);
        }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-700"
        title="Эмодзи и стикеры"
        aria-label="Эмодзи и стикеры"
        aria-expanded={open}
      >
        <Smile className="h-5 w-5 text-gray-500" />
      </button>
      {popup}
    </>
  );
};

export default ChatExpressionPicker;

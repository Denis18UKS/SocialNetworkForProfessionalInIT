import { useEffect, useMemo, useRef, useState } from "react";
import { loadRecentStickers, loadStickerPacks, stickerImageUrl, type StickerItem, type StickerPack } from "@/lib/stickers";

type Props = {
  onSelect: (stickerId: number) => void | Promise<void>;
  disabled?: boolean;
};

const StickerPicker = ({ onSelect, disabled = false }: Props) => {
  const [open, setOpen] = useState(false);
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [recent, setRecent] = useState<StickerItem[]>([]);
  const [activePackId, setActivePackId] = useState<number | "recent">("recent");
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([loadStickerPacks(), loadRecentStickers()])
      .then(([loadedPacks, loadedRecent]) => {
        setPacks(loadedPacks);
        setRecent(loadedRecent);
        if (loadedRecent.length === 0 && loadedPacks[0]) setActivePackId(Number(loadedPacks[0].id));
      })
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const activeStickers = useMemo(() => {
    if (activePackId === "recent") return recent;
    return packs.find((pack) => Number(pack.id) === Number(activePackId))?.stickers || [];
  }, [activePackId, packs, recent]);

  const handleSelect = async (stickerId: number) => {
    await onSelect(stickerId);
    setOpen(false);
    setRecent(await loadRecentStickers().catch(() => recent));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-lg transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-700"
        title="Стикеры"
        aria-label="Стикеры"
      >
        <span aria-hidden>🪽</span>
      </button>

      {open && (
        <div className="absolute bottom-12 left-0 z-[80] flex h-[360px] w-[min(340px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Загрузка стикеров…</div>
            ) : activeStickers.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Здесь пока пусто</div>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {activeStickers.map((sticker) => (
                  <button
                    type="button"
                    key={sticker.id}
                    onClick={() => void handleSelect(Number(sticker.id))}
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
  );
};

export default StickerPicker;

import { useEffect, useState } from "react";
import { findSticker, stickerImageUrl } from "@/lib/stickers";

const StickerBubble = ({ stickerId }: { stickerId: number }) => {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let active = true;
    void findSticker(stickerId).then((sticker) => {
      if (active && sticker?.image_url) setSrc(stickerImageUrl(sticker.image_url));
    });
    return () => {
      active = false;
    };
  }, [stickerId]);

  if (!src) {
    return <div className="h-24 w-24 animate-pulse rounded-2xl bg-muted/60" aria-label="Загрузка стикера" />;
  }

  return (
    <img
      src={src}
      alt="Стикер"
      className="block h-auto max-h-52 w-auto max-w-[min(220px,60vw)] select-none object-contain"
      draggable={false}
    />
  );
};

export default StickerBubble;

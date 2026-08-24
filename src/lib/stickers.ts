import { apiUrl, assetUrl } from "@/lib/settings";

export type StickerItem = {
  id: number;
  pack_id: number;
  sticker_key: string;
  image_url: string;
  sort_order?: number;
};

export type StickerPack = {
  id: number;
  slug: string;
  name: string;
  icon_url?: string | null;
  sort_order?: number;
  stickers: StickerItem[];
};

let catalogPromise: Promise<StickerPack[]> | null = null;
let catalogCache: StickerPack[] = [];

const tokenHeaders = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const loadStickerPacks = async (force = false) => {
  if (!force && catalogCache.length > 0) return catalogCache;
  if (!force && catalogPromise) return catalogPromise;
  catalogPromise = fetch(apiUrl("/stickers/packs"), { headers: tokenHeaders() })
    .then(async (response) => {
      if (!response.ok) throw new Error("Не удалось загрузить стикеры");
      const data = await response.json();
      catalogCache = Array.isArray(data?.packs) ? data.packs : [];
      return catalogCache;
    })
    .finally(() => {
      catalogPromise = null;
    });
  return catalogPromise;
};

export const findSticker = async (stickerId: number) => {
  const packs = await loadStickerPacks();
  for (const pack of packs) {
    const sticker = pack.stickers.find((item) => Number(item.id) === Number(stickerId));
    if (sticker) return sticker;
  }
  return null;
};

export const stickerImageUrl = (path?: string | null) => assetUrl(path || "");

export const loadRecentStickers = async () => {
  const response = await fetch(apiUrl("/stickers/recent"), { headers: tokenHeaders() });
  if (!response.ok) return [] as StickerItem[];
  const data = await response.json();
  return Array.isArray(data?.stickers) ? data.stickers : [];
};

export const sendSticker = async (scope: "personal" | "group", chatId: number, stickerId: number) => {
  const response = await fetch(apiUrl("/stickers/send"), {
    method: "POST",
    headers: {
      ...tokenHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scope, chatId, stickerId }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "Не удалось отправить стикер");
  return data;
};

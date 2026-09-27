export const getCPartyEmbedUrl = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&rel=0` : "";
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      let id = url.searchParams.get("v") || "";
      const parts = url.pathname.split("/").filter(Boolean);
      if (!id && ["shorts", "embed", "live"].includes(parts[0] || "")) id = parts[1] || "";
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&rel=0` : "";
    }

    if (host === "drive.google.com") {
      const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/i);
      const id = fileMatch?.[1] || url.searchParams.get("id") || "";
      return id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview` : "";
    }

    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const id = url.pathname.split("/").filter(Boolean).find((part) => /^\d+$/.test(part));
      return id ? `https://player.vimeo.com/video/${id}` : "";
    }

    if (host === "rutube.ru") {
      const parts = url.pathname.split("/").filter(Boolean);
      const videoIndex = parts.findIndex((part) => part === "video");
      const id = videoIndex >= 0 ? parts[videoIndex + 1] : parts.at(-1);
      return id ? `https://rutube.ru/play/embed/${encodeURIComponent(id)}` : "";
    }
  } catch {
    return "";
  }

  return "";
};

export const isHttpMediaUrl = (value?: string | null) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

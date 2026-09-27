import { useState } from "react";
import { Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl } from "@/lib/settings";

export default function CPartyLinkControls({
  roomId,
  invite,
  isOwner,
  onChanged,
}: {
  roomId: string;
  invite: string;
  isOwner: boolean;
  onChanged?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  if (!isOwner) return null;

  const apply = async () => {
    const value = url.trim();
    if (!value) return;
    setBusy(true);
    try {
      const token = localStorage.getItem("token") || "";
      const response = await fetch(apiUrl(`/cinema/rooms/${roomId}/link-v3`), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: value, invite }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "Не удалось применить ссылку");
      setUrl("");
      onChanged?.();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось применить ссылку");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="YouTube / Google Drive / Vimeo / Rutube / прямая ссылка"
          className="min-w-0"
        />
      </div>
      <Button type="button" variant="outline" disabled={busy || !url.trim()} onClick={() => void apply()}>
        {busy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
        Поставить видео по ссылке
      </Button>
      <div className="text-xs text-muted-foreground sm:max-w-64">
        Ссылка хранится в комнате как URL: SocialBIRD не скачивает такой файл на VPS.
      </div>
    </div>
  );
}

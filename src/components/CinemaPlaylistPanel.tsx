import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { ListVideo, Play, Plus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadCinemaVideo } from "@/lib/cinema-upload";

const api = "http://localhost:5000";

export type CinemaPlaylistSourcePatch = {
  source_type: "library" | "upload";
  title_id?: number | null;
  episode_id?: number | null;
  media_url?: string | null;
  current_playlist_item_id?: number | null;
  playback_position?: number;
  effective_position?: number;
  playback_state?: "playing" | "paused";
};

type PlaylistItem = {
  id: number;
  room_id: number;
  sort_order: number;
  source_type: "library" | "upload";
  title_id?: number | null;
  episode_id?: number | null;
  media_url?: string | null;
  display_title: string;
  created_at?: string;
};

type LibraryTitle = {
  id: number;
  title: string;
  content_type?: string;
};

type Episode = {
  id: number;
  season_number: number;
  episode_number: number;
  episode_title?: string;
};

type Props = {
  roomId: string;
  invite?: string;
  isOwner: boolean;
  currentItemId?: number | null;
  onSourceChanged: (patch: CinemaPlaylistSourcePatch) => void;
};

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token") || ""}` });

const CinemaPlaylistPanel = ({ roomId, invite = "", isOwner, currentItemId, onSourceChanged }: Props) => {
  const [open, setOpen] = useState(false);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [library, setLibrary] = useState<LibraryTitle[]>([]);
  const [selectedTitleId, setSelectedTitleId] = useState(0);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(0);
  const [mode, setMode] = useState<"library" | "upload">("library");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [error, setError] = useState("");

  const query = useMemo(() => invite ? `?invite=${encodeURIComponent(invite)}` : "", [invite]);

  const loadPlaylist = async () => {
    const response = await fetch(`${api}/cinema/rooms/${roomId}/playlist${query}`, { headers: authHeaders() });
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(data?.message || "Не удалось загрузить плейлист");
    setPlaylist(Array.isArray(data) ? data : []);
    return Array.isArray(data) ? data as PlaylistItem[] : [];
  };

  const loadLibrary = async () => {
    if (!isOwner || library.length) return;
    const response = await fetch(`${api}/cinema/library`, { headers: authHeaders() });
    if (!response.ok) return;
    const data = await response.json().catch(() => []);
    setLibrary(Array.isArray(data) ? data : []);
  };

  const initializePlaylist = async () => {
    const response = await fetch(`${api}/cinema/rooms/${roomId}/playlist/initialize`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ invite }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || "Не удалось создать плейлист");
    return data;
  };

  const openPanel = async () => {
    setOpen(true);
    setError("");
    try {
      let items = await loadPlaylist();
      if (isOwner && items.length === 0) {
        await initializePlaylist();
        items = await loadPlaylist();
      }
      void loadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть плейлист");
    }
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => { void loadPlaylist().catch(() => undefined); }, 2500);
    const refresh = () => { void loadPlaylist().catch(() => undefined); };
    window.addEventListener("itbird-cinema-playlist-changed", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("itbird-cinema-playlist-changed", refresh);
    };
  }, [open, roomId, query]);

  useEffect(() => {
    if (!selectedTitleId) {
      setEpisodes([]);
      setSelectedEpisodeId(0);
      return;
    }
    let cancelled = false;
    fetch(`${api}/cinema/library/${selectedTitleId}`, { headers: authHeaders() })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (cancelled) return;
        setEpisodes(Array.isArray(data?.episodes) ? data.episodes : []);
        setSelectedEpisodeId(0);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [selectedTitleId]);

  const addItem = async (body: Record<string, unknown>) => {
    const response = await fetch(`${api}/cinema/rooms/${roomId}/playlist`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, invite }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || "Не удалось добавить видео");
    window.dispatchEvent(new CustomEvent("itbird-cinema-playlist-changed", { detail: { roomId: Number(roomId) } }));
    await loadPlaylist();
  };

  const addLibraryItem = async () => {
    if (!selectedTitleId || busy) return;
    setBusy(true);
    setError("");
    try {
      await addItem({ sourceType: "library", titleId: selectedTitleId, episodeId: selectedEpisodeId || null });
      setSelectedTitleId(0);
      setSelectedEpisodeId(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить видео");
    } finally {
      setBusy(false);
    }
  };

  const addUploadedFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("video/") || /\.(mp4|webm|ogg|ogv|mov|mkv|avi|m4v|mpeg|mpg|3gp|m2ts|wmv|flv)$/i.test(file.name));
    event.target.value = "";
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadLabel(files.length > 1 ? `${file.name} (${index + 1}/${files.length})` : file.name);
        setUploadProgress(0);
        const uploaded = await uploadCinemaVideo({ file, onProgress: setUploadProgress });
        await addItem({ sourceType: "upload", mediaUrl: uploaded.mediaUrl, displayTitle: file.name });
      }
      setUploadProgress(0);
      setUploadLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить видео");
    } finally {
      setBusy(false);
    }
  };

  const playItem = async (itemId: number) => {
    if (!isOwner || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${api}/cinema/rooms/${roomId}/playlist/${itemId}/play`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ invite }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "Не удалось включить видео");
      onSourceChanged(data.room || data);
      window.dispatchEvent(new CustomEvent("itbird-cinema-playlist-changed", { detail: { roomId: Number(roomId) } }));
      await loadPlaylist();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось включить видео");
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (itemId: number) => {
    if (!isOwner || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${api}/cinema/rooms/${roomId}/playlist/${itemId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "Не удалось удалить видео");
      await loadPlaylist();
      window.dispatchEvent(new CustomEvent("itbird-cinema-playlist-changed", { detail: { roomId: Number(roomId) } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить видео");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void openPanel()}>
        <ListVideo className="mr-2 h-4 w-4" />
        {playlist.length > 0 ? `Плейлист (${playlist.length})` : isOwner ? "Создать плейлист" : "Плейлист"}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-3" onClick={() => !busy && setOpen(false)}>
          <div className="max-h-[88dvh] w-full max-w-2xl overflow-hidden rounded-xl border bg-background shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div>
                <div className="font-semibold">Плейлист C-Party</div>
                <div className="text-xs text-muted-foreground">Видео идут по очереди. После окончания текущего автоматически включается следующее.</div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => !busy && setOpen(false)}><X className="h-4 w-4" /></Button>
            </div>

            <div className="max-h-[calc(88dvh-72px)] space-y-4 overflow-y-auto p-4">
              {isOwner && (
                <div className="rounded-lg border p-3">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant={mode === "library" ? "default" : "outline"} onClick={() => setMode("library")}>Из библиотеки</Button>
                    <Button type="button" size="sm" variant={mode === "upload" ? "default" : "outline"} onClick={() => setMode("upload")}>Своё видео</Button>
                  </div>

                  {mode === "library" ? (
                    <div className="space-y-2">
                      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={selectedTitleId} onChange={(event) => setSelectedTitleId(Number(event.target.value))} disabled={busy}>
                        <option value={0}>Выберите фильм или сериал</option>
                        {library.map((title) => <option key={title.id} value={title.id}>{title.title}</option>)}
                      </select>
                      {episodes.length > 0 && (
                        <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={selectedEpisodeId} onChange={(event) => setSelectedEpisodeId(Number(event.target.value))} disabled={busy}>
                          <option value={0}>Фильм / основное видео</option>
                          {episodes.map((episode) => <option key={episode.id} value={episode.id}>S{episode.season_number} E{episode.episode_number}{episode.episode_title ? ` · ${episode.episode_title}` : ""}</option>)}
                        </select>
                      )}
                      <Button type="button" onClick={() => void addLibraryItem()} disabled={!selectedTitleId || busy}><Plus className="mr-2 h-4 w-4" />Добавить видео</Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed p-4 text-sm hover:bg-muted/50">
                        <Upload className="mr-2 h-4 w-4" />Выбрать одно или несколько видео
                        <input type="file" accept="video/*,.mkv,.avi,.mov,.m4v,.mpeg,.mpg,.m2ts,.wmv,.flv" multiple className="hidden" onChange={(event) => void addUploadedFiles(event)} disabled={busy} />
                      </label>
                      {busy && uploadLabel && <div className="text-xs text-muted-foreground">Загрузка: {uploadLabel} · {uploadProgress}%</div>}
                    </div>
                  )}
                </div>
              )}

              {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

              <div className="space-y-2">
                {playlist.map((item, index) => {
                  const current = Number(currentItemId) === Number(item.id);
                  return (
                    <div key={item.id} className={`flex items-center gap-3 rounded-lg border p-3 ${current ? "border-primary bg-primary/5" : ""}`}>
                      <div className="w-7 shrink-0 text-center text-xs text-muted-foreground">{index + 1}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{item.display_title || `Видео ${index + 1}`}</div>
                        <div className="text-xs text-muted-foreground">{current ? "Сейчас воспроизводится" : item.source_type === "upload" ? "Загруженное видео" : "Библиотека"}</div>
                      </div>
                      {isOwner && !current && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void playItem(item.id)}><Play className="mr-1 h-3.5 w-3.5" />Включить</Button>}
                      {isOwner && !current && <Button type="button" size="icon" variant="ghost" disabled={busy} onClick={() => void removeItem(item.id)} title="Удалить из плейлиста"><Trash2 className="h-4 w-4 text-red-500" /></Button>}
                    </div>
                  );
                })}
                {!playlist.length && <div className="py-8 text-center text-sm text-muted-foreground">Плейлист пока пуст.</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CinemaPlaylistPanel;

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { Clapperboard, Film, LockKeyhole, Play, Plus, Search, Upload, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { uploadCinemaVideo } from "@/lib/cinema-upload";

type LibraryTitle = {
  id: number;
  title: string;
  description?: string;
  poster_url?: string;
  content_type: "movie" | "series";
  genres?: string;
  release_year?: number;
  release_end_year?: number;
  duration_minutes?: number;
};

type Room = {
  id: number;
  owner_id: number;
  room_name: string;
  visibility: "public" | "private";
  chat_enabled: number | boolean;
  owner_username?: string;
  library_title?: string;
  poster_url?: string;
  playback_state?: string;
};

const api = "http://localhost:5000";

const CinemaParty = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem("token") || "";
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState<"rooms" | "library" | "mine" | "create">("rooms");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [mine, setMine] = useState<Room[]>([]);
  const [library, setLibrary] = useState<LibraryTitle[]>([]);
  const [query, setQuery] = useState("");
  const [roomName, setRoomName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [chatEnabled, setChatEnabled] = useState(true);
  const [sourceType, setSourceType] = useState<"library" | "upload">("library");
  const [titleId, setTitleId] = useState<number | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const refreshKey = Date.now();
    const [roomsResponse, mineResponse, libraryResponse] = await Promise.all([
      fetch(`${api}/cinema/rooms?_=${refreshKey}`, { headers, cache: "no-store" }),
      fetch(`${api}/cinema/rooms?mine=1&_=${refreshKey}`, { headers, cache: "no-store" }),
      fetch(`${api}/cinema/library?_=${refreshKey}`, { headers, cache: "no-store" }),
    ]);
    if (roomsResponse.ok) setRooms(await roomsResponse.json());
    if (mineResponse.ok) setMine(await mineResponse.json());
    if (libraryResponse.ok) setLibrary(await libraryResponse.json());
  };

  useEffect(() => { void load(); }, []);

  // SOCIALBIRD_CPARTY_PUBLIC_ROOMS_V1: live-refresh
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    const timer = window.setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("itbird-cinema-room-changed", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("itbird-cinema-room-changed", refresh);
    };
  }, []);

  const filteredLibrary = useMemo(() => library.filter((item) => !query || `${item.title} ${item.genres || ""}`.toLowerCase().includes(query.toLowerCase())), [library, query]);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setUploadProgress(1);
    try {
      const result = await uploadCinemaVideo({ file, onProgress: setUploadProgress });
      setMediaUrl(result.mediaUrl);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось загрузить видео");
      setUploadProgress(0);
    } finally {
      setBusy(false);
    }
  };

  const createRoom = async () => {
    if (!roomName.trim()) return window.alert("Введите название комнаты");
    if (sourceType === "library" && !titleId) return window.alert("Выберите фильм или сериал из библиотеки");
    if (sourceType === "upload" && !mediaUrl) return window.alert("Сначала загрузите видео");
    setBusy(true);
    try {
      const response = await fetch(`${api}/cinema/rooms`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ roomName: roomName.trim(), visibility, chatEnabled, sourceType, titleId, mediaUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "Не удалось создать комнату");
      window.dispatchEvent(new CustomEvent("itbird-cinema-room-changed", { detail: { roomId: data.id, visibility } }));
      navigate(`/c-party/room/${data.id}?invite=${data.inviteToken}`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось создать комнату");
    } finally {
      setBusy(false);
    }
  };

  const roomCard = (room: Room) => (
    <Card key={room.id} className="overflow-hidden">
      <CardContent className="flex min-w-0 items-center gap-3 p-3">
        <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/90">
          {room.poster_url ? <img src={room.poster_url} alt="" className="h-full w-full object-cover" /> : <Clapperboard className="h-7 w-7 text-white/70" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><div className="truncate font-semibold">{room.room_name}</div>{room.visibility === "private" && <LockKeyhole className="h-3.5 w-3.5" />}</div>
          <div className="truncate text-xs text-muted-foreground">{room.library_title || "Своё видео"} · {room.owner_username || "Создатель"}</div>
          <div className="mt-1 text-xs text-muted-foreground">Чат: {room.chat_enabled ? "включён" : "выключен"}</div>
        </div>
        <Button size="sm" onClick={() => navigate(`/c-party/room/${room.id}`)}><Play className="mr-1 h-4 w-4" />Войти</Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Clapperboard className="h-6 w-6" />C-Party</h1>
          <p className="text-sm text-muted-foreground">CinemaParty — совместный просмотр фильмов, сериалов и собственных видео с синхронизированным плеером.</p>
        </div>
        <Button onClick={() => setTab("create")} className="gap-2"><Plus className="h-4 w-4" />Создать комнату</Button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Button variant={tab === "rooms" ? "default" : "outline"} onClick={() => { setTab("rooms"); void load(); }} className="shrink-0 gap-2"><Users className="h-4 w-4" />Публичные комнаты</Button>
        <Button variant={tab === "library" ? "default" : "outline"} onClick={() => setTab("library")} className="shrink-0 gap-2"><Film className="h-4 w-4" />Библиотека</Button>
        <Button variant={tab === "mine" ? "default" : "outline"} onClick={() => { setTab("mine"); void load(); }} className="shrink-0">Мои комнаты</Button>
        <Button variant={tab === "create" ? "default" : "outline"} onClick={() => setTab("create")} className="shrink-0">Создать</Button>
      </div>

      {tab === "rooms" && <div className="grid gap-3 lg:grid-cols-2">{rooms.length ? rooms.map(roomCard) : <Card><CardContent className="p-6 text-sm text-muted-foreground">Сейчас нет публичных комнат. Создайте первую.</CardContent></Card>}</div>}
      {tab === "mine" && <div className="grid gap-3 lg:grid-cols-2">{mine.length ? mine.map(roomCard) : <Card><CardContent className="p-6 text-sm text-muted-foreground">У вас пока нет активных комнат.</CardContent></Card>}</div>}

      {tab === "library" && (
        <div className="space-y-4">
          <div className="relative max-w-xl"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск фильма, сериала или жанра…" className="pl-9" /></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredLibrary.map((item) => (
              <Card key={item.id} className="overflow-hidden cursor-pointer" onClick={() => navigate(`/c-party/title/${item.id}`)}>
                <div className="aspect-[16/9] bg-muted">{item.poster_url ? <img src={item.poster_url} alt={item.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><Film className="h-10 w-10 text-muted-foreground" /></div>}</div>
                <CardContent className="space-y-1 p-4">
                  <div className="font-semibold">{item.title}</div>
                  <div className="line-clamp-2 text-sm text-muted-foreground">{item.description || "Описание пока не добавлено"}</div>
                  <div className="text-xs text-muted-foreground">{item.genres || "Жанр не указан"} · {item.release_year || "—"}{item.release_end_year ? `–${item.release_end_year}` : ""}</div>
                </CardContent>
              </Card>
            ))}
            {!filteredLibrary.length && <Card><CardContent className="p-6 text-sm text-muted-foreground">Библиотека пока пуста. Она предназначена для собственного или разрешённого медиаконтента.</CardContent></Card>}
          </div>
        </div>
      )}

      {tab === "create" && (
        <Card>
          <CardHeader><CardTitle>Новая видеокомната</CardTitle></CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <Input value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Название комнаты" />
              <div className="grid grid-cols-2 gap-2"><Button variant={visibility === "public" ? "default" : "outline"} onClick={() => setVisibility("public")}>Публичная</Button><Button variant={visibility === "private" ? "default" : "outline"} onClick={() => setVisibility("private")}><LockKeyhole className="mr-2 h-4 w-4" />Приватная</Button></div>
              <label className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={chatEnabled} onChange={(event) => setChatEnabled(event.target.checked)} />Включить чат комнаты</label>
              <div className="grid grid-cols-2 gap-2"><Button variant={sourceType === "library" ? "default" : "outline"} onClick={() => setSourceType("library")}>Из библиотеки</Button><Button variant={sourceType === "upload" ? "default" : "outline"} onClick={() => setSourceType("upload")}><Upload className="mr-2 h-4 w-4" />Своё видео</Button></div>
            </div>
            <div className="space-y-3">
              {sourceType === "library" ? (
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-2">{library.map((item) => <button type="button" key={item.id} onClick={() => setTitleId(item.id)} className={`flex w-full items-center gap-2 rounded-lg p-2 text-left ${titleId === item.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><Film className="h-4 w-4 shrink-0" /><span className="truncate text-sm">{item.title}</span></button>)}</div>
              ) : (
                <div className="space-y-3 rounded-lg border p-4">
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm hover:bg-muted"><Upload className="h-5 w-5" />Выбрать видео без сжатия<input type="file" accept="video/*,.mkv,.mov,.avi" className="hidden" onChange={handleUpload} /></label>
                  {uploadProgress > 0 && <div className="text-sm">Загрузка оригинала: {uploadProgress}%</div>}
                  {mediaUrl && <div className="text-sm text-emerald-600">Видео загружено без перекодирования.</div>}
                </div>
              )}
              <Button className="w-full" disabled={busy} onClick={createRoom}>{busy ? "Подготовка…" : "Создать комнату"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CinemaParty;

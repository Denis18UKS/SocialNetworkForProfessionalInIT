import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Maximize2, MessageCircle, Pause, Play, QrCode, Send, Square, Users } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Room = {
  id: number;
  owner_id: number;
  room_name: string;
  visibility: "public" | "private";
  invite_token?: string;
  chat_enabled: number | boolean;
  title_id?: number | null;
  episode_id?: number | null;
  playback_position: number;
  effective_position: number;
  playback_state: "playing" | "paused";
  library_title?: string;
  owner_username?: string;
  is_owner: boolean;
};

type Message = { id: number; user_id: number; username?: string; avatar?: string; message: string; created_at: string };
type Episode = { id: number; season_number: number; episode_number: number; episode_title?: string };

const api = "http://localhost:5000";

const CinemaPartyRoom = () => {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const inviteFromUrl = searchParams.get("invite") || "";
  const token = localStorage.getItem("token") || "";
  const headers = { Authorization: `Bearer ${token}` };
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const applyingRemoteRef = useRef(false);
  const lastMessageRef = useRef(0);
  const [room, setRoom] = useState<Room | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [qrUrl, setQrUrl] = useState("");

  const invite = room?.invite_token || inviteFromUrl;
  const roomUrl = useMemo(() => `${window.location.origin}/c-party/room/${roomId}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`, [roomId, invite]);
  const streamUrl = useMemo(() => `${api}/cinema/stream/${roomId}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`, [roomId, invite]);

  const loadRoom = async () => {
    const response = await fetch(`${api}/cinema/rooms/${roomId}${inviteFromUrl ? `?invite=${encodeURIComponent(inviteFromUrl)}` : ""}`, { headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || "Не удалось открыть комнату");
    setRoom(data);
    return data as Room;
  };

  useEffect(() => {
    let cancelled = false;
    loadRoom().then(async (data) => {
      if (cancelled) return;
      if (data.title_id) {
        const response = await fetch(`${api}/cinema/library/${data.title_id}`, { headers });
        if (response.ok && !cancelled) {
          const title = await response.json();
          setEpisodes(Array.isArray(title.episodes) ? title.episodes : []);
        }
      }
    }).catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Не удалось открыть комнату"));
    return () => { cancelled = true; };
  }, [roomId, inviteFromUrl]);

  useEffect(() => {
    if (!room || room.is_owner) return;
    const sync = async () => {
      try {
        const response = await fetch(`${api}/cinema/rooms/${roomId}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`, { headers });
        if (!response.ok) return;
        const latest: Room = await response.json();
        setRoom((current) => current ? { ...current, ...latest } : latest);
        const video = videoRef.current;
        if (!video) return;
        const target = Math.max(0, Number(latest.effective_position || 0));
        applyingRemoteRef.current = true;
        if (Math.abs(video.currentTime - target) > 1.25) video.currentTime = target;
        if (latest.playback_state === "playing" && video.paused) await video.play().catch(() => undefined);
        if (latest.playback_state === "paused" && !video.paused) video.pause();
        window.setTimeout(() => { applyingRemoteRef.current = false; }, 80);
      } catch {}
    };
    void sync();
    const timer = window.setInterval(() => { void sync(); }, 1000);
    return () => window.clearInterval(timer);
  }, [room?.is_owner, roomId, invite]);

  useEffect(() => {
    if (!room?.chat_enabled) return;
    const loadMessages = async () => {
      try {
        const url = `${api}/cinema/rooms/${roomId}/messages?after=${lastMessageRef.current}${invite ? `&invite=${encodeURIComponent(invite)}` : ""}`;
        const response = await fetch(url, { headers });
        if (!response.ok) return;
        const next: Message[] = await response.json();
        if (!Array.isArray(next) || !next.length) return;
        lastMessageRef.current = Math.max(lastMessageRef.current, ...next.map((item) => Number(item.id)));
        setMessages((current) => [...current, ...next.filter((item) => !current.some((existing) => existing.id === item.id))]);
      } catch {}
    };
    void loadMessages();
    const timer = window.setInterval(() => { void loadMessages(); }, 1300);
    return () => window.clearInterval(timer);
  }, [room?.chat_enabled, roomId, invite]);

  useEffect(() => {
    if (!room?.is_owner) return;
    let objectUrl = "";
    fetch(`${api}/cinema/rooms/${roomId}/qr.svg`, { headers })
      .then((response) => response.ok ? response.blob() : null)
      .then((blob) => {
        if (!blob) return;
        objectUrl = URL.createObjectURL(blob);
        setQrUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [room?.is_owner, roomId]);

  const updateState = async (state: "playing" | "paused", episodeId?: number) => {
    if (!room?.is_owner || applyingRemoteRef.current) return;
    const video = videoRef.current;
    await fetch(`${api}/cinema/rooms/${roomId}/state`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ position: video?.currentTime || 0, state, episodeId }),
    }).catch(() => undefined);
  };

  const selectEpisode = async (episodeId: number) => {
    if (!room?.is_owner) return;
    const video = videoRef.current;
    if (video) video.pause();
    await updateState("paused", episodeId);
    setRoom((current) => current ? { ...current, episode_id: episodeId, playback_state: "paused", playback_position: 0, effective_position: 0 } : current);
    if (video) {
      video.src = `${api}/cinema/stream/${roomId}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}&t=${Date.now()}`;
      video.currentTime = 0;
      video.load();
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    const response = await fetch(`${api}/cinema/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim(), invite }),
    });
    if (!response.ok) return;
    const sent = await response.json();
    lastMessageRef.current = Math.max(lastMessageRef.current, Number(sent.id || 0));
    setMessages((current) => [...current, sent]);
    setMessage("");
  };

  const endRoom = async () => {
    if (!room?.is_owner || !window.confirm("Завершить сеанс C-Party для всех?")) return;
    const response = await fetch(`${api}/cinema/rooms/${roomId}`, { method: "DELETE", headers });
    if (response.ok) navigate("/c-party");
  };

  const openFullscreen = async () => {
    try { await videoRef.current?.requestFullscreen?.(); } catch {}
  };

  if (error) return <div className="mx-auto max-w-xl rounded-xl border p-6 text-center"><div className="font-semibold">{error}</div><Button className="mt-4" onClick={() => navigate("/c-party")}>Вернуться в C-Party</Button></div>;
  if (!room) return <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">Подключаемся к видеокомнате…</div>;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><h1 className="truncate text-xl font-bold">{room.room_name}</h1><div className="text-xs text-muted-foreground">Создатель: {room.owner_username || "—"} · {room.visibility === "private" ? "Приватная" : "Публичная"} комната</div></div>
        <div className="flex flex-wrap gap-2">
          {room.is_owner && <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(roomUrl)}><Copy className="mr-2 h-4 w-4" />Ссылка</Button>}
          {room.is_owner && <Button variant="destructive" size="sm" onClick={endRoom}><Square className="mr-2 h-4 w-4" />Завершить</Button>}
        </div>
      </div>

      <div className={`grid min-h-0 gap-3 ${room.chat_enabled ? "xl:grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-1"}`}>
        <Card className="min-w-0 overflow-hidden bg-black text-white">
          <CardContent className="p-0">
            <div className="relative bg-black">
              <video
                ref={videoRef}
                src={streamUrl}
                controls={room.is_owner}
                playsInline
                preload="metadata"
                className="mx-auto max-h-[74dvh] min-h-[240px] w-full bg-black object-contain"
                onPlay={() => void updateState("playing")}
                onPause={() => void updateState("paused")}
                onSeeked={() => void updateState(videoRef.current?.paused ? "paused" : "playing")}
              />
              <button type="button" onClick={openFullscreen} className="absolute bottom-3 right-3 rounded-lg bg-black/70 p-2 text-white hover:bg-black/90" title="На весь экран"><Maximize2 className="h-5 w-5" /></button>
              {!room.is_owner && <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/70 px-2.5 py-1 text-xs">Плеером управляет создатель комнаты</div>}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 p-3 text-xs text-white/70">
              {room.is_owner ? <><Play className="h-3.5 w-3.5" />Play / Pause / перемотка синхронизируются у всех участников</> : <><Users className="h-3.5 w-3.5" />Позиция автоматически синхронизируется с создателем</>}
            </div>
          </CardContent>
        </Card>

        {room.chat_enabled && (
          <Card className="flex max-h-[78dvh] min-h-[420px] flex-col overflow-hidden">
            <CardHeader className="shrink-0 border-b py-3"><CardTitle className="flex items-center gap-2 text-base"><MessageCircle className="h-4 w-4" />Чат комнаты</CardTitle></CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {messages.map((item) => <div key={item.id} className="rounded-lg bg-muted p-2 text-sm"><div className="text-xs font-medium text-primary">{item.username || "Пользователь"}</div><div className="break-words">{item.message}</div><div className="mt-1 text-[10px] text-muted-foreground">{new Date(item.created_at).toLocaleTimeString()}</div></div>)}
                {!messages.length && <div className="py-8 text-center text-xs text-muted-foreground">Сообщений пока нет.</div>}
              </div>
              <form onSubmit={sendMessage} className="flex shrink-0 gap-2 border-t p-2"><Input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Сообщение…" /><Button size="icon" type="submit"><Send className="h-4 w-4" /></Button></form>
            </CardContent>
          </Card>
        )}
      </div>

      {room.is_owner && (qrUrl || episodes.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {qrUrl && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><QrCode className="h-4 w-4" />Приглашение по QR-коду</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center gap-4"><img src={qrUrl} alt="QR приглашения" className="h-44 w-44 rounded-lg bg-white p-2" /><div className="min-w-0 flex-1 text-sm text-muted-foreground">QR генерируется прямо на сервере SocialBIRD. Для приватной комнаты он содержит секретную invite-ссылку.</div></CardContent></Card>}
          {episodes.length > 0 && <Card><CardHeader><CardTitle className="text-base">Сезоны и серии</CardTitle></CardHeader><CardContent className="max-h-56 space-y-2 overflow-y-auto">{episodes.map((episode) => <Button key={episode.id} variant={Number(room.episode_id) === episode.id ? "default" : "outline"} size="sm" className="mr-2" onClick={() => selectEpisode(episode.id)}>S{episode.season_number} E{episode.episode_number}{episode.episode_title ? ` · ${episode.episode_title}` : ""}</Button>)}</CardContent></Card>}
        </div>
      )}
    </div>
  );
};

export default CinemaPartyRoom;

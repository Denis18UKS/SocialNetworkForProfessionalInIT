import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Maximize2, MessageCircle, Pause, Play, QrCode, Send, Square, Users, Volume2, VolumeX } from "lucide-react";
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
const CPARTY_VOLUME_KEY = "socialbird:cparty-volume";

const readSavedVolume = () => {
  try {
    const value = Number(localStorage.getItem(CPARTY_VOLUME_KEY));
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  } catch {
    return 1;
  }
};

const CinemaPartyRoom = () => {
  const { roomId = "" } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const inviteFromUrl = searchParams.get("invite") || "";
  const token = localStorage.getItem("token") || "";
  const headers = { Authorization: `Bearer ${token}` };
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ownerAudioRef = useRef<HTMLAudioElement | null>(null);
  const applyingRemoteRef = useRef(false);
  const lastMessageRef = useRef(0);
  const initialVolumeRef = useRef(readSavedVolume());
  const lastAudibleVolumeRef = useRef(initialVolumeRef.current > 0.001 ? initialVolumeRef.current : 1);
  const [room, setRoom] = useState<Room | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [ownerAudioMuted, setOwnerAudioMuted] = useState(false);
  const [playerVolume, setPlayerVolume] = useState(initialVolumeRef.current);

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

  const syncOwnerAudio = () => {
    if (!room?.is_owner) return null;
    const video = videoRef.current;
    const audio = ownerAudioRef.current;
    if (!video || !audio) return null;

    const desiredSrc = video.currentSrc || video.src || streamUrl;
    if (desiredSrc && audio.src !== desiredSrc) {
      audio.src = desiredSrc;
      audio.load();
    }

    audio.volume = playerVolume;
    audio.muted = playerVolume <= 0.001;
    if (Number.isFinite(video.currentTime)) {
      try { audio.currentTime = video.currentTime; } catch {}
    }
    return audio;
  };

  // SOCIALBIRD_CPARTY_OWNER_AUDIO_V2: dedicated-audio-channel
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!room?.is_owner) {
      video.muted = playerVolume <= 0.001;
      video.volume = playerVolume;
      setOwnerAudioMuted(false);
      return;
    }

    // The owner hears the dedicated audio element. Keep video itself muted to avoid double audio.
    video.defaultMuted = true;
    video.muted = true;
    const audio = syncOwnerAudio();
    if (!audio) return;

    const syncPosition = () => {
      if (!Number.isFinite(video.currentTime)) return;
      if (Math.abs(audio.currentTime - video.currentTime) > 0.35) {
        try { audio.currentTime = video.currentTime; } catch {}
      }
    };
    const reflectAudio = () => {
      const intentionallyMuted = playerVolume <= 0.001;
      setOwnerAudioMuted(!intentionallyMuted && (audio.muted || audio.paused));
    };

    syncPosition();
    reflectAudio();
    audio.addEventListener("playing", reflectAudio);
    audio.addEventListener("pause", reflectAudio);
    audio.addEventListener("volumechange", reflectAudio);
    audio.addEventListener("loadedmetadata", syncPosition);
    const timer = window.setInterval(() => {
      if (!video.paused && !audio.paused) syncPosition();
    }, 500);

    return () => {
      window.clearInterval(timer);
      audio.pause();
      audio.removeEventListener("playing", reflectAudio);
      audio.removeEventListener("pause", reflectAudio);
      audio.removeEventListener("volumechange", reflectAudio);
      audio.removeEventListener("loadedmetadata", syncPosition);
    };
  }, [room?.is_owner, streamUrl]);

  // SOCIALBIRD_CPARTY_VOLUME_V1: pc-slider
  useEffect(() => {
    const normalized = Math.min(1, Math.max(0, playerVolume));
    try { localStorage.setItem(CPARTY_VOLUME_KEY, String(normalized)); } catch {}
    if (normalized > 0.001) lastAudibleVolumeRef.current = normalized;

    const video = videoRef.current;
    if (video) {
      if (room?.is_owner) {
        video.defaultMuted = true;
        video.muted = true;
      } else {
        video.volume = normalized;
        video.muted = normalized <= 0.001;
      }
    }

    const audio = ownerAudioRef.current;
    if (room?.is_owner && audio) {
      audio.volume = normalized;
      audio.muted = normalized <= 0.001;
      if (normalized <= 0.001) {
        setOwnerAudioMuted(false);
      } else if (video && !video.paused && audio.paused) {
        void audio.play().then(() => setOwnerAudioMuted(false)).catch(() => setOwnerAudioMuted(true));
      }
    }
  }, [playerVolume, room?.is_owner]);

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

  const enableOwnerAudio = async () => {
    if (!room?.is_owner) return;
    if (playerVolume <= 0.001) setPlayerVolume(lastAudibleVolumeRef.current || 1);
    const audio = syncOwnerAudio();
    if (!audio) return;
    audio.muted = false;
    audio.volume = Math.max(playerVolume, lastAudibleVolumeRef.current || 1);
    try {
      await audio.play();
      setOwnerAudioMuted(false);
    } catch {
      setOwnerAudioMuted(true);
    }
  };

  const handleOwnerPlay = () => {
    if (room?.is_owner) {
      const audio = syncOwnerAudio();
      if (audio && playerVolume > 0.001) {
        void audio.play().then(() => setOwnerAudioMuted(false)).catch(() => setOwnerAudioMuted(true));
      }
    }
    void updateState("playing");
  };

  const handleVideoPause = () => {
    if (room?.is_owner) ownerAudioRef.current?.pause();
    void updateState("paused");
  };

  const handleVideoSeeked = () => {
    if (room?.is_owner) syncOwnerAudio();
    void updateState(videoRef.current?.paused ? "paused" : "playing");
  };

  const changeVolume = (value: number) => {
    const normalized = Math.min(1, Math.max(0, value));
    setPlayerVolume(normalized);
  };

  const toggleMute = () => {
    if (playerVolume > 0.001) {
      lastAudibleVolumeRef.current = playerVolume;
      changeVolume(0);
    } else {
      changeVolume(lastAudibleVolumeRef.current || 1);
    }
  };

  const selectEpisode = async (episodeId: number) => {
    if (!room?.is_owner) return;
    const video = videoRef.current;
    const audio = ownerAudioRef.current;
    if (video) video.pause();
    if (audio) audio.pause();
    await updateState("paused", episodeId);
    setRoom((current) => current ? { ...current, episode_id: episodeId, playback_state: "paused", playback_position: 0, effective_position: 0 } : current);
    if (video) {
      const nextStream = `${api}/cinema/stream/${roomId}?${invite ? `invite=${encodeURIComponent(invite)}&` : ""}t=${Date.now()}`;
      video.src = nextStream;
      video.currentTime = 0;
      video.load();
      if (audio) {
        audio.src = nextStream;
        audio.currentTime = 0;
        audio.load();
      }
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
                onPlay={handleOwnerPlay}
                onPause={handleVideoPause}
                onSeeked={handleVideoSeeked}
              />
              {room.is_owner && <audio ref={ownerAudioRef} src={streamUrl} preload="auto" className="hidden" />}
              {room.is_owner && ownerAudioMuted && playerVolume > 0.001 && (
                <button
                  type="button"
                  onClick={() => void enableOwnerAudio()}
                  className="absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-black/80 px-3 py-2 text-sm font-medium text-white hover:bg-black"
                  title="Включить звук"
                >
                  <Volume2 className="h-4 w-4" />Включить звук
                </button>
              )}
              <button type="button" onClick={openFullscreen} className="absolute bottom-3 right-3 rounded-lg bg-black/70 p-2 text-white hover:bg-black/90" title="На весь экран"><Maximize2 className="h-5 w-5" /></button>
              {!room.is_owner && <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/70 px-2.5 py-1 text-xs">Плеером управляет создатель комнаты</div>}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-white/10 p-3 text-xs text-white/70">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {room.is_owner ? <><Play className="h-3.5 w-3.5 shrink-0" /><span>Play / Pause / перемотка синхронизируются у всех участников</span></> : <><Users className="h-3.5 w-3.5 shrink-0" /><span>Позиция автоматически синхронизируется с создателем</span></>}
              </div>

              <div className="flex min-w-[230px] items-center gap-2 rounded-lg bg-white/10 px-2.5 py-2 text-white" title={`Громкость ${Math.round(playerVolume * 100)}%`}>
                <button type="button" onClick={toggleMute} className="rounded p-1 hover:bg-white/10" aria-label={playerVolume > 0.001 ? "Выключить звук" : "Включить звук"}>
                  {playerVolume > 0.001 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(playerVolume * 100)}
                  onChange={(event) => changeVolume(Number(event.target.value) / 100)}
                  className="h-2 w-36 cursor-pointer accent-white sm:w-44"
                  aria-label="Громкость C-Party"
                />
                <span className="w-10 text-right font-medium tabular-nums">{Math.round(playerVolume * 100)}%</span>
              </div>
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

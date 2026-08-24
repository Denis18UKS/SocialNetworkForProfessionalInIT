import { useEffect, useState } from "react";
import { ArrowLeft, Calendar, Clock, Film, UserRound } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Person = { id: number; name: string; photo_url?: string; role_name: string; character_name?: string };
type Episode = { id: number; season_number: number; episode_number: number; episode_title?: string; duration_minutes?: number };
type Title = {
  id: number; title: string; description?: string; poster_url?: string; content_type: string; genres?: string;
  release_year?: number; release_end_year?: number; duration_minutes?: number; country?: string; age_rating?: string;
  people: Person[]; episodes: Episode[];
};

const CinemaTitle = () => {
  const { titleId = "" } = useParams<{ titleId: string }>();
  const navigate = useNavigate();
  const [title, setTitle] = useState<Title | null>(null);
  const token = localStorage.getItem("token") || "";

  useEffect(() => {
    fetch(`http://localhost:5000/cinema/library/${titleId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : null)
      .then(setTitle)
      .catch(() => setTitle(null));
  }, [titleId, token]);

  if (!title) return <div className="flex min-h-[45vh] items-center justify-center text-sm text-muted-foreground">Загружаем страницу…</div>;
  const actors = title.people.filter((person) => person.role_name === "actor");
  const directors = title.people.filter((person) => person.role_name === "director");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <Button variant="ghost" onClick={() => navigate("/c-party")}><ArrowLeft className="mr-2 h-4 w-4" />В библиотеку</Button>
      <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="aspect-[2/3] overflow-hidden rounded-2xl bg-muted shadow-sm">{title.poster_url ? <img src={title.poster_url} alt={title.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><Film className="h-14 w-14 text-muted-foreground" /></div>}</div>
        <div className="space-y-4">
          <div><div className="text-xs uppercase tracking-wide text-muted-foreground">{title.content_type === "series" ? "Сериал" : "Фильм"}</div><h1 className="text-3xl font-bold">{title.title}</h1></div>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground"><span className="rounded-full bg-muted px-3 py-1">{title.genres || "Жанр не указан"}</span>{title.release_year && <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1"><Calendar className="h-3.5 w-3.5" />{title.release_year}{title.release_end_year ? `–${title.release_end_year}` : ""}</span>}{title.duration_minutes && <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1"><Clock className="h-3.5 w-3.5" />{title.duration_minutes} мин.</span>}{title.country && <span className="rounded-full bg-muted px-3 py-1">{title.country}</span>}{title.age_rating && <span className="rounded-full bg-muted px-3 py-1">{title.age_rating}</span>}</div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/85">{title.description || "Описание пока не добавлено."}</p>
          {directors.length > 0 && <div><h2 className="mb-2 font-semibold">Режиссёрский состав</h2><div className="flex flex-wrap gap-2">{directors.map((person) => <Button key={person.id} variant="outline" size="sm" onClick={() => navigate(`/c-party/person/${person.id}`)}><UserRound className="mr-2 h-4 w-4" />{person.name}</Button>)}</div></div>}
        </div>
      </div>

      {actors.length > 0 && <div className="space-y-3"><h2 className="text-xl font-semibold">Актёрский состав</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{actors.map((person) => <Card key={person.id} className="cursor-pointer" onClick={() => navigate(`/c-party/person/${person.id}`)}><CardContent className="flex items-center gap-3 p-3">{person.photo_url ? <img src={person.photo_url} alt="" className="h-14 w-14 rounded-full object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted"><UserRound className="h-5 w-5" /></div>}<div className="min-w-0"><div className="truncate font-medium">{person.name}</div>{person.character_name && <div className="truncate text-xs text-muted-foreground">{person.character_name}</div>}</div></CardContent></Card>)}</div></div>}

      {title.episodes.length > 0 && <div className="space-y-3"><h2 className="text-xl font-semibold">Сезоны и серии</h2><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{title.episodes.map((episode) => <Card key={episode.id}><CardContent className="p-3"><div className="text-xs text-muted-foreground">Сезон {episode.season_number}, серия {episode.episode_number}</div><div className="font-medium">{episode.episode_title || `Серия ${episode.episode_number}`}</div>{episode.duration_minutes && <div className="text-xs text-muted-foreground">{episode.duration_minutes} мин.</div>}</CardContent></Card>)}</div></div>}
    </div>
  );
};

export default CinemaTitle;

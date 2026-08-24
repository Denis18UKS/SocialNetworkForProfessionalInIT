import { useEffect, useState } from "react";
import { ArrowLeft, Film, UserRound } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Filmography = { id: number; title: string; poster_url?: string; release_year?: number; role_name: string; character_name?: string };
type Person = { id: number; name: string; photo_url?: string; birth_date?: string; bio?: string; filmography: Filmography[] };

const CinemaPerson = () => {
  const { personId = "" } = useParams<{ personId: string }>();
  const navigate = useNavigate();
  const [person, setPerson] = useState<Person | null>(null);
  const token = localStorage.getItem("token") || "";

  useEffect(() => {
    fetch(`http://localhost:5000/cinema/people/${personId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : null)
      .then(setPerson)
      .catch(() => setPerson(null));
  }, [personId, token]);

  if (!person) return <div className="flex min-h-[45vh] items-center justify-center text-sm text-muted-foreground">Загружаем страницу…</div>;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft className="mr-2 h-4 w-4" />Назад</Button>
      <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="aspect-square overflow-hidden rounded-2xl bg-muted">{person.photo_url ? <img src={person.photo_url} alt={person.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><UserRound className="h-14 w-14 text-muted-foreground" /></div>}</div>
        <div><h1 className="text-3xl font-bold">{person.name}</h1>{person.birth_date && <div className="mt-1 text-sm text-muted-foreground">Дата рождения: {new Date(person.birth_date).toLocaleDateString()}</div>}<p className="mt-4 whitespace-pre-wrap text-sm leading-6">{person.bio || "Информация пока не добавлена."}</p></div>
      </div>
      <div><h2 className="mb-3 text-xl font-semibold">Фильмография в библиотеке C-Party</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{person.filmography.map((item) => <Card key={`${item.id}-${item.role_name}`} className="cursor-pointer overflow-hidden" onClick={() => navigate(`/c-party/title/${item.id}`)}><div className="aspect-video bg-muted">{item.poster_url ? <img src={item.poster_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><Film className="h-8 w-8 text-muted-foreground" /></div>}</div><CardContent className="p-3"><div className="font-medium">{item.title}</div><div className="text-xs text-muted-foreground">{item.release_year || "—"} · {item.role_name === "director" ? "Режиссёр" : item.character_name || "Актёр"}</div></CardContent></Card>)}{!person.filmography.length && <div className="text-sm text-muted-foreground">Фильмография пока пуста.</div>}</div></div>
    </div>
  );
};

export default CinemaPerson;

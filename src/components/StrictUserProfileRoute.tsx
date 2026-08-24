import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import UserProfilePage from "@/pages/UsersProfiles";

type PrivacyState = { loading: boolean; restricted: boolean; message?: string; userId?: number };

const StrictUserProfileRoute = () => {
  const { username = "" } = useParams<{ username: string }>();
  const [privacy, setPrivacy] = useState<PrivacyState>({ loading: true, restricted: false });
  const [isFriend, setIsFriend] = useState(false);
  const [removing, setRemoving] = useState(false);

  const token = localStorage.getItem("token") || "";

  useEffect(() => {
    let cancelled = false;
    setPrivacy({ loading: true, restricted: false });
    fetch(`http://localhost:5000/privacy/check/${encodeURIComponent(username)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 403) throw new Error(data?.message || "Не удалось проверить профиль");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setPrivacy({ loading: false, restricted: Boolean(data.restricted), message: data.message, userId: data.userId });
        if (!data.restricted) {
          fetch(`http://localhost:5000/relationship/${encodeURIComponent(username)}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then((response) => response.ok ? response.json() : null)
            .then((relationship) => {
              if (!cancelled && relationship) {
                setIsFriend(Boolean(relationship.isFriend));
                setPrivacy((current) => ({ ...current, userId: Number(relationship.targetId || current.userId) }));
              }
            })
            .catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setPrivacy({ loading: false, restricted: false });
      });
    return () => { cancelled = true; };
  }, [username, token]);

  const removeFriend = async () => {
    if (!privacy.userId || !window.confirm("Удалить этого пользователя из друзей?")) return;
    setRemoving(true);
    try {
      const response = await fetch(`http://localhost:5000/friends/${privacy.userId}/v2`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "Не удалось удалить из друзей");
      setIsFriend(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось удалить из друзей");
    } finally {
      setRemoving(false);
    }
  };

  if (privacy.loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">Проверяем доступ к профилю…</div>;
  }

  if (privacy.restricted) {
    return (
      <div className="flex min-h-[65vh] items-center justify-center p-4">
        <div className="max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm">
          <div className="text-lg font-semibold">Данный пользователь ограничил круг лиц</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {isFriend && privacy.userId ? (
        <div className="mb-3 flex justify-end">
          <Button variant="outline" size="sm" disabled={removing} onClick={removeFriend} className="gap-2">
            <UserMinus className="h-4 w-4" />
            {removing ? "Удаление…" : "Удалить из друзей"}
          </Button>
        </div>
      ) : null}
      <UserProfilePage />
    </div>
  );
};

export default StrictUserProfileRoute;

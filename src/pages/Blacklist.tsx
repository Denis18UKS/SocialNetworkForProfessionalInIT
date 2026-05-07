import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, Search, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/use-toast";

interface BlockedUser {
  id: number;
  username: string;
  avatar?: string | null;
  email?: string;
  blocked_at?: string;
}

const getAvatarUrl = (avatar?: string | null) => {
  return avatar ? `http://localhost:5000${avatar}` : "/images/default-avatar.png";
};

const Blacklist = () => {
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<number | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const fetchBlacklist = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login");
      return;
    }

    try {
      const response = await fetch("http://localhost:5000/blacklist", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error();
      const data = await response.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      toast({
        title: "Ошибка",
        description: "Не удалось загрузить черный список",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBlacklist();
  }, []);

  const unblockUser = async (user: BlockedUser) => {
    if (!window.confirm(`Разблокировать пользователя ${user.username}?`)) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    setUnblockingId(user.id);
    try {
      const response = await fetch(`http://localhost:5000/blacklist/${user.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error();
      setUsers((current) => current.filter((item) => item.id !== user.id));
      toast({
        title: "Пользователь разблокирован",
        description: `${user.username} снова может писать вам`,
      });
    } catch {
      toast({
        title: "Ошибка",
        description: "Не удалось разблокировать пользователя",
        variant: "destructive",
      });
    } finally {
      setUnblockingId(null);
    }
  };

  const filteredUsers = users.filter((user) =>
    user.username.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Черный список</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Пользователи, которым вы ограничили возможность писать вам.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по имени..."
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-red-500" />
            Заблокированные пользователи
          </CardTitle>
          <CardDescription>
            Разблокировка сразу вернет пользователю возможность написать вам в личный чат.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-[#6E59A5]" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-14 text-center dark:border-gray-700">
              <UserRoundX className="mb-3 h-10 w-10 text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {users.length === 0 ? "Черный список пуст" : "Никого не найдено"}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {users.length === 0
                  ? "Здесь появятся пользователи, которых вы добавите в черный список."
                  : "Попробуйте изменить поисковый запрос."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredUsers.map((user) => (
                <div key={user.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar>
                      <AvatarImage src={getAvatarUrl(user.avatar)} />
                      <AvatarFallback>{user.username.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900 dark:text-white">{user.username}</p>
                      {user.blocked_at && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Заблокирован: {new Date(user.blocked_at).toLocaleString("ru-RU")}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => unblockUser(user)}
                    disabled={unblockingId === user.id}
                    className="shrink-0"
                  >
                    Разблокировать
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Blacklist;

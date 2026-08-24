import { useEffect, useMemo, useState } from "react";
import { Folder, FolderPlus, MessageCircle, MessagesSquare, Plus, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FolderItem { folder_id: number; scope_name: "personal" | "group"; target_id: number }
interface FolderRow { id: number; name: string; sort_order: number }
interface Friend { id: number; username: string; restricted?: boolean; message?: string }
interface Group { id: number; name: string }

const ChatFolders = () => {
  const token = localStorage.getItem("token") || "";
  const navigate = useNavigate();
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [items, setItems] = useState<FolderItem[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeFolder, setActiveFolder] = useState<number | "all">("all");
  const headers = { Authorization: `Bearer ${token}` };

  const reload = async () => {
    const [folderResponse, friendResponse, groupResponse] = await Promise.all([
      fetch("http://localhost:5000/chat-folders", { headers }),
      fetch("http://localhost:5000/friends", { headers }),
      fetch("http://localhost:5000/group-chats", { headers }),
    ]);
    if (folderResponse.ok) {
      const data = await folderResponse.json();
      setFolders(Array.isArray(data.folders) ? data.folders : []);
      setItems(Array.isArray(data.items) ? data.items : []);
    }
    if (friendResponse.ok) {
      const data = await friendResponse.json();
      setFriends(Array.isArray(data) ? data : Array.isArray(data.friends) ? data.friends : []);
    }
    if (groupResponse.ok) {
      const data = await groupResponse.json();
      setGroups(Array.isArray(data) ? data : []);
    }
  };

  useEffect(() => { void reload(); }, []);

  const selectedItems = useMemo(() => activeFolder === "all" ? items : items.filter((item) => item.folder_id === activeFolder), [activeFolder, items]);
  const selectedSet = useMemo(() => new Set(selectedItems.map((item) => `${item.scope_name}:${item.target_id}`)), [selectedItems]);

  const createFolder = async () => {
    const name = window.prompt("Название новой папки чатов:");
    if (!name?.trim()) return;
    const response = await fetch("http://localhost:5000/chat-folders", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return window.alert(data?.message || "Не удалось создать папку");
    await reload();
    setActiveFolder(Number(data.id));
  };

  const deleteFolder = async (id: number) => {
    if (!window.confirm("Удалить папку? Сами чаты и сообщения не удаляются.")) return;
    const response = await fetch(`http://localhost:5000/chat-folders/${id}`, { method: "DELETE", headers });
    if (!response.ok) return window.alert("Не удалось удалить папку");
    if (activeFolder === id) setActiveFolder("all");
    await reload();
  };

  const toggleItem = async (scope: "personal" | "group", targetId: number) => {
    if (activeFolder === "all") return window.alert("Сначала выберите пользовательскую папку.");
    const key = `${scope}:${targetId}`;
    const present = selectedSet.has(key);
    const url = present
      ? `http://localhost:5000/chat-folders/${activeFolder}/items/${scope}/${targetId}`
      : `http://localhost:5000/chat-folders/${activeFolder}/items`;
    const response = await fetch(url, {
      method: present ? "DELETE" : "PUT",
      headers: present ? headers : { ...headers, "Content-Type": "application/json" },
      body: present ? undefined : JSON.stringify({ scope, targetId }),
    });
    if (!response.ok) return window.alert("Не удалось изменить папку");
    await reload();
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Папки чатов</h1>
          <p className="text-sm text-muted-foreground">Распределяйте личные и групповые чаты по своим папкам. Один чат может находиться сразу в нескольких папках.</p>
        </div>
        <Button onClick={createFolder} className="gap-2"><FolderPlus className="h-4 w-4" />Новая папка</Button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Button variant={activeFolder === "all" ? "default" : "outline"} onClick={() => setActiveFolder("all")} className="shrink-0 gap-2"><MessagesSquare className="h-4 w-4" />Все</Button>
        {folders.map((folder) => (
          <div key={folder.id} className="flex shrink-0 items-center gap-1">
            <Button variant={activeFolder === folder.id ? "default" : "outline"} onClick={() => setActiveFolder(folder.id)} className="gap-2"><Folder className="h-4 w-4" />{folder.name}</Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => deleteFolder(folder.id)} title="Удалить папку"><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>

      {activeFolder === "all" ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">Выберите папку выше, чтобы увидеть её состав или добавить чаты. «Все» — системная вкладка и не удаляется.</CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-lg">Личные чаты</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {friends.length === 0 && <div className="text-sm text-muted-foreground">Нет доступных личных чатов.</div>}
              {friends.map((friend) => {
                const included = selectedSet.has(`personal:${friend.id}`);
                const restricted = Boolean(friend.restricted);
                return (
                  <div key={friend.id} className="flex min-w-0 items-center gap-2 rounded-lg border p-2.5">
                    <MessageCircle className="h-4 w-4 shrink-0" />
                    <button disabled={restricted} onClick={() => navigate(`/users-profiles/${encodeURIComponent(friend.username)}`)} className="min-w-0 flex-1 truncate text-left text-sm font-medium disabled:cursor-default">
                      {restricted ? "Данный пользователь ограничил круг лиц" : friend.username}
                    </button>
                    {!restricted && <Button size="sm" variant={included ? "secondary" : "outline"} onClick={() => toggleItem("personal", friend.id)}>{included ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}</Button>}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Групповые чаты</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {groups.length === 0 && <div className="text-sm text-muted-foreground">Нет групповых чатов.</div>}
              {groups.map((group) => {
                const included = selectedSet.has(`group:${group.id}`);
                return (
                  <div key={group.id} className="flex min-w-0 items-center gap-2 rounded-lg border p-2.5">
                    <MessagesSquare className="h-4 w-4 shrink-0" />
                    <button onClick={() => navigate(`/group-chats/${group.id}`)} className="min-w-0 flex-1 truncate text-left text-sm font-medium">{group.name}</button>
                    <Button size="sm" variant={included ? "secondary" : "outline"} onClick={() => toggleItem("group", group.id)}>{included ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}</Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default ChatFolders;

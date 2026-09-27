import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Folder, FolderPlus, MoreVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiUrl } from "@/lib/settings";

export type ChatFolderScope = "personal" | "group";
type ActiveFolder = number | "all";

type FolderRow = { id: number; name: string; sort_order: number };
type FolderItem = { folder_id: number; scope_name: ChatFolderScope; target_id: number };

export const useChatFolders = (scope: ChatFolderScope) => {
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [items, setItems] = useState<FolderItem[]>([]);
  const [activeFolder, setActiveFolder] = useState<ActiveFolder>("all");
  const token = localStorage.getItem("token") || "";

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(apiUrl("/chat-folders"), {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      const nextFolders = Array.isArray(data?.folders) ? data.folders : [];
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setFolders(nextFolders);
      setItems(nextItems);
      setActiveFolder((current) => current === "all" || nextFolders.some((folder: FolderRow) => Number(folder.id) === Number(current)) ? current : "all");
    } catch {
      // Chat folders are an optional navigation aid; a temporary API failure must not break chats.
    }
  }, [token]);

  useEffect(() => { void reload(); }, [reload]);

  const visibleTargetIds = useMemo(() => {
    if (activeFolder === "all") return null;
    return new Set(
      items
        .filter((item) => Number(item.folder_id) === Number(activeFolder) && item.scope_name === scope)
        .map((item) => Number(item.target_id)),
    );
  }, [activeFolder, items, scope]);

  const isInFolder = useCallback((folderId: number, targetId: number) =>
    items.some((item) => Number(item.folder_id) === Number(folderId) && item.scope_name === scope && Number(item.target_id) === Number(targetId)),
  [items, scope]);

  const createFolder = useCallback(async () => {
    if (!token) return null;
    const name = window.prompt("Название новой папки чатов:")?.trim();
    if (!name) return null;
    const response = await fetch(apiUrl("/chat-folders"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(data?.message || "Не удалось создать папку");
      return null;
    }
    await reload();
    const folder = { id: Number(data.id), name: String(data.name || name), sort_order: Number(data.sort_order || 0) };
    setActiveFolder(folder.id);
    return folder;
  }, [reload, token]);

  const setMembership = useCallback(async (folderId: number, targetId: number, shouldInclude: boolean) => {
    if (!token) return false;
    const endpoint = shouldInclude
      ? apiUrl(`/chat-folders/${folderId}/items`)
      : apiUrl(`/chat-folders/${folderId}/items/${scope}/${targetId}`);
    const response = await fetch(endpoint, {
      method: shouldInclude ? "PUT" : "DELETE",
      headers: shouldInclude
        ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
        : { Authorization: `Bearer ${token}` },
      body: shouldInclude ? JSON.stringify({ scope, targetId }) : undefined,
    });
    if (!response.ok) return false;
    await reload();
    return true;
  }, [reload, scope, token]);

  const toggleTarget = useCallback(async (folderId: number, targetId: number) => {
    return setMembership(folderId, targetId, !isInFolder(folderId, targetId));
  }, [isInFolder, setMembership]);

  return {
    scope,
    folders,
    items,
    activeFolder,
    setActiveFolder,
    visibleTargetIds,
    isInFolder,
    createFolder,
    setMembership,
    toggleTarget,
    reload,
  };
};

export type ChatFolderModel = ReturnType<typeof useChatFolders>;

export const ChatFolderTabs = ({ model }: { model: ChatFolderModel }) => (
  <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <Button
      type="button"
      size="sm"
      variant={model.activeFolder === "all" ? "default" : "outline"}
      className="h-8 shrink-0 rounded-full px-3 text-xs"
      onClick={() => model.setActiveFolder("all")}
    >
      Все
    </Button>
    {model.folders.map((folder) => (
      <Button
        key={folder.id}
        type="button"
        size="sm"
        variant={Number(model.activeFolder) === Number(folder.id) ? "default" : "outline"}
        className="h-8 shrink-0 rounded-full px-3 text-xs"
        onClick={() => model.setActiveFolder(Number(folder.id))}
        title={folder.name}
      >
        <Folder className="mr-1.5 h-3.5 w-3.5" />
        <span className="max-w-28 truncate">{folder.name}</span>
      </Button>
    ))}
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-8 w-8 shrink-0 rounded-full p-0"
      onClick={() => void model.createFolder()}
      title="Новая папка"
    >
      <Plus className="h-4 w-4" />
    </Button>
  </div>
);

export const ChatFolderMenu = ({ model, targetId }: { model: ChatFolderModel; targetId: number }) => {
  const addToNewFolder = async (event?: Event) => {
    event?.stopPropagation?.();
    const folder = await model.createFolder();
    if (folder) await model.setMembership(folder.id, targetId, true);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0"
          title="Папки чата"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuLabel className="flex items-center gap-2"><Folder className="h-4 w-4" />Папки</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {model.folders.map((folder) => {
          const included = model.isInFolder(folder.id, targetId);
          return (
            <DropdownMenuItem key={folder.id} onSelect={() => void model.toggleTarget(folder.id, targetId)}>
              <span className="mr-2 flex h-4 w-4 items-center justify-center">{included && <Check className="h-4 w-4" />}</span>
              <span className="max-w-48 truncate">{folder.name}</span>
            </DropdownMenuItem>
          );
        })}
        {model.folders.length === 0 && <DropdownMenuItem disabled>Папок пока нет</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(event) => void addToNewFolder(event)}>
          <FolderPlus className="mr-2 h-4 w-4" />Новая папка и добавить
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

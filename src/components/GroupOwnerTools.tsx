import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  groupId: number;
  creatorId: number;
  currentUserId?: number;
  onCleared?: () => void;
};

const GroupOwnerTools = ({ groupId, creatorId, currentUserId, onCleared }: Props) => {
  if (!currentUserId || Number(creatorId) !== Number(currentUserId)) return null;

  const clearForEveryone = async () => {
    if (!window.confirm("Очистить всю историю этого группового чата у всех участников? Это действие нельзя отменить.")) return;
    const token = localStorage.getItem("token");
    const response = await fetch(`http://localhost:5000/group-chats/${groupId}/messages/all-v2`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return window.alert(data?.message || "Не удалось очистить групповой чат");
    onCleared?.();
    window.dispatchEvent(new CustomEvent("socialbird-group-chat-cleared", { detail: { groupId } }));
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={clearForEveryone} className="shrink-0 gap-2" title="Очистить историю у всех участников">
      <Eraser className="h-4 w-4" />
      <span className="hidden sm:inline">Очистить у всех</span>
    </Button>
  );
};

export default GroupOwnerTools;

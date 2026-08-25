import { useEffect, useMemo, useState } from "react";
import { Phone, PhoneCall, Users, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  useCallManager,
  type CallKind,
  type CallMode,
  type CallParticipant,
} from "@/components/call/CallProvider";

type VoiceCallControlsProps = {
  currentUserId?: number;
  mode: CallMode;
  chatId: number | string;
  title: string;
  participants: CallParticipant[];
};

const VoiceCallControls = ({
  currentUserId,
  mode,
  chatId,
  title,
  participants,
}: VoiceCallControlsProps) => {
  const { call, incoming, startCall } = useCallManager();
  const [showPicker, setShowPicker] = useState(false);
  const [kind, setKind] = useState<CallKind>("voice");

  const callableParticipants = useMemo(
    () => participants.filter((participant) => Number(participant.id) !== Number(currentUserId)),
    [currentUserId, participants],
  );
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    setSelectedIds(callableParticipants.map((participant) => Number(participant.id)));
  }, [callableParticipants.map((participant) => participant.id).join(",")]);

  const busy = Boolean(call || incoming);

  const begin = async (nextKind: CallKind) => {
    const targetIds = mode === "private"
      ? callableParticipants.map((participant) => Number(participant.id))
      : selectedIds;
    if (targetIds.length === 0) return;
    await startCall({
      mode,
      chatId,
      title,
      kind: nextKind,
      targetIds,
      participants: callableParticipants.filter((participant) => targetIds.includes(Number(participant.id))),
    });
    setShowPicker(false);
  };

  const open = (nextKind: CallKind) => {
    if (busy) return;
    if (mode === "group") {
      setKind(nextKind);
      setShowPicker(true);
      return;
    }
    void begin(nextKind);
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || callableParticipants.length === 0}
          onClick={() => open("voice")}
          className="gap-2"
          title={busy ? "Уже есть активный звонок" : "Голосовой звонок"}
        >
          <Phone className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || callableParticipants.length === 0}
          onClick={() => open("video")}
          className="gap-2"
          title={busy ? "Уже есть активный звонок" : "Видеозвонок"}
        >
          <Video className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={showPicker} onOpenChange={setShowPicker}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {kind === "video" ? <Video className="h-5 w-5" /> : <Users className="h-5 w-5" />}
              Выберите участников звонка
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {callableParticipants.map((participant) => {
              const id = Number(participant.id);
              return (
                <label key={id} className="flex cursor-pointer items-center gap-3 rounded-md border p-3">
                  <Checkbox
                    checked={selectedIds.includes(id)}
                    onCheckedChange={(checked) => {
                      setSelectedIds((current) => checked
                        ? Array.from(new Set([...current, id]))
                        : current.filter((item) => item !== id));
                    }}
                  />
                  <span className="min-w-0 truncate">{participant.username}</span>
                </label>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setShowPicker(false)}>Отмена</Button>
            <Button
              type="button"
              onClick={() => void begin(kind)}
              disabled={selectedIds.length === 0 || busy}
              className="gap-2"
            >
              <PhoneCall className="h-4 w-4" />
              Позвонить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default VoiceCallControls;

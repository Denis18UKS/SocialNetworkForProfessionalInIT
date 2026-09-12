import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/settings";

const EmailNotificationPreference = () => {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(apiUrl("/notification-preferences"), {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.message || "Не удалось загрузить настройки уведомлений");
        if (!cancelled) setEnabled(data?.emailNotificationsEnabled !== false);
      } catch (error) {
        console.error("Email notification preference load error:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) return null;

  const updatePreference = async (nextEnabled: boolean) => {
    const previous = enabled;
    setEnabled(nextEnabled);
    setSaving(true);

    try {
      const response = await fetch(apiUrl("/notification-preferences"), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ emailNotificationsEnabled: nextEnabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "Не удалось сохранить настройку");
      setEnabled(data?.emailNotificationsEnabled !== false);
      toast({
        title: "Почтовые уведомления",
        description: nextEnabled
          ? "Внешние уведомления SocialBIRD будут приходить на вашу почту."
          : "Внешние уведомления SocialBIRD на почту отключены.",
      });
    } catch (error) {
      setEnabled(previous);
      toast({
        title: "Не удалось сохранить настройку",
        description: error instanceof Error ? error.message : "Повторите попытку позже.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Внешние уведомления</CardTitle>
        <CardDescription>
          Управляет обычными уведомлениями SocialBIRD по электронной почте. Письма безопасности,
          подтверждение регистрации, восстановление пароля и коды администратора остаются включёнными.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-md border p-4">
          <div className="min-w-0">
            <Label htmlFor="email-notifications-enabled">Получать уведомления на почту</Label>
            <p className="mt-1 text-sm text-muted-foreground">
              Если выключить, сообщения, упоминания и другие внешние уведомления не будут отправляться на email.
            </p>
          </div>
          <Switch
            id="email-notifications-enabled"
            checked={enabled}
            disabled={loading || saving}
            onCheckedChange={updatePreference}
            aria-label="Получать уведомления SocialBIRD на почту"
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default EmailNotificationPreference;

import { FormEvent, useState } from "react";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "email" | "codes" | "done";

const EmailChange = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem("token") || "";
  const [step, setStep] = useState<Step>("email");
  const [newEmail, setNewEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [oldCode, setOldCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [oldConfirmed, setOldConfirmed] = useState(false);
  const [hints, setHints] = useState({ old: "", next: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const requestCodes = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("http://localhost:5000/account/email-change/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "Не удалось отправить коды");
      setChallengeId(data.challengeId);
      setHints({ old: data.oldEmailHint || "текущую почту", next: data.newEmailHint || newEmail });
      setStep("codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить коды");
    } finally {
      setBusy(false);
    }
  };

  const confirmOld = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("http://localhost:5000/account/email-change/confirm-old", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code: oldCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "Неверный код");
      setOldConfirmed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось подтвердить текущую почту");
    } finally {
      setBusy(false);
    }
  };

  const confirmNew = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("http://localhost:5000/account/email-change/confirm-new", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code: newCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || "Неверный код");
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось подтвердить новую почту");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button variant="ghost" className="gap-2" onClick={() => navigate("/settings")}><ArrowLeft className="h-4 w-4" />Назад в настройки</Button>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Изменение почты</CardTitle>
          <CardDescription>SocialBIRD меняет адрес только после подтверждения текущей и новой почты. Пока оба кода не подтверждены, старый адрес остаётся активным.</CardDescription>
        </CardHeader>
        <CardContent>
          {step === "email" && (
            <form onSubmit={requestCodes} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-email">Новая почта</Label>
                <Input id="new-email" type="email" required value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="new@example.com" />
              </div>
              {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
              <Button type="submit" disabled={busy}>{busy ? "Отправляем…" : "Получить коды подтверждения"}</Button>
            </form>
          )}

          {step === "codes" && (
            <div className="space-y-5">
              <div className="rounded-lg bg-muted p-3 text-sm">Коды действуют 10 минут. Один отправлен на <b>{hints.old}</b>, второй — на <b>{hints.next}</b>.</div>
              <div className="space-y-2">
                <Label>Код с текущей почты</Label>
                <div className="flex gap-2">
                  <Input inputMode="numeric" maxLength={6} value={oldCode} disabled={oldConfirmed} onChange={(event) => setOldCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />
                  <Button type="button" variant={oldConfirmed ? "secondary" : "default"} disabled={busy || oldConfirmed || oldCode.length !== 6} onClick={confirmOld}>{oldConfirmed ? "Подтверждено" : "Подтвердить"}</Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Код с новой почты</Label>
                <div className="flex gap-2">
                  <Input inputMode="numeric" maxLength={6} value={newCode} onChange={(event) => setNewCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />
                  <Button type="button" disabled={busy || !oldConfirmed || newCode.length !== 6} onClick={confirmNew}>Завершить смену</Button>
                </div>
              </div>
              {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
            </div>
          )}

          {step === "done" && (
            <div className="space-y-4 text-center">
              <ShieldCheck className="mx-auto h-12 w-12 text-emerald-500" />
              <div className="text-lg font-semibold">Новая почта подтверждена</div>
              <div className="text-sm text-muted-foreground">Адрес аккаунта изменён. На прежнюю почту отправлено уведомление о смене.</div>
              <Button onClick={() => navigate("/settings")}>Вернуться в настройки</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EmailChange;

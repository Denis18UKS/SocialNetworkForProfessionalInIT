import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

const PasswordRecovery = () => {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showOwnerRecovery, setShowOwnerRecovery] = useState(false);
  const [ownerCode, setOwnerCode] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const response = await fetch("http://localhost:5000/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Не удалось отправить код");
      setRequested(true);
      toast({
        title: "Код отправлен",
        description: data.message || "Проверьте почту. Код действует 10 минут.",
      });
    } catch (error) {
      toast({
        title: "Ошибка отправки",
        description: error instanceof Error ? error.message : "Не удалось отправить код",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const confirmReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      toast({ title: "Ошибка", description: "Введите 6-значный код", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Ошибка", description: "Новый пароль должен быть не короче 8 символов", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("http://localhost:5000/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Не удалось изменить пароль");
      setRequested(false);
      setCode("");
      setNewPassword("");
      toast({ title: "Пароль изменён", description: "Теперь можно войти с новым паролем." });
    } catch (error) {
      toast({
        title: "Ошибка восстановления",
        description: error instanceof Error ? error.message : "Не удалось изменить пароль",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const ownerEmergencyReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !ownerCode.trim()) {
      toast({ title: "Ошибка", description: "Укажите почту владельца и backup-код", variant: "destructive" });
      return;
    }
    if (ownerPassword.length < 8) {
      toast({ title: "Ошибка", description: "Новый пароль должен быть не короче 8 символов", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("http://localhost:5000/password-reset/owner-emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          recoveryCode: ownerCode.trim(),
          newPassword: ownerPassword,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Аварийное восстановление не выполнено");
      setOwnerCode("");
      setOwnerPassword("");
      setShowOwnerRecovery(false);
      toast({ title: "Доступ восстановлен", description: data.message || "Пароль владельца изменён." });
    } catch (error) {
      toast({
        title: "Ошибка аварийного восстановления",
        description: error instanceof Error ? error.message : "Не удалось выполнить восстановление",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-4 space-y-3 rounded-md border border-gray-200 p-3 text-left dark:border-gray-700">
      <form onSubmit={requested ? confirmReset : requestCode} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="resetEmail">Почта аккаунта</Label>
          <Input
            id="resetEmail"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="example@mail.com"
            required
            disabled={requested && loading}
          />
        </div>

        {!requested ? (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              На почту придёт одноразовый 6-значный код. Текущий пароль не изменится, пока код не будет подтверждён.
            </p>
            <Button type="submit" className="w-full bg-[#6E59A5] text-white hover:bg-[#5a4a8a]" disabled={loading}>
              {loading ? "Отправляем..." : "Получить код"}
            </Button>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="resetCode">Код из письма</Label>
              <Input
                id="resetCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resetNewPassword">Новый пароль</Label>
              <Input
                id="resetNewPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" disabled={loading} onClick={() => setRequested(false)}>
                Запросить заново
              </Button>
              <Button type="submit" className="flex-1 bg-[#6E59A5] text-white hover:bg-[#5a4a8a]" disabled={loading}>
                {loading ? "Проверяем..." : "Сменить пароль"}
              </Button>
            </div>
          </>
        )}
      </form>

      <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-xs text-gray-500"
          onClick={() => setShowOwnerRecovery((current) => !current)}
        >
          {showOwnerRecovery ? "Скрыть аварийное восстановление" : "Аварийный backup-код владельца"}
        </Button>

        {showOwnerRecovery && (
          <form onSubmit={ownerEmergencyReset} className="mt-3 space-y-3 rounded-md bg-amber-50 p-3 dark:bg-amber-950/20">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Только для старшего администратора. Каждый backup-код одноразовый; старые пароли нигде не показываются и не хранятся в открытом виде.
            </p>
            <Input
              value={ownerCode}
              onChange={(event) => setOwnerCode(event.target.value.toUpperCase())}
              placeholder="SB-XXXX-XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              required
            />
            <Input
              type="password"
              value={ownerPassword}
              onChange={(event) => setOwnerPassword(event.target.value)}
              placeholder="Новый пароль владельца"
              minLength={8}
              autoComplete="new-password"
              required
            />
            <Button type="submit" variant="destructive" className="w-full" disabled={loading}>
              {loading ? "Проверяем..." : "Восстановить доступ владельца"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};

export default PasswordRecovery;

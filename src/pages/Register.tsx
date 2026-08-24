import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AtSign, CheckCircle2, MailCheck, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { apiUrl } from "@/lib/settings";

const normalizeUserTag = (value: string) => value.trim().replace(/^@+/, "").toLowerCase();
type Step = "form" | "verify" | "done";

const Register = () => {
  const [username, setUsername] = useState("");
  const [userTag, setUserTag] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gitHubUsername, setGitHubUsername] = useState("");
  const [gitLabUsername, setGitLabUsername] = useState("");
  const [website, setWebsite] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [code, setCode] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const validateUserTag = () => {
    const normalized = normalizeUserTag(userTag);
    if (!normalized) return true;
    return /^[a-z0-9_]{3,32}$/.test(normalized);
  };

  const switchToVerification = (data: any) => {
    setEmailHint(String(data?.email || email));
    setCooldown(Number(data?.resendAfterSeconds || 60));
    setStep("verify");
  };

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateUserTag()) {
      toast({ title: "Ошибка", description: "@username должен быть от 3 до 32 символов: латиница, цифры и _.", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Слишком короткий пароль", description: "Используйте не меньше 8 символов.", variant: "destructive" });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(apiUrl("/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          user_tag: normalizeUserTag(userTag) || null,
          email: email.trim(),
          password,
          github_username: gitHubUsername || null,
          gitlab_username: gitLabUsername || gitHubUsername || null,
          website,
        }),
      });
      const data = await response.json();
      if (!response.ok && !data?.verificationRequired) {
        toast({ title: "Ошибка", description: data.message || "Не удалось зарегистрироваться.", variant: "destructive" });
        return;
      }
      if (data?.verificationRequired) {
        switchToVerification(data);
        toast({ title: "Проверьте почту", description: "Мы отправили 6-значный код подтверждения." });
        return;
      }
      toast({ title: "Ошибка", description: "Сервер не запросил подтверждение почты.", variant: "destructive" });
    } catch (error) {
      console.error(error);
      toast({ title: "Ошибка", description: "Ошибка при отправке данных на сервер.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedCode = code.replace(/\D/g, "").slice(0, 6);
    if (normalizedCode.length !== 6) {
      toast({ title: "Введите код", description: "Код состоит из 6 цифр.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(apiUrl("/register/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: normalizedCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast({ title: "Код не подтверждён", description: data.message || "Проверьте код и повторите попытку.", variant: "destructive" });
        return;
      }
      setStep("done");
      toast({ title: "Аккаунт подтверждён", description: "Теперь можно войти в SocialBIRD." });
      window.setTimeout(() => navigate("/login"), 1800);
    } catch (error) {
      console.error(error);
      toast({ title: "Ошибка", description: "Не удалось подтвердить код.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    try {
      const response = await fetch(apiUrl("/register/resend"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (Number(data?.retryAfterSeconds) > 0) setCooldown(Number(data.retryAfterSeconds));
        toast({ title: "Не удалось отправить код", description: data.message || "Попробуйте позже.", variant: "destructive" });
        return;
      }
      setCode("");
      setCooldown(Number(data?.resendAfterSeconds || 60));
      toast({ title: "Новый код отправлен", description: "Проверьте почту." });
    } catch (error) {
      console.error(error);
      toast({ title: "Ошибка", description: "Не удалось запросить новый код.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4 dark:from-gray-900 dark:to-gray-800">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="w-full max-w-md">
        <Card className="border border-gray-200 shadow-lg dark:border-gray-700">
          <CardHeader className="space-y-1">
            <CardTitle className="text-center text-2xl font-bold">
              {step === "verify" ? "Подтверждение почты" : step === "done" ? "Готово" : "Регистрация"}
            </CardTitle>
            <CardDescription className="text-center text-gray-600 dark:text-gray-400">
              {step === "verify"
                ? `Введите код, отправленный на ${emailHint || email}`
                : step === "done"
                  ? "Почта подтверждена, аккаунт создан."
                  : "Создайте аккаунт SocialBIRD. Перед входом мы подтвердим вашу почту."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === "form" && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Имя пользователя</Label>
                  <Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={2} maxLength={100} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-tag" className="flex items-center gap-2"><AtSign className="h-4 w-4" />@username</Label>
                  <Input id="user-tag" value={userTag} onChange={(event) => setUserTag(event.target.value)} placeholder="@socialbird_user" />
                  <p className="text-xs text-muted-foreground">Необязательно. Используется для упоминаний и поиска.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Почта</Label>
                  <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="github">GitHub Username</Label>
                  <Input id="github" value={gitHubUsername} onChange={(event) => setGitHubUsername(event.target.value)} placeholder="Необязательно" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gitlab">GitLab Username</Label>
                  <Input id="gitlab" value={gitLabUsername} onChange={(event) => setGitLabUsername(event.target.value)} placeholder="Если пусто, используем GitHub username" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Пароль</Label>
                  <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={200} autoComplete="new-password" required />
                  <p className="text-xs text-muted-foreground">Минимум 8 символов.</p>
                </div>

                <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                  <Label htmlFor="website">Website</Label>
                  <Input id="website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
                </div>

                <Button type="submit" disabled={busy} className="w-full bg-[#6E59A5] text-white hover:bg-[#5a4a8a]">
                  {busy ? "Отправляем код..." : "Продолжить и подтвердить почту"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">Для защиты от ботов действуют лимиты на регистрации, отправку кодов и попытки подтверждения.</p>
              </form>
            )}

            {step === "verify" && (
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><MailCheck className="h-6 w-6" /></div>
                <div className="space-y-2">
                  <Label htmlFor="verification-code">Код из письма</Label>
                  <Input
                    id="verification-code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="text-center text-2xl font-semibold tracking-[0.45em]"
                    placeholder="000000"
                    autoFocus
                    required
                  />
                  <p className="text-xs text-muted-foreground">Код действует 10 минут. Никому его не сообщайте.</p>
                </div>
                <Button type="submit" disabled={busy || code.length !== 6} className="w-full">{busy ? "Проверяем..." : "Подтвердить и создать аккаунт"}</Button>
                <Button type="button" variant="outline" disabled={busy || cooldown > 0} onClick={resendCode} className="w-full gap-2">
                  <RefreshCw className="h-4 w-4" />
                  {cooldown > 0 ? `Отправить новый код через ${cooldown} сек.` : "Отправить новый код"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setStep("form"); setCode(""); }} className="w-full">Изменить данные регистрации</Button>
              </form>
            )}

            {step === "done" && (
              <Alert className="border-emerald-500/30 bg-emerald-500/10">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle>Регистрация завершена</AlertTitle>
                <AlertDescription>Почта подтверждена. Перенаправляем на страницу входа.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default Register;

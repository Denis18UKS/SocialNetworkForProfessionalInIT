import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, QrCode, UserPlus } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiUrl } from "@/lib/settings";

const FriendQrLanding = () => {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const authToken = localStorage.getItem("token");

  useEffect(() => {
    if (!authToken || !token || status !== "idle") return;
    setStatus("loading");
    fetch(apiUrl("/friend-qr/add"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Не удалось добавить пользователя");
        setMessage(data.message || "Пользователь найден по QR-коду");
        setStatus("success");
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "QR-код недействителен");
        setStatus("error");
      });
  }, [authToken, token, status]);

  return (
    <div className="flex min-h-full items-center justify-center bg-gray-50 p-3 dark:bg-gray-900 sm:p-6">
      <Card className="w-full max-w-md overflow-hidden">
        <CardHeader className="text-center">
          <QrCode className="mx-auto h-12 w-12 text-primary" />
          <CardTitle>Добавление в друзья по QR-коду</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {!authToken ? (
            <>
              <p className="text-sm text-muted-foreground">
                Сначала войдите в SocialBIRD. После входа снова откройте этот QR-код, чтобы отправить заявку в друзья.
              </p>
              <Button asChild className="w-full">
                <Link to={`/login?returnTo=${encodeURIComponent(`/friend-qr/${token}`)}`}>Войти</Link>
              </Button>
            </>
          ) : status === "loading" ? (
            <div className="py-8">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Проверяем QR-код...</p>
            </div>
          ) : status === "success" ? (
            <>
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
              <p className="text-sm">{message}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button variant="outline" onClick={() => navigate("/profile")}>В профиль</Button>
                <Button onClick={() => navigate("/friend-requests")} className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  Заявки в друзья
                </Button>
              </div>
            </>
          ) : status === "error" ? (
            <>
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{message}</p>
              <p className="text-xs text-muted-foreground">Попросите пользователя открыть «Мой QR-код» ещё раз — код действует 10 минут и используется один раз.</p>
              <Button variant="outline" className="w-full" onClick={() => navigate("/profile")}>Вернуться в профиль</Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default FriendQrLanding;

import { useState } from "react";
import { Heart, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SUPPORT_QR_PATH = "/support-tbank-qr.png";

const SupportProject = () => {
  const [qrAvailable, setQrAvailable] = useState(true);

  return (
    <div className="min-h-full bg-gray-50 p-0 dark:bg-gray-900 sm:p-2 lg:p-4">
      <div className="mx-auto max-w-xl">
        <Card className="overflow-hidden">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Heart className="h-6 w-6" />
            </div>
            <CardTitle>Поддержать проект</CardTitle>
            <CardDescription>
              Если вам нравится SocialBIRD, вы можете добровольно поддержать развитие проекта переводом через QR-код Т-Банка.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="mx-auto flex min-h-[280px] w-full max-w-sm items-center justify-center rounded-2xl border bg-white p-4 shadow-sm dark:bg-white">
              {qrAvailable ? (
                <img
                  src={SUPPORT_QR_PATH}
                  alt="QR-код Т-Банка для поддержки SocialBIRD"
                  className="h-auto max-h-[420px] w-full object-contain"
                  onError={() => setQrAvailable(false)}
                />
              ) : (
                <div className="px-4 text-center text-sm text-gray-700">
                  QR-код ещё не добавлен на сервер. Добавьте файл <code>public/support-tbank-qr.png</code>, после чего он появится здесь автоматически.
                </div>
              )}
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
              <p className="text-foreground/90">
                SocialBIRD показывает только статичное изображение QR-кода. Сайт не получает логин, пароль,
                коды подтверждения или доступ к вашему интернет-банку и не хранит банковские секреты.
              </p>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Поддержка добровольная и не открывает скрытые функции или преимущества в SocialBIRD.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SupportProject;

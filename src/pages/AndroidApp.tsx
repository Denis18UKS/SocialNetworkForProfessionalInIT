import { Download, MonitorSmartphone, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

const APK_URL = "https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android.apk";

const AndroidApp = () => {
  const { language } = useI18n();
  const ru = language === "ru";
  const isNativeAndroid = /SocialBIRDAndroid\//i.test(navigator.userAgent);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          {ru ? "SocialBIRD для Android" : "SocialBIRD for Android"}
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          {ru
            ? "Отдельное Android-приложение с тем же аккаунтом и интерфейсом SocialBIRD, нативным доступом к камере/микрофону и системной демонстрацией экрана через Android MediaProjection."
            : "A dedicated Android app with the same SocialBIRD account and interface, native camera/microphone access and system screen sharing through Android MediaProjection."}
        </p>
      </div>

      {isNativeAndroid && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {ru ? "Вы уже открыли эту страницу внутри Android-приложения SocialBIRD." : "You are already viewing this page inside the SocialBIRD Android app."}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <Smartphone className="mb-2 h-8 w-8" />
            <CardTitle>{ru ? "Отдельное приложение" : "Dedicated app"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {ru ? "Запускается отдельным окном Android, без адресной строки браузера." : "Runs as a standalone Android window without the browser address bar."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MonitorSmartphone className="mb-2 h-8 w-8" />
            <CardTitle>{ru ? "Демонстрация экрана" : "Screen sharing"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {ru ? "Приложение использует системное разрешение Android MediaProjection и передаёт изображение экрана в текущий WebRTC-звонок." : "The app uses Android MediaProjection permission and feeds the captured screen into the current WebRTC call."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <ShieldCheck className="mb-2 h-8 w-8" />
            <CardTitle>{ru ? "Тот же сервер" : "Same server"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {ru ? "Приложение открывает только официальный SocialBIRD. Внешние ссылки передаются обычному браузеру." : "The app only embeds the official SocialBIRD origin. External links are handed to the regular browser."}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{ru ? "Скачать APK" : "Download APK"}</CardTitle>
          <CardDescription>
            {ru ? "Android 8.0 и новее. На первом запуске Android может попросить разрешить установку приложения из браузера/файлового менеджера." : "Android 8.0 or newer. On first install Android may ask you to allow installing apps from your browser/file manager."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild size="lg" className="w-full gap-2 sm:w-auto">
            <a href={APK_URL} download>
              <Download className="h-5 w-5" />
              {ru ? "Скачать SocialBIRD-Android.apk" : "Download SocialBIRD-Android.apk"}
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">
            {ru
              ? "APK собирается автоматически из Android-оболочки production-ветки. Для демонстрации экрана Android всегда показывает системное окно подтверждения — приложение не может включить захват скрытно."
              : "The APK is built automatically from the Android wrapper in the production branch. Android always shows its system confirmation before screen capture; the app cannot start capture silently."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AndroidApp;

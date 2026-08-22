import { useEffect, useState } from "react";
import { BellRing, Download, MonitorSmartphone, ShieldCheck, Smartphone, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { isNativeAndroidApp } from "@/lib/screen-share";

const APK_URL = "https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android.apk";

type NativeBridge = {
  getVersion?: () => string;
  canPostNotifications?: () => boolean;
  canUseFullScreenCalls?: () => boolean;
  openNotificationSettings?: () => void;
  openFullScreenCallSettings?: () => void;
  openBatterySettings?: () => void;
};

const getBridge = (): NativeBridge | undefined =>
  (window as typeof window & { ITBirdAndroid?: NativeBridge }).ITBirdAndroid;

const AndroidApp = () => {
  const { language } = useI18n();
  const ru = language === "ru";
  const native = isNativeAndroidApp();
  const [version, setVersion] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [fullScreenCallsEnabled, setFullScreenCallsEnabled] = useState(false);

  const refreshNativeStatus = () => {
    if (!native) return;
    try { setVersion(String(getBridge()?.getVersion?.() || "")); } catch {}
    try { setNotificationsEnabled(Boolean(getBridge()?.canPostNotifications?.())); } catch {}
    try { setFullScreenCallsEnabled(Boolean(getBridge()?.canUseFullScreenCalls?.())); } catch {}
  };

  useEffect(() => {
    refreshNativeStatus();
    if (!native) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") window.setTimeout(refreshNativeStatus, 250);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refreshNativeStatus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refreshNativeStatus);
    };
  }, [native]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          {ru ? "SocialBIRD для Android" : "SocialBIRD for Android"}
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          {ru
            ? "Это тот же SocialBIRD и тот же React-интерфейс, а не отдельная урезанная копия. Android-слой добавляет только системные возможности: фоновые входящие звонки и сообщения, MediaProjection, системный звук демонстрации, PiP, нативные разрешения, файлы и deep-link переходы."
            : "This is the same SocialBIRD and the same React UI, not a reduced duplicate. The Android layer only adds OS capabilities: background calls/messages, MediaProjection, screen audio, PiP, native permissions, files and deep links."}
        </p>
      </div>

      {native && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {ru
            ? `Вы открыли нативное приложение SocialBIRD${version ? ` v${version}` : ""}. Аккаунт и данные берутся с того же production-сервера.`
            : `You are using the native SocialBIRD app${version ? ` v${version}` : ""}. The account and data come from the same production server.`}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <Smartphone className="mb-2 h-8 w-8" />
            <CardTitle>{ru ? "Один интерфейс" : "One interface"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {ru
              ? "Сайт и приложение используют одну production-версию интерфейса. Новые страницы и исправления сайта автоматически появляются и в приложении."
              : "The website and app use the same production UI. New pages and web fixes automatically appear in the app."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MonitorSmartphone className="mb-2 h-8 w-8" />
            <CardTitle>{ru ? "Экран и звук" : "Screen and audio"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {ru
              ? "Android MediaProjection захватывает экран, а Android 10+ дополнительно пытается передать системный звук разрешённых приложений в текущий WebRTC-звонок."
              : "Android MediaProjection captures the screen; Android 10+ also attempts to send allowed apps' playback audio into the current WebRTC call."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <BellRing className="mb-2 h-8 w-8" />
            <CardTitle>{ru ? "Фоновые звонки" : "Background calls"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {ru
              ? "После входа нативный foreground listener держит отдельный защищённый канал уведомлений. Он не подменяет WebRTC и не съедает очередь сигналов звонка — при ответе звонок продолжает обрабатывать обычный SocialBIRD."
              : "After login, a native foreground listener keeps a protected notification channel. It does not replace WebRTC or consume the call signal queue; the regular SocialBIRD call stack handles the call after you answer."}
          </CardContent>
        </Card>
      </div>

      {native && (
        <Card>
          <CardHeader>
            <CardTitle>{ru ? "Системные возможности" : "System capabilities"}</CardTitle>
            <CardDescription>
              {ru ? "Для надёжных звонков Android должен разрешать уведомления и полноэкранные входящие вызовы." : "For reliable calls, Android should allow notifications and full-screen incoming calls."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{ru ? "Уведомления" : "Notifications"}</div>
                <div className={notificationsEnabled ? "text-emerald-600" : "text-amber-600"}>
                  {notificationsEnabled ? (ru ? "Разрешены" : "Allowed") : (ru ? "Нужно разрешить" : "Permission needed")}
                </div>
              </div>
              <div className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{ru ? "Полноэкранный входящий звонок" : "Full-screen incoming call"}</div>
                <div className={fullScreenCallsEnabled ? "text-emerald-600" : "text-amber-600"}>
                  {fullScreenCallsEnabled ? (ru ? "Разрешён" : "Allowed") : (ru ? "Проверьте разрешение Android" : "Check Android permission")}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => getBridge()?.openNotificationSettings?.()}>
                <BellRing className="mr-2 h-4 w-4" />
                {ru ? "Настройки уведомлений" : "Notification settings"}
              </Button>
              <Button variant="outline" onClick={() => getBridge()?.openFullScreenCallSettings?.()}>
                <ShieldCheck className="mr-2 h-4 w-4" />
                {ru ? "Полноэкранные звонки" : "Full-screen calls"}
              </Button>
              <Button variant="outline" onClick={() => getBridge()?.openBatterySettings?.()}>
                <Zap className="mr-2 h-4 w-4" />
                {ru ? "Энергосбережение Android" : "Android battery settings"}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {ru
                ? "На Honor/MagicOS имеет смысл также разрешить SocialBIRD работать в фоне/автозапускаться в системных настройках батареи. Постоянная тихая плашка SocialBIRD означает, что канал входящих звонков действительно активен."
                : "On Honor/MagicOS it is also useful to allow SocialBIRD background activity/autostart in battery settings. The persistent low-priority SocialBIRD notification means the incoming-call channel is active."}
            </p>
          </CardContent>
        </Card>
      )}

      {!native && (
        <Card>
          <CardHeader>
            <CardTitle>{ru ? "Скачать APK" : "Download APK"}</CardTitle>
            <CardDescription>
              {ru ? "Android 8.0 и новее. APK автоматически пересобирается при изменениях нативного Android-слоя." : "Android 8.0 or newer. The APK is rebuilt automatically whenever the native Android layer changes."}
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
                ? "Для MediaProjection Android всегда показывает системное окно подтверждения. Захват экрана не запускается скрытно."
                : "Android always shows a system confirmation for MediaProjection. Screen capture cannot start silently."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AndroidApp;

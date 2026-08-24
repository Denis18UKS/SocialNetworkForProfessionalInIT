import { useEffect, useMemo, useState } from "react";
import { BellRing, CheckCircle2, Download, MonitorSmartphone, RefreshCw, ShieldCheck, Smartphone, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { apiUrl } from "@/lib/settings";
import { isNativeAndroidApp } from "@/lib/screen-share";

const APK_URL = "https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android.apk";

type NativeBridge = {
  getVersion?: () => string;
  getVersionCode?: () => number;
  canPostNotifications?: () => boolean;
  canUseFullScreenCalls?: () => boolean;
  openNotificationSettings?: () => void;
  openFullScreenCallSettings?: () => void;
  openBatterySettings?: () => void;
};

type AndroidReleaseInfo = {
  available: boolean;
  versionCode?: number;
  versionName?: string;
  apkUrl?: string;
  publishedAt?: string | null;
};

const getBridge = (): NativeBridge | undefined =>
  (window as typeof window & { ITBirdAndroid?: NativeBridge }).ITBirdAndroid;

const AndroidApp = () => {
  const { language } = useI18n();
  const ru = language === "ru";
  const native = isNativeAndroidApp();
  const [version, setVersion] = useState("");
  const [versionCode, setVersionCode] = useState(0);
  const [latest, setLatest] = useState<AndroidReleaseInfo | null>(null);
  const [releaseLoading, setReleaseLoading] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [fullScreenCallsEnabled, setFullScreenCallsEnabled] = useState(false);

  const refreshNativeStatus = () => {
    if (!native) return;
    try { setVersion(String(getBridge()?.getVersion?.() || "")); } catch {}
    try { setVersionCode(Number(getBridge()?.getVersionCode?.() || 0)); } catch {}
    try { setNotificationsEnabled(Boolean(getBridge()?.canPostNotifications?.())); } catch {}
    try { setFullScreenCallsEnabled(Boolean(getBridge()?.canUseFullScreenCalls?.())); } catch {}
  };

  const refreshRelease = async () => {
    setReleaseLoading(true);
    try {
      const response = await fetch(apiUrl("/android/version"), { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data?.available) setLatest(data);
      else setLatest(null);
    } catch {
      setLatest(null);
    } finally {
      setReleaseLoading(false);
    }
  };

  useEffect(() => {
    refreshNativeStatus();
    void refreshRelease();
    if (!native) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        window.setTimeout(refreshNativeStatus, 250);
        window.setTimeout(() => void refreshRelease(), 350);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [native]);

  const updateAvailable = useMemo(() => {
    if (!native || !latest?.available) return false;
    const latestCode = Number(latest.versionCode || 0);
    return latestCode > 0 && versionCode > 0 && latestCode > versionCode;
  }, [native, latest, versionCode]);

  const resolvedApkUrl = latest?.apkUrl || APK_URL;
  const heading = updateAvailable
    ? (ru ? "Обновление приложения" : "App update")
    : (ru ? "SocialBIRD для Android" : "SocialBIRD for Android");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
        <p className="max-w-3xl text-muted-foreground">
          {ru
            ? "Это тот же SocialBIRD и тот же React-интерфейс, а Android-слой добавляет фоновые звонки и сообщения, MediaProjection, системный звук демонстрации, PiP, нативные разрешения, файлы и deep-link переходы."
            : "This is the same SocialBIRD and the same React UI. The Android layer adds background calls/messages, MediaProjection, screen audio, PiP, native permissions, files and deep links."}
        </p>
      </div>

      {native && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${updateAvailable ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
          {updateAvailable
            ? (ru
                ? `Доступно обновление SocialBIRD${latest?.versionName ? ` до v${latest.versionName}` : ""}. Сейчас установлена ${version ? `v${version}` : "более старая версия"}.`
                : `A SocialBIRD update${latest?.versionName ? ` to v${latest.versionName}` : ""} is available. Installed: ${version ? `v${version}` : "an older version"}.`)
            : (ru
                ? `Вы используете SocialBIRD${version ? ` v${version}` : ""}. ${releaseLoading ? "Проверяем обновления…" : latest ? "Установлена актуальная версия." : "Проверить актуальность версии сейчас не удалось."}`
                : `You are using SocialBIRD${version ? ` v${version}` : ""}. ${releaseLoading ? "Checking for updates…" : latest ? "The installed version is current." : "Version status is temporarily unavailable."}`)}
        </div>
      )}

      {native && updateAvailable && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle>{ru ? "Доступно обновление приложения" : "App update available"}</CardTitle>
            <CardDescription>
              {ru
                ? `Новая версия: ${latest?.versionName || "последняя"}. Кнопка появляется только когда versionCode опубликованного APK выше установленного.`
                : `New version: ${latest?.versionName || "latest"}. This button appears only when the published APK versionCode is newer than the installed one.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild className="gap-2">
              <a href={resolvedApkUrl} download>
                <RefreshCw className="h-4 w-4" />
                {ru ? "Обновить приложение" : "Update app"}
              </a>
            </Button>
            <Button variant="outline" onClick={() => void refreshRelease()} disabled={releaseLoading}>
              {ru ? "Проверить ещё раз" : "Check again"}
            </Button>
          </CardContent>
        </Card>
      )}

      {native && !updateAvailable && latest?.available && !releaseLoading && (
        <Card className="border-emerald-500/30">
          <CardContent className="flex items-center gap-3 pt-6 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5" />
            {ru ? "Установлена актуальная версия приложения." : "The current app version is installed."}
          </CardContent>
        </Card>
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
              ? "FCM и нативный Android-слой поднимают системное уведомление о сообщениях и входящих звонках, когда приложение свёрнуто или выгружено из недавних."
              : "FCM and the native Android layer raise OS notifications for messages and incoming calls when the app is backgrounded or removed from recents."}
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
          </CardContent>
        </Card>
      )}

      {!native && (
        <Card>
          <CardHeader>
            <CardTitle>{ru ? "Скачать приложение" : "Download app"}</CardTitle>
            <CardDescription>
              {ru ? "Android 8.0 и новее. После установки приложение само сможет определить, когда опубликована более новая версия APK." : "Android 8.0 or newer. Once installed, the app can determine when a newer APK is actually published."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild size="lg" className="w-full gap-2 sm:w-auto">
              <a href={resolvedApkUrl} download>
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

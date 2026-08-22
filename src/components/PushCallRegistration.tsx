import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/settings";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/pages/AuthContext";

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

const subscribeForPush = async (token: string) => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;

  const keyResponse = await fetch(apiUrl("/push/public-key"));
  if (!keyResponse.ok) return false;
  const { publicKey } = await keyResponse.json();
  if (!publicKey) return false;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(publicKey),
    });
  }

  const response = await fetch(apiUrl("/push/subscribe"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  return response.ok;
};

const PushCallRegistration = () => {
  const { isAuthenticated } = useAuth();
  const { language } = useI18n();
  const isEnglish = language === "en";
  const [showPrompt, setShowPrompt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unsupportedIos, setUnsupportedIos] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setShowPrompt(false);
      return;
    }
    const token = localStorage.getItem("token");
    if (!token || !("Notification" in window) || !("serviceWorker" in navigator)) return;

    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches === true
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isIos && !standalone) setUnsupportedIos(true);

    if (Notification.permission === "granted") {
      void subscribeForPush(token).catch(() => undefined);
      return;
    }
    if (Notification.permission === "default") setShowPrompt(true);
  }, [isAuthenticated]);

  const enable = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        await subscribeForPush(token);
        setShowPrompt(false);
      } else {
        setShowPrompt(false);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-[calc(0.75rem+var(--mobile-visible-bottom,var(--mobile-safe-bottom)))] left-1/2 z-[80] w-[min(440px,calc(100vw-20px))] -translate-x-1/2 rounded-2xl border border-border bg-background/95 p-3 shadow-2xl backdrop-blur">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {isEnglish ? "Don't miss incoming calls" : "Не пропускать входящие звонки"}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isEnglish
              ? "Allow push notifications to receive incoming calls while SocialBIRD is in the background."
              : "Разрешите push-уведомления, чтобы получать входящий звонок, когда SocialBIRD находится в фоне."}
            {unsupportedIos
              ? (isEnglish
                ? " On iPhone, first add SocialBIRD to the Home Screen, then open the installed web app."
                : " На iPhone сначала добавьте SocialBIRD на экран «Домой», затем откройте установленное приложение.")
              : ""}
          </p>
          <Button type="button" size="sm" className="mt-3" disabled={loading || unsupportedIos} onClick={enable}>
            {loading
              ? (isEnglish ? "Enabling..." : "Подключаем...")
              : (isEnglish ? "Enable background calls" : "Включить звонки в фоне")}
          </Button>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setShowPrompt(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default PushCallRegistration;

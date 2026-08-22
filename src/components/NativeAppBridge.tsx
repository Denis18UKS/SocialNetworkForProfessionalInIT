import { useEffect } from "react";
import { useAuth } from "@/pages/AuthContext";
import { useI18n } from "@/lib/i18n";
import { isNativeAndroidApp } from "@/lib/screen-share";

type NativeBridge = {
  syncAuthToken?: (token: string) => void;
  setAppLanguage?: (language: string) => void;
  setCallActive?: (active: boolean) => void;
};

const getBridge = (): NativeBridge | undefined =>
  (window as typeof window & { ITBirdAndroid?: NativeBridge }).ITBirdAndroid;

const consumeNativeAnswerAction = () => {
  if (!document.cookie.split(";").some((item) => item.trim() === "itbird_native_answer=1")) return false;
  document.cookie = "itbird_native_answer=; Max-Age=0; Path=/; Secure; SameSite=Strict";
  try { sessionStorage.setItem("itbird-native-answer-call", "1"); } catch {}
  window.dispatchEvent(new Event("itbird-native-answer-call"));
  return true;
};

/**
 * Keeps Android OS integrations synchronized with the exact same authenticated
 * React session used by the website. The native layer owns only OS-only features
 * such as background notifications, system call UI, PiP and MediaProjection.
 */
const NativeAppBridge = () => {
  const { isAuthenticated } = useAuth();
  const { language } = useI18n();

  useEffect(() => {
    if (!isNativeAndroidApp()) return;

    const sync = () => {
      const token = isAuthenticated ? (localStorage.getItem("token") || "") : "";
      try { getBridge()?.syncAuthToken?.(token); } catch {}
    };

    sync();
    window.addEventListener("itbird-native-ready", sync);
    return () => window.removeEventListener("itbird-native-ready", sync);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isNativeAndroidApp()) return;
    try { getBridge()?.setAppLanguage?.(language); } catch {}
  }, [language]);

  useEffect(() => {
    if (!isNativeAndroidApp()) return;

    const markActive = () => {
      try { getBridge()?.setCallActive?.(true); } catch {}
    };
    const markEnded = () => {
      try { getBridge()?.setCallActive?.(false); } catch {}
    };
    const handleNativeState = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      try { getBridge()?.setCallActive?.(Boolean(detail?.active)); } catch {}
    };

    window.addEventListener("itbird-call-active", markActive);
    window.addEventListener("itbird-call-ended", markEnded);
    window.addEventListener("itbird-native-call-state", handleNativeState);
    return () => {
      window.removeEventListener("itbird-call-active", markActive);
      window.removeEventListener("itbird-call-ended", markEnded);
      window.removeEventListener("itbird-native-call-state", handleNativeState);
    };
  }, []);

  useEffect(() => {
    if (!isNativeAndroidApp()) return;

    let timer: number | null = null;
    const consume = () => {
      if (consumeNativeAnswerAction() && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    consume();
    // Covers cold starts where Android writes the one-shot cookie while WebView is
    // still loading, plus returning from a full-screen incoming-call notification.
    timer = window.setInterval(consume, 250);
    window.setTimeout(() => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    }, 8000);

    window.addEventListener("focus", consume);
    document.addEventListener("visibilitychange", consume);
    window.addEventListener("itbird-native-ready", consume);

    return () => {
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener("focus", consume);
      document.removeEventListener("visibilitychange", consume);
      window.removeEventListener("itbird-native-ready", consume);
    };
  }, []);

  return null;
};

export default NativeAppBridge;

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

/**
 * Keeps Android OS integrations synchronized with the exact same authenticated
 * React session used by the website. The native layer owns only OS-level
 * capabilities that the browser cannot provide reliably in the background.
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

  return null;
};

export default NativeAppBridge;

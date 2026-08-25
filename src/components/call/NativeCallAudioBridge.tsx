import { useEffect, useRef } from "react";
import { isNativeAndroidApp } from "@/lib/screen-share";
import type { CallSnapshot } from "@/components/call/CallProvider";

type AndroidBridge = {
  setSpeakerphone?: (enabled: boolean) => void;
};

const invokeCustomScheme = (command: "active" | "speaker", enabled: boolean) => {
  const href = `socialbird-call://${command}?enabled=${enabled ? "1" : "0"}`;
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.style.display = "none";
  anchor.setAttribute("aria-hidden", "true");
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => anchor.remove(), 0);
};

const setSpeakerRoute = (enabled: boolean) => {
  const bridge = (window as typeof window & { ITBirdAndroid?: AndroidBridge }).ITBirdAndroid;
  if (typeof bridge?.setSpeakerphone === "function") {
    try {
      bridge.setSpeakerphone(enabled);
      return;
    } catch {}
  }
  invokeCustomScheme("speaker", enabled);
};

/**
 * Keeps Android's native communication audio route synchronized with the single
 * CallProvider state. New APKs can use the dedicated Java bridge; older MainActivity
 * builds can still reach CallControlActivity through the registered custom scheme.
 */
const NativeCallAudioBridge = () => {
  const activeRef = useRef(false);
  const speakerRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!isNativeAndroidApp()) return;

    const apply = (state: CallSnapshot | null) => {
      const active = Boolean(state);
      if (activeRef.current !== active) {
        activeRef.current = active;
        invokeCustomScheme("active", active);
      }
      if (state && speakerRef.current !== state.speakerEnabled) {
        speakerRef.current = state.speakerEnabled;
        setSpeakerRoute(state.speakerEnabled);
      }
      if (!state) speakerRef.current = null;
    };

    const onState = (event: Event) => {
      apply((event as CustomEvent<CallSnapshot | null>).detail || null);
    };

    const initial = (window as typeof window & { __itbirdActiveCallState?: CallSnapshot | null }).__itbirdActiveCallState || null;
    apply(initial);
    window.addEventListener("itbird-call-state", onState);
    return () => {
      window.removeEventListener("itbird-call-state", onState);
      if (activeRef.current) invokeCustomScheme("active", false);
      activeRef.current = false;
    };
  }, []);

  return null;
};

export default NativeCallAudioBridge;

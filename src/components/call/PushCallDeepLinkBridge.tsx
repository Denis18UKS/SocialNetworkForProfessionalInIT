import { useEffect } from "react";
import { useCallManager } from "@/components/call/CallProvider";

const NATIVE_ANSWER_KEY = "itbird-native-answer-call";

/**
 * Unifies all Android/PWA notification Answer paths:
 * 1) cold-start deep-link query from FCM,
 * 2) MainActivity's native answer event/sessionStorage fallback,
 * 3) service-worker messages handled inside CallProvider.
 *
 * acceptIncoming() is intentionally safe before CALL_INVITE/CALL_OFFER arrives:
 * CallProvider remembers the auto-answer request and completes it after WS auth.
 */
const PushCallDeepLinkBridge = () => {
  const { acceptIncoming, declineIncoming } = useCallManager();

  useEffect(() => {
    const consumeNativeAnswer = () => {
      try { sessionStorage.removeItem(NATIVE_ANSWER_KEY); } catch {}
      void acceptIncoming();
    };

    const url = new URL(window.location.href);
    const action = url.searchParams.get("sb_call_action");
    if (action === "answer" || action === "decline") {
      url.searchParams.delete("sb_call_action");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      if (action === "answer") consumeNativeAnswer();
      else declineIncoming();
    } else {
      try {
        if (sessionStorage.getItem(NATIVE_ANSWER_KEY) === "1") consumeNativeAnswer();
      } catch {}
    }

    const onNativeAnswer = () => consumeNativeAnswer();
    window.addEventListener("itbird-native-answer-call", onNativeAnswer);
    return () => window.removeEventListener("itbird-native-answer-call", onNativeAnswer);
  }, [acceptIncoming, declineIncoming]);

  return null;
};

export default PushCallDeepLinkBridge;

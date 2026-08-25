import { useEffect } from "react";
import { useCallManager } from "@/components/call/CallProvider";

/**
 * Cold-start fallback for native Android notifications. The OS can launch the
 * WebView before any JavaScript event bridge exists, so the Answer action is also
 * encoded in the route as sb_call_action=answer. CallProvider remembers the
 * auto-answer request until CALL_INVITE/CALL_OFFER arrives over the authenticated WS.
 */
const PushCallDeepLinkBridge = () => {
  const { acceptIncoming, declineIncoming } = useCallManager();

  useEffect(() => {
    const url = new URL(window.location.href);
    const action = url.searchParams.get("sb_call_action");
    if (action !== "answer" && action !== "decline") return;

    url.searchParams.delete("sb_call_action");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

    if (action === "answer") void acceptIncoming();
    else declineIncoming();
  }, [acceptIncoming, declineIncoming]);

  return null;
};

export default PushCallDeepLinkBridge;

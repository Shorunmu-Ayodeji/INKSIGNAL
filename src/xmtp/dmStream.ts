import type { DecodedMessage } from "@xmtp/browser-sdk";
import { errorMessage, type XmtpClient } from "./XmtpProvider";

export interface DmStreamHandlers {
  // Initial load (first start) and gap-filling resync (after a drop) respectively.
  refresh: () => Promise<void>;
  resync: (isCancelled: () => boolean) => Promise<void>;
  onMessage: (m: DecodedMessage) => void;
  onReady: () => void;
  onError: (message: string | null) => void;
}

// Streams all DM messages and reconnects with backoff on transient failures. Returns a cleanup.
export function runDmStream(client: XmtpClient, h: DmStreamHandlers): () => void {
  let cancelled = false;
  let stream: { end: () => Promise<unknown> } | undefined;
  let retryTimer: number | undefined;
  let retryDelay = 2000;
  let starting = false;

  const scheduleReconnect = () => {
    if (cancelled || retryTimer !== undefined) return;
    const old = stream;
    stream = undefined;
    void old?.end().catch(() => undefined);
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined;
      void start(true);
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  };

  const start = async (isRetry: boolean) => {
    if (starting || cancelled) return;
    starting = true;
    try {
      if (isRetry) await h.resync(() => cancelled);
      else await h.refresh();
      if (cancelled) return;
      h.onReady();
      const s = await client.conversations.streamAllDmMessages({
        onValue: h.onMessage,
        onError: scheduleReconnect,
        onFail: scheduleReconnect,
      });
      if (cancelled) {
        void s.end().catch(() => undefined);
        return;
      }
      stream = s;
      retryDelay = 2000;
      h.onError(null);
    } catch (err) {
      if (cancelled) return;
      h.onReady();
      if (isRetry || navigator.onLine === false) {
        scheduleReconnect();
      } else {
        h.onError(errorMessage(err));
      }
    } finally {
      starting = false;
    }
  };

  const onOnline = () => {
    if (retryTimer !== undefined) {
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    retryDelay = 2000;
    if (!stream) void start(true);
  };
  window.addEventListener("online", onOnline);

  // The SDK ends a failed stream internally without catching the worker's "Stream not found"
  // rejection (the worker already dropped it), so it can't be handled at the call site.
  const onUnhandled = (e: PromiseRejectionEvent) => {
    const msg = (e.reason as { message?: unknown } | undefined)?.message;
    if (typeof msg === "string" && /^Stream ".*" not found$/.test(msg)) e.preventDefault();
  };
  window.addEventListener("unhandledrejection", onUnhandled);

  void start(false);

  return () => {
    cancelled = true;
    window.removeEventListener("unhandledrejection", onUnhandled);
    window.removeEventListener("online", onOnline);
    window.clearTimeout(retryTimer);
    void stream?.end().catch(() => undefined);
  };
}

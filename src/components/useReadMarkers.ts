import { useState } from "react";

export function useReadMarkers(owner: string | undefined) {
  const key = `inksignal:read:${owner ?? ""}`;
  const [read, setRead] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "{}");
    } catch {
      return {};
    }
  });
  function markRead(threadId: string, sentAtNs: bigint) {
    setRead((prev) => {
      if (prev[threadId] && BigInt(prev[threadId]) >= sentAtNs) return prev;
      const next = { ...prev, [threadId]: sentAtNs.toString() };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }
  return { read, markRead };
}

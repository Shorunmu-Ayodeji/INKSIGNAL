import { useCallback, useEffect, useState } from "react";

export const CONTACT_NAME_MAX = 32;

// Nicknames are private to this browser and scoped to the signed-in wallet.
function storageKey(selfAddress: string) {
  return `inksignal:contacts:${selfAddress.toLowerCase()}`;
}

function read(selfAddress: string): Record<string, string> {
  const raw = localStorage.getItem(storageKey(selfAddress));
  if (raw === null) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string" && v) out[k] = v.slice(0, CONTACT_NAME_MAX);
  }
  return out;
}

export function useContactNames(selfAddress: string | undefined) {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!selfAddress) {
      setNames({});
      return;
    }
    try {
      setNames(read(selfAddress));
    } catch {
      setNames({});
    }
  }, [selfAddress]);

  // Throws if storage is unavailable so the caller can show the failure.
  const setName = useCallback(
    (contactId: string, name: string) => {
      if (!selfAddress) throw new Error("No wallet connected.");
      const next = { ...names };
      const trimmed = name.trim().slice(0, CONTACT_NAME_MAX);
      if (trimmed) next[contactId] = trimmed;
      else delete next[contactId];
      localStorage.setItem(storageKey(selfAddress), JSON.stringify(next));
      setNames(next);
    },
    [selfAddress, names],
  );

  return { names, setName };
}

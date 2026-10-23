import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Client } from "@xmtp/browser-sdk";
import { useAccount, useSignMessage } from "wagmi";
import { createWalletSigner, toIdentifier } from "./signer";
import { acquireTabLock } from "./tabLock";

export const XMTP_ENV = import.meta.env.VITE_XMTP_ENV === "dev" ? "dev" : "production";

export type XmtpStatus =
  | "disconnected" // no wallet connected
  | "idle" // wallet connected, messaging not enabled yet
  | "resuming" // restoring a previously registered local client
  | "signing" // waiting for the wallet signature / network registration
  | "ready"
  | "locked" // another tab owns the local XMTP database
  | "error";

export type XmtpClient = Awaited<ReturnType<typeof Client.create>>;

interface XmtpContextValue {
  client: XmtpClient | null;
  status: XmtpStatus;
  error: string | null;
  enable: () => Promise<void>;
}

const XmtpContext = createContext<XmtpContextValue | null>(null);

const registeredKey = (address: string) =>
  `inksignal:registered:${XMTP_ENV}:${address.toLowerCase()}`;

type CreateOptions = NonNullable<Parameters<typeof Client.create>[1]>;

// The client runs in a Web Worker, so options must be structured-cloneable: a
// `Backend` built on the main thread cannot be passed. The SDK's
// `Omit<ClientOptions, "codecs">` typing collapses its union and rejects `env`,
// although it is valid at runtime, so the cast is confined here.
const clientOptions = {
  env: XMTP_ENV,
  appVersion: "inksignal/0.1.0",
} as unknown as CreateOptions;

// A superseded attempt can briefly still hold the lock, so retry for a moment
// before concluding that another tab owns it.
async function acquireWithRetry(name: string): Promise<(() => void) | null> {
  for (let i = 0; i < 10; i++) {
    const release = await acquireTabLock(name);
    if (release) return release;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

export function errorMessage(err: unknown): string {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "Something went wrong.";
  if (/registered \d+\/\d+ installations/i.test(message)) {
    return `${message} XMTP allows 10 devices/browsers per wallet identity; revoke an old installation with an XMTP app, then try again.`;
  }
  if (/user rejected|denied|rejected the request/i.test(message)) {
    return "The signature request was rejected in your wallet. Approve it to enable messaging.";
  }
  return message;
}

export function XmtpProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [client, setClient] = useState<XmtpClient | null>(null);
  const [status, setStatus] = useState<XmtpStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);

  const attempt = useRef(0);
  const clientRef = useRef<XmtpClient | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);

  const teardown = useCallback(() => {
    attempt.current++;
    clientRef.current?.close();
    clientRef.current = null;
    releaseRef.current?.();
    releaseRef.current = null;
    setClient(null);
  }, []);

  const start = useCallback(
    async (account: `0x${string}`, mode: "resume" | "create") => {
      const id = ++attempt.current;
      const superseded = () => id !== attempt.current;

      setError(null);
      setStatus(mode === "create" ? "signing" : "resuming");

      const release = await acquireWithRetry("inksignal-xmtp-client");
      if (superseded()) {
        release?.();
        return;
      }
      if (!release) {
        setStatus("locked");
        return;
      }

      let created: XmtpClient | undefined;
      try {
        if (mode === "resume") {
          const built = await Client.build(toIdentifier(account), clientOptions);
          created = built;
          if (!(await built.isRegistered())) {
            throw new Error("No registered local XMTP client for this wallet.");
          }
        } else {
          created = await Client.create(
            createWalletSigner(account, (message) => signMessageAsync({ message })),
            clientOptions,
          );
        }

        if (superseded()) {
          created.close();
          release();
          return;
        }

        localStorage.setItem(registeredKey(account), "1");
        clientRef.current = created;
        releaseRef.current = release;
        setClient(created);
        setStatus("ready");
      } catch (err) {
        created?.close();
        release();
        if (superseded()) return;
        if (mode === "resume") {
          localStorage.removeItem(registeredKey(account));
          setStatus("idle");
        } else {
          setError(errorMessage(err));
          setStatus("error");
        }
      }
    },
    [signMessageAsync],
  );

  useEffect(() => {
    teardown();
    setError(null);

    if (!address) {
      setStatus("disconnected");
      return;
    }

    if (localStorage.getItem(registeredKey(address))) {
      void start(address, "resume");
    } else {
      setStatus("idle");
    }

    return teardown;
    // Only an account change should restart the client, not `start` changing.
  }, [address]);

  const enable = useCallback(async () => {
    if (address) await start(address, "create");
  }, [address, start]);

  const value = useMemo(
    () => ({ client, status, error, enable }),
    [client, status, error, enable],
  );

  return <XmtpContext.Provider value={value}>{children}</XmtpContext.Provider>;
}

export function useXmtp(): XmtpContextValue {
  const ctx = useContext(XmtpContext);
  if (!ctx) throw new Error("useXmtp must be used within XmtpProvider");
  return ctx;
}

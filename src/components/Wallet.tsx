import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { ink } from "../wagmi";
import { shortAddress } from "../format";

export function ConnectOptions() {
  const { connectors, connect, isPending, error } = useConnect();

  // Prefer wallets announced via EIP-6963; the generic `injected` connector is
  // only useful when a wallet exposes window.ethereum without announcing itself.
  const discovered = connectors.filter((c) => c.id !== "injected");
  const options =
    discovered.length > 0
      ? discovered
      : "ethereum" in window
        ? connectors
        : [];

  if (options.length === 0) {
    return <p className="note">No browser wallet detected. Install a wallet extension and reload.</p>;
  }

  return (
    <div className="connect-options">
      {options.map((connector) => (
        <button
          key={connector.uid}
          className="btn btn--primary"
          disabled={isPending}
          onClick={() => connect({ connector, chainId: ink.id })}
        >
          {connector.icon && <img src={connector.icon} alt="" width={20} height={20} />}
          {isPending ? "Connecting…" : `Connect ${connector.name}`}
        </button>
      ))}
      {error && <p className="note note--error">{error.message}</p>}
    </div>
  );
}

const NAME_MAX = 32;

function profileKey(address: string) {
  return `inksignal:profile:${address.toLowerCase()}`;
}

// Name is the only profile field; older saved records may carry extra fields, which are ignored.
function loadName(address: string): string {
  const saved = localStorage.getItem(profileKey(address));
  if (saved === null) return "";
  const parsed: unknown = JSON.parse(saved);
  if (typeof parsed === "object" && parsed !== null && "name" in parsed && typeof parsed.name === "string") {
    return parsed.name.slice(0, NAME_MAX);
  }
  throw new Error("Saved profile data is invalid. Save a new name to replace it.");
}

// Deterministic gradient from the address so every wallet gets a distinct, stable avatar.
function avatarStyle(address: string) {
  const hue = parseInt(address.slice(2, 8), 16) % 360;
  const hue2 = (hue + 40 + (parseInt(address.slice(8, 12), 16) % 80)) % 360;
  return { background: `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${hue2} 75% 42%))` };
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function AccountBar() {
  const { address, chainId, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setEditing(false);
    setOpen(false);
    setError(null);
    if (!address) {
      setName("");
      return;
    }
    try {
      setName(loadName(address));
    } catch (err) {
      setName("");
      setError(err instanceof Error ? err.message : "Could not load your saved profile.");
    }
  }, [address]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  if (!address) return null;

  const connectedAddress = address;
  const onInk = chainId === ink.id;

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(connectedAddress);
      setError(null);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      setCopied(false);
      setError(err instanceof Error ? `Could not copy: ${err.message}` : "Could not copy address.");
    }
  }

  function startEditing() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function saveName(e: FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    try {
      if (next) {
        localStorage.setItem(profileKey(connectedAddress), JSON.stringify({ name: next }));
      } else {
        localStorage.removeItem(profileKey(connectedAddress));
      }
      setName(next);
      setError(null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? `Could not save: ${err.message}` : "Could not save profile.");
    }
  }

  return (
    <div className="account" ref={rootRef}>
      <button
        className="account__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={`dot${onInk ? " dot--ok" : " dot--warn"}`} aria-hidden="true" />
        <span className="avatar avatar--sm" style={avatarStyle(connectedAddress)} aria-hidden="true" />
        <span className="account__label">{name || shortAddress(connectedAddress)}</span>
        <svg className={`caret${open ? " caret--open" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="menu" role="dialog" aria-label="Account">
          <div className="menu__head">
            <span className="avatar" style={avatarStyle(connectedAddress)} aria-hidden="true" />
            <div className="menu__id">
              {editing ? (
                <form className="menu__edit" onSubmit={saveName}>
                  <input
                    className="menu__input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={NAME_MAX}
                    placeholder="Display name"
                    aria-label="Display name"
                    autoFocus
                  />
                  <button className="menu__link menu__link--strong" type="submit">Save</button>
                  <button className="menu__link" type="button" onClick={() => setEditing(false)}>Cancel</button>
                </form>
              ) : (
                <>
                  <span className="menu__name">{name || "Unnamed wallet"}</span>
                  <button className="menu__link" onClick={startEditing}>
                    {name ? "Edit name" : "Set a display name"}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="menu__section">
            <span className="menu__caption">Address</span>
            <button className="menu__address" onClick={() => void copyAddress()} title="Copy address">
              <span>{connectedAddress}</span>
              <span className={`menu__copy${copied ? " menu__copy--done" : ""}`}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "Copied" : "Copy"}
              </span>
            </button>
          </div>

          <div className="menu__section menu__row">
            <div>
              <span className="menu__caption">Network</span>
              <span className="menu__value">
                <span className={`dot${onInk ? " dot--ok" : " dot--warn"}`} aria-hidden="true" />
                {onInk ? "Ink" : "Wrong network"}
              </span>
            </div>
            {!onInk && (
              <button
                className="menu__pill"
                disabled={switching}
                onClick={() => switchChain({ chainId: ink.id })}
              >
                {switching ? "Switching…" : "Switch to Ink"}
              </button>
            )}
          </div>

          <div className="menu__section menu__row">
            <div>
              <span className="menu__caption">Wallet</span>
              <span className="menu__value">{connector?.name ?? "Connected"}</span>
            </div>
          </div>

          {(error || switchError) && (
            <p className="menu__error" role="alert">{error ?? switchError?.message}</p>
          )}

          <p className="menu__hint">Your name is stored on this device only and isn’t shared.</p>

          <button className="menu__disconnect" onClick={() => disconnect()}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

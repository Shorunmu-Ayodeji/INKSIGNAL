import { useState, type FormEvent } from "react";
import type { LookupResult } from "../xmtp/useInbox";
import { errorMessage } from "../xmtp/XmtpProvider";
import { shortAddress } from "../format";

export function Compose({
  lookup,
  selfAddress,
  onOpen,
}: {
  lookup: (input: string) => Promise<LookupResult>;
  selfAddress?: string;
  onOpen: (address: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (selfAddress && value.trim().toLowerCase() === selfAddress.toLowerCase()) {
        setResult({ state: "invalid", message: "That is your own wallet address." });
        return;
      }
      const r = await lookup(value);
      setResult(r);
      if (r.state === "reachable") {
        await onOpen(r.address);
        setValue("");
        setResult(null);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="compose" onSubmit={submit}>
      <label htmlFor="recipient" className="label">
        New message
      </label>
      <div className="compose__row">
        <input
          id="recipient"
          className="input input--mono"
          placeholder="Wallet address (0x…) or ENS name"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setResult(null);
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn btn--primary" type="submit" disabled={busy || value.trim() === ""}>
          {busy ? "Looking up…" : "Start"}
        </button>
      </div>
      {result?.state === "invalid" && <p className="note note--error">{result.message}</p>}
      {result?.state === "unreachable" && (
        <p className="note note--error">
          {shortAddress(result.address)} hasn’t enabled XMTP messaging yet, so it can’t receive messages. Ask
          them to open INKSIGNAL (or any XMTP app) and sign in with that wallet.
        </p>
      )}
      {error && <p className="note note--error">{error}</p>}
    </form>
  );
}

import { useAccount } from "wagmi";
import { Brand } from "./components/Brand";
import { AccountBar, ConnectOptions } from "./components/Wallet";
import { Messenger } from "./components/Messenger";
import { ThemeToggle } from "./components/ThemeToggle";
import { XMTP_ENV, useXmtp } from "./xmtp/XmtpProvider";

function Gate() {
  const { isConnected } = useAccount();
  const { client, status, error, enable } = useXmtp();

  if (!isConnected) {
    return (
      <div className="hero">
        <h1>Your wallet. Your signal.</h1>
        <p>
          End-to-end encrypted, wallet-to-wallet messaging for the Ink ecosystem. Connect a wallet, look up
          any address, and talk — no accounts, no phone numbers.
        </p>
        <ConnectOptions />
      </div>
    );
  }

  if (status === "ready" && client) return <Messenger client={client} />;

  return (
    <div className="hero hero--compact">
      {status === "resuming" && <h2>Restoring your secure inbox…</h2>}
      {status === "signing" && (
        <>
          <h2>Waiting for your wallet…</h2>
          <p>Approve the signature request in your wallet to register your XMTP identity.</p>
        </>
      )}
      {status === "locked" && (
        <>
          <h2>INKSIGNAL is open in another tab</h2>
          <p>
            Your encrypted local database can only be used by one tab at a time. Close the other tab, then
            reload this page.
          </p>
        </>
      )}
      {(status === "idle" || status === "error") && (
        <>
          <h2>Enable secure messaging</h2>
          <p>
            Sign one message with your wallet to create your XMTP identity ({XMTP_ENV} network). It costs no
            gas and sends no transaction.
          </p>
          {error && <p className="note note--error">{error}</p>}
          <button className="btn btn--primary" type="button" onClick={() => void enable()}>
            {status === "error" ? "Try again" : "Enable messaging"}
          </button>
        </>
      )}
    </div>
  );
}

export function App() {
  const { isConnected } = useAccount();
  return (
    <div className="app">
      <header className="topbar">
        <Brand inverse />
        <div className="topbar__actions">
          {!isConnected && <ThemeToggle />}
          <AccountBar />
        </div>
      </header>
      <main className="main">
        <Gate />
      </main>
      <footer className="footer">
        INKSIGNAL by 9thstreet · Messages are encrypted and delivered over XMTP · Ink is the wallet network,
        nothing is written on-chain
      </footer>
    </div>
  );
}

# INKSIGNAL

**INKSIGNAL by 9thstreet** — *Your wallet. Your signal.*

INKSIGNAL is a wallet-to-wallet messaging MVP for the [Ink](https://inkonchain.com) ecosystem. Connect a wallet, look up any wallet address, and exchange end-to-end encrypted messages. Messaging runs on the [XMTP](https://xmtp.org) network. There is no custom smart contract and no backend.

## What works

- **Wallet connection** via wagmi (EIP-6963 wallet discovery), targeting the Ink chain (id `57073`) with a one-click "Switch to Ink".
- **Account menu**: click your address in the top bar to copy the full address, set a display name, check or switch network, and disconnect. The avatar is generated from the address. Names are saved per wallet in this browser only and are not shared.
- **XMTP identity** created from a single wallet signature (no gas, no transaction). Returning users are restored from the local database without signing again.
- **Recipient lookup by wallet address**: validates the address, then asks the XMTP network whether it can receive messages. Unreachable wallets are reported honestly, not faked.
- **Real encrypted messaging**: send and receive text DMs, with live updates through XMTP streams and persistent history.

## Stack and verified versions

| Package | Version |
|---|---|
| React / React DOM | 19.3 |
| Vite | 8.3 |
| TypeScript | 7.0 |
| wagmi | 3.7 |
| viem | 2.57 |
| @tanstack/react-query | 5.104 |
| @xmtp/browser-sdk | 7.1 |

Requires **Node 22+** (an `@xmtp/browser-sdk` requirement).

## Getting started

```bash
npm install
npm run dev        # development server
npm run build      # typecheck + production build
npm run preview    # serve the production build
```

Optional configuration (see [.env.example](./.env.example)):

| Variable | Default | Description |
|---|---|---|
| `VITE_XMTP_ENV` | `production` | `production` or `dev`. Both sides of a conversation must use the same network. |

To try it you need two wallets that have each enabled messaging in INKSIGNAL (or any XMTP app).

## Architecture

```
src/
  wagmi.ts                 wagmi config (Ink chain, injected / EIP-6963 connectors)
  xmtp/
    signer.ts              adapts the connected wagmi wallet to XMTP's EOA signer
    XmtpProvider.tsx       client lifecycle: create / resume / teardown, single-tab lock
    useInbox.ts            lookup, conversations, history, live stream, send
    tabLock.ts             Web Locks guard for the single-connection OPFS database
  components/              Brand, Wallet, Messenger
  App.tsx                  connect → enable messaging → inbox flow
```

## Things worth knowing

- **Ink and XMTP:** Ink is the wallet network. XMTP identities are tied to the wallet address and are chain-agnostic, so messages travel over XMTP, not Ink. Nothing is written on-chain.
- **Local profiles:** display names are stored in this browser only, keyed by wallet address. They are not visible to other users and are cleared if this site's browser storage is cleared.
- **One tab at a time:** the XMTP browser SDK stores data in OPFS with a single-connection VFS. INKSIGNAL uses a Web Lock and tells you if another tab already owns it.
- **Installation limit:** XMTP allows 10 installations (browsers/devices) per wallet identity. Clearing site data and re-enabling counts as a new installation.
- **Worker options:** the SDK runs in a Web Worker, so the client is configured with plain network options (`env`) instead of a pre-built `Backend` object, which cannot cross `postMessage`.
- **Wallet types:** externally-owned accounts (EOA) are supported. Smart-contract wallets would need XMTP's SCW signer and are out of scope for this MVP.
- **Text only:** other content types (attachments, reactions, groups) and consent management are not implemented.
- **Build warning:** Vite prints a `node:worker_threads` externalization warning from a wagmi dependency (`ox`). It is benign.

## Brand

Design tokens (see [src/styles.css](./src/styles.css)):

| Token | Value |
|---|---|
| Ink Purple | `#7132F5` |
| Black | `#000000` |
| White | `#FFFFFF` |
| Light Purple | `#9E70FF` |
| Soft Purple | `#F2ECFF` |

The Ink mark in [public/brand/ink-icon.svg](./public/brand/ink-icon.svg) was downloaded from the official Ink documentation site (`docs.inkonchain.com/img/icons/ink-icon.svg`). Check Ink's brand guidelines before any commercial use, and replace it with the full official brand kit if you have one.

## Roadmap ideas

Message requests and consent (allow/deny), group chats, ENS/Ink name lookup, read receipts, and smart-contract wallet support.

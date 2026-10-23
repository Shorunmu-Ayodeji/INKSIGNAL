import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  summarizeReactions,
  useInbox,
  type ChatMessage,
  type LookupResult,
  type ReactionEvent,
  type ReplyRef,
  type Thread,
} from "../xmtp/useInbox";
import { errorMessage, XMTP_ENV, type XmtpClient } from "../xmtp/XmtpProvider";
import { shortAddress } from "../format";
import { useAccount, useDisconnect } from "wagmi";
import { ThemeToggle } from "./ThemeToggle";
import { ink } from "../wagmi";

import { CONTACT_NAME_MAX, useContactNames } from "../contacts";

function threadTitle(t: Thread, names: Record<string, string>): string {
  return (
    names[t.peerInboxId] ??
    (t.peerAddress ? shortAddress(t.peerAddress) : `inbox ${t.peerInboxId.slice(0, 8)}…`)
  );
}

const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function timeLabel(d: Date): string {
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function Avatar({ seed, label, size = 36 }: { seed: string; label: string; size?: number }) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = label.replace(/^0x/i, "").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2) || "?";
  return (
    <span
      className="peer-avatar"
      aria-hidden="true"
      style={{
        ["--avatar-size" as string]: `${size}px`,
        background: `linear-gradient(135deg, hsl(${hash % 360} 65% 50%), hsl(${(hash + 40) % 360} 65% 38%))`,
      }}
    >
      {initials}
    </span>
  );
}

function useReadMarkers(owner: string | undefined) {
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

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function Messenger({ client }: { client: XmtpClient }) {
  const inbox = useInbox(client);
  const { names, setName } = useContactNames(client.accountIdentifier?.identifier);
  const { read, markRead } = useReadMarkers(client.accountIdentifier?.identifier);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    inbox.threads.find((t) => t.id === selectedId) ?? inbox.requests.find((t) => t.id === selectedId) ?? null;
  const selectedIsRequest = !!selected && inbox.requests.some((t) => t.id === selected.id);
  const selfInboxId = client.inboxId ?? "";
  const { address: walletAddress, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const [tab, setTab] = useState<Tab>("chats");
  const closeChat = useCallback(() => setSelectedId(null), []);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const needle = query.trim().toLowerCase();
  const visibleThreads = needle
    ? inbox.threads.filter((t) =>
        [threadTitle(t, names), t.peerAddress ?? "", t.last?.text ?? ""].some((s) =>
          s.toLowerCase().includes(needle),
        ),
      )
    : inbox.threads;

  useEffect(() => {
    if (selected?.last) markRead(selected.id, selected.last.sentAtNs);
  });

  const unreadOf = (t: Thread): number => {
    if (t.id === selectedId) return 0;
    const readNs = read[t.id] ? BigInt(read[t.id]) : 0n;
    return t.recent.filter((m) => m.senderInboxId !== selfInboxId && m.sentAtNs > readNs).length;
  };
  const unreadCount = inbox.threads.filter((t) => unreadOf(t) > 0).length;

  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) INKSIGNAL` : "INKSIGNAL — Your wallet. Your signal.";
    return () => {
      document.title = "INKSIGNAL — Your wallet. Your signal.";
    };
  }, [unreadCount]);

  return (
    <div
      className={`messenger${selected ? " messenger--chat" : ""}${tab !== "chats" ? " messenger--panel" : ""}`}
    >
      <aside className="sidebar">
        {walletAddress && (
          <div className={`walletcard${chainId === ink.id ? " walletcard--ok" : ""}`}>
            <span className="walletcard__icon" aria-hidden="true">{ICONS.wallet}</span>
            <span className="walletcard__text">
              <span className="walletcard__label">Connected</span>
              <span className="walletcard__addr">{shortAddress(walletAddress)}</span>
            </span>
            <span className={`walletcard__net${chainId === ink.id ? " walletcard__net--ok" : ""}`}>
              {chainId === ink.id ? "Ink" : "Wrong network"}
            </span>
          </div>
        )}
        <input
          type="search"
          className="input search"
          placeholder="Search conversations…"
          aria-label="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="btn btn--primary newconv"
          aria-expanded={composing}
          onClick={() => setComposing((v) => !v)}
        >
          {composing ? "Close" : "＋ New conversation"}
        </button>
        {composing && (
          <Compose
            lookup={inbox.lookup}
            selfAddress={client.accountIdentifier?.identifier}
            onOpen={async (address) => {
              const thread = await inbox.openDm(address);
              setSelectedId(thread.id);
              setComposing(false);
            }}
          />
        )}
        {inbox.requests.length > 0 && (
          <section aria-label="Message requests">
            <h2 className="sidebar__title">Message requests ({inbox.requests.length})</h2>
            <ul className="threads">
              {inbox.requests.map((t) => (
                <li key={t.id}>
                  <button
                    className={`thread${t.id === selectedId ? " thread--active" : ""}`}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <Avatar seed={t.peerInboxId} label={t.peerAddress ?? threadTitle(t, names)} size={44} />
                    <span className="thread__body">
                      <span className="thread__name" title={t.peerAddress}>{threadTitle(t, names)}</span>
                      <span className="thread__preview">{t.last?.text ?? "New request"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <h2 className="sidebar__title">Conversations</h2>
        {inbox.error && <p className="note note--error">{inbox.error}</p>}
        {inbox.loading ? (
          <div className="skeletons" aria-busy="true" aria-label="Syncing your inbox">
            {[0, 1, 2, 3].map((i) => (
              <div className="skeleton-row" key={i}>
                <span className="skeleton skeleton--circle" />
                <span className="skeleton-lines">
                  <span className="skeleton" />
                  <span className="skeleton skeleton--short" />
                </span>
              </div>
            ))}
          </div>
        ) : inbox.threads.length === 0 ? (
          <p className="note">No conversations yet. Tap “New conversation” to start one.</p>
        ) : visibleThreads.length === 0 ? (
          <p className="note">No conversations match “{query.trim()}”.</p>
        ) : (
          <ul className="threads">
            {visibleThreads.map((t) => {
              const unread = unreadOf(t);
              const title = threadTitle(t, names);
              return (
                <li key={t.id}>
                  <button
                    className={`thread${t.id === selectedId ? " thread--active" : ""}${unread ? " thread--unread" : ""}`}
                    onClick={() => setSelectedId(t.id)}
                    aria-label={unread ? `${title}, ${unread} unread` : undefined}
                  >
                    <Avatar seed={t.peerInboxId} label={names[t.peerInboxId] ?? t.peerAddress ?? title} size={44} />
                    <span className="thread__body">
                      <span className="thread__top">
                        <span className="thread__name" title={t.peerAddress}>
                          {title}
                        </span>
                        {t.last && <span className="thread__time">{timeLabel(t.last.sentAt)}</span>}
                      </span>
                      <span className="thread__preview">{t.last?.text ?? "No messages yet"}</span>
                    </span>
                    {unread > 0 && (
                      <span className="thread__count" aria-hidden="true">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                    <span className="thread__chevron" aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="chat">
        {selected ? (
          <ThreadView
            key={selected.id}
            thread={selected}
            names={names}
            setName={setName}
            selfInboxId={client.inboxId ?? ""}
            messages={inbox.messages[selected.id]}
            reactions={inbox.reactions[selected.id]}
            react={inbox.react}
            load={inbox.loadMessages}
            send={inbox.send}
            onBack={closeChat}
            isRequest={selectedIsRequest}
            onAccept={() => inbox.accept(selected).catch(() => undefined)}
            onBlock={() => inbox.block(selected).then(closeChat).catch(() => undefined)}
          />
        ) : (
          <div className="chat__empty">
            <h2>Select or start a conversation</h2>
            <p>Messages are end-to-end encrypted with XMTP and tied to wallet addresses.</p>
          </div>
        )}
      </section>

      {tab !== "chats" && (
        <section className="panel">
          {tab === "contacts" && (
            <>
              <h2 className="panel__title">Contacts</h2>
              {inbox.threads.filter((t) => names[t.peerInboxId]).length === 0 ? (
                <p className="note">
                  No saved contacts yet. Open a conversation and tap “Add name” to save one.
                </p>
              ) : (
                <ul className="threads">
                  {inbox.threads
                    .filter((t) => names[t.peerInboxId])
                    .sort((a, b) => names[a.peerInboxId].localeCompare(names[b.peerInboxId]))
                    .map((t) => (
                      <li key={t.id}>
                        <button
                          className="thread"
                          onClick={() => {
                            setSelectedId(t.id);
                            setTab("chats");
                          }}
                        >
                          <Avatar seed={t.peerInboxId} label={names[t.peerInboxId]} size={44} />
                          <span className="thread__body">
                            <span className="thread__name">{names[t.peerInboxId]}</span>
                            <span className="thread__preview">
                              {t.peerAddress ? shortAddress(t.peerAddress) : "Unknown address"}
                            </span>
                          </span>
                          <span className="thread__chevron" aria-hidden="true">›</span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </>
          )}
          {tab === "discover" && (
            <>
              <h2 className="panel__title">Discover</h2>
              <p className="note">
                Finding people and communities in the Ink ecosystem is coming soon. For now, start a
                chat from Chats with any wallet address.
              </p>
            </>
          )}
          {tab === "settings" && (
            <>
              <h2 className="panel__title">Settings</h2>
              <div className="panel__row">
                <span>Theme</span>
                <ThemeToggle />
              </div>
              <div className="panel__row">
                <span>Wallet</span>
                <span className="panel__value">{walletAddress ? shortAddress(walletAddress) : "—"}</span>
              </div>
              <div className="panel__row">
                <span>Network</span>
                <span className="panel__value">{chainId === ink.id ? "Ink" : "Wrong network"}</span>
              </div>
              <div className="panel__row">
                <span>Messaging</span>
                <span className="panel__value">XMTP {XMTP_ENV}</span>
              </div>
              <h3 className="panel__title">Blocked senders</h3>
              {inbox.blocked.length === 0 ? (
                <p className="note">No blocked senders.</p>
              ) : (
                inbox.blocked.map((t) => (
                  <div className="panel__row" key={t.id}>
                    <span title={t.peerAddress}>{threadTitle(t, names)}</span>
                    <button type="button" className="btn" onClick={() => void inbox.unblock(t).catch(() => undefined)}>
                      Unblock
                    </button>
                  </div>
                ))
              )}
              <button type="button" className="btn panel__danger" onClick={() => disconnect()}>
                Disconnect wallet
              </button>
            </>
          )}
        </section>
      )}

      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tabbar__item${tab === t.id ? " tabbar__item--active" : ""}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            <span className="tabbar__icon" aria-hidden="true">{ICONS[t.id]}</span>
            {t.label}
            {t.id === "chats" && unreadCount > 0 && (
              <span className="tabbar__badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

type Tab = "chats" | "contacts" | "discover" | "settings";

const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const ICONS: Record<Tab | "wallet", ReactElement> = {
  chats: (
    <svg {...ICON_PROPS}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
    </svg>
  ),
  contacts: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  discover: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </svg>
  ),
  settings: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  ),
  wallet: (
    <svg {...ICON_PROPS}>
      <path d="M3 7a2 2 0 0 1 2-2h12v4" />
      <path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2Z" />
      <circle cx="16.5" cy="14.5" r="1" />
    </svg>
  ),
};

const TABS: { id: Tab; label: string }[] = [
  { id: "chats", label: "Chats" },
  { id: "contacts", label: "Contacts" },
  { id: "discover", label: "Discover" },
  { id: "settings", label: "Settings" },
];

function Compose({
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
        <button className="btn btn--primary" disabled={busy || value.trim() === ""}>
          {busy ? "Looking up…" : "Start"}
        </button>
      </div>
      {result?.state === "invalid" && <p className="note note--error">{result.message}</p>}
      {result?.state === "unreachable" && (
        <p className="note note--error">
          {shortAddress(result.address)} hasn’t enabled XMTP messaging yet, so it can’t receive
          messages. Ask them to open INKSIGNAL (or any XMTP app) and sign in with that wallet.
        </p>
      )}
      {error && <p className="note note--error">{error}</p>}
    </form>
  );
}

function QuoteBlock({
  reply,
  original,
  author,
}: {
  reply: ReplyRef;
  original: ChatMessage | undefined;
  author: string;
}) {
  const text = original?.text ?? reply.text;
  return (
    <button
      type="button"
      className="quote"
      onClick={() =>
        document
          .getElementById(`msg-${reply.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    >
      <span className="quote__who">{author}</span>
      <span className="quote__text">{text ?? "Original message unavailable"}</span>
    </button>
  );
}

function ThreadView({
  thread,
  names,
  setName,
  selfInboxId,
  messages,
  reactions,
  react,
  load,
  send,
  onBack,
  isRequest,
  onAccept,
  onBlock,
}: {
  onBack: () => void;
  isRequest: boolean;
  onAccept: () => void;
  onBlock: () => void;
  thread: Thread;
  names: Record<string, string>;
  setName: (contactId: string, name: string) => void;
  selfInboxId: string;
  reactions: ReactionEvent[] | undefined;
  react: (t: Thread, m: ChatMessage, emoji: string, add: boolean) => Promise<void>;
  messages: ReturnType<typeof useInbox>["messages"][string] | undefined;
  load: (t: Thread) => Promise<void>;
  send: (t: Thread, text: string, replyTo?: ChatMessage) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const nickname = names[thread.peerInboxId];
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map((messages ?? []).map((m) => [m.id, m])), [messages]);

  function authorLabel(inboxId: string | undefined): string {
    if (inboxId === selfInboxId) return "You";
    return threadTitle(thread, names);
  }
  const summary = useMemo(() => summarizeReactions(reactions), [reactions]);
  const lastMineId = useMemo(
    () => [...(messages ?? [])].reverse().find((m) => m.senderInboxId === selfInboxId)?.id,
    [messages, selfInboxId],
  );

  async function toggleReaction(m: ChatMessage, emoji: string) {
    setPickerFor(null);
    const add = !summary.get(m.id)?.get(emoji)?.has(selfInboxId);
    try {
      await react(thread, m, emoji, add);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function saveNickname(e: FormEvent) {
    e.preventDefault();
    try {
      setName(thread.peerInboxId, nameDraft);
      setError(null);
      setEditingName(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key === "Escape" && !(target instanceof HTMLInputElement && target.value)) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  useEffect(() => {
    load(thread).catch((err) => setError(errorMessage(err)));
  }, [thread, load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await send(thread, body, replyingTo ?? undefined);
      setText("");
      setReplyingTo(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <header className="chat__header">
        <button className="chat__back" type="button" onClick={onBack} aria-label="Close conversation">
          <span className="chat__back-m" aria-hidden="true">←</span>
          <span className="chat__back-d" aria-hidden="true">✕</span>
        </button>
        <div className="chat__who">
        <Avatar
          seed={thread.peerInboxId}
          label={nickname ?? thread.peerAddress ?? threadTitle(thread, names)}
          size={40}
        />
        <div className="chat__whotext">
        {editingName ? (
          <form className="chat__nameform" onSubmit={saveNickname}>
            <input
              className="input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={CONTACT_NAME_MAX}
              placeholder="Name for this contact"
              aria-label="Contact name"
              autoFocus
            />
            <button className="chat__link chat__link--strong" type="submit">Save</button>
            <button className="chat__link" type="button" onClick={() => setEditingName(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="chat__titlerow">
            <strong title={thread.peerAddress}>{threadTitle(thread, names)}</strong>
            <button
              className="chat__link"
              onClick={() => {
                setNameDraft(nickname ?? "");
                setEditingName(true);
              }}
            >
              {nickname ? "Rename" : "Add name"}
            </button>
          </div>
        )}
        {thread.peerAddress && <span className="chat__full">{thread.peerAddress}</span>}
        </div>
        </div>
      </header>

      <div className="chat__messages">
        {messages === undefined ? (
          <div className="skeletons" aria-busy="true" aria-label="Loading messages">
            <span className="skeleton skeleton--bubble" />
            <span className="skeleton skeleton--bubble skeleton--right" />
            <span className="skeleton skeleton--bubble" />
          </div>
        ) : messages.length === 0 ? (
          <p className="note">No messages yet. Say hello — it will be end-to-end encrypted.</p>
        ) : (
          messages.map((m, i) => {
            const mine = m.senderInboxId === selfInboxId;
            const chips = [...(summary.get(m.id) ?? [])];
            const newDay = i === 0 || messages[i - 1].sentAt.toDateString() !== m.sentAt.toDateString();
            return (
              <Fragment key={m.id}>
              {newDay && <div className="daysep">{dayLabel(m.sentAt)}</div>}
              <div id={`msg-${m.id}`} className={`msg${mine ? " msg--me" : ""}`}>
                <div className="msg__row">
                  <div className={`bubble${mine ? " bubble--me" : ""}`}>
                    {m.replyTo && (
                      <QuoteBlock
                        reply={m.replyTo}
                        original={byId.get(m.replyTo.id)}
                        author={authorLabel(byId.get(m.replyTo.id)?.senderInboxId ?? m.replyTo.senderInboxId)}
                      />
                    )}
                    <p>{m.text}</p>
                    <time>
                      {timeLabel(m.sentAt)}
                      {mine && m.id === lastMineId && <span className="sent"> · ✓ Sent</span>}
                    </time>
                  </div>
                  <button
                    className="picker__toggle"
                    aria-label="Reply"
                    title="Reply"
                    onClick={() => {
                      setReplyingTo(m);
                      composerRef.current?.focus();
                    }}
                  >
                    ↩
                  </button>
                  <div className="picker">
                    <button
                      className="picker__toggle"
                      aria-label="Add reaction"
                      aria-expanded={pickerFor === m.id}
                      onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                    >
                      ☺
                    </button>
                    {pickerFor === m.id && (
                      <div className="picker__menu" role="menu">
                        {REACTION_EMOJI.map((emoji) => (
                          <button
                            key={emoji}
                            role="menuitem"
                            className="picker__emoji"
                            onClick={() => void toggleReaction(m, emoji)}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {chips.length > 0 && (
                  <div className="reactions">
                    {chips.map(([emoji, who]) => (
                      <button
                        key={emoji}
                        className={`reaction${who.has(selfInboxId) ? " reaction--mine" : ""}`}
                        onClick={() => void toggleReaction(m, emoji)}
                        aria-label={`${emoji} ${who.size}`}
                      >
                        {emoji}
                        {who.size > 1 && <span>{who.size}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              </Fragment>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {isRequest ? (
        <div className="note note--request" role="region" aria-label="Message request">
          <p>This is a message request. Nothing is sent until you accept.</p>
          <button type="button" className="btn btn--primary" onClick={onAccept}>Accept</button>{" "}
          <button type="button" className="btn" onClick={onBlock}>Block</button>
        </div>
      ) : (
      <form className="composer" onSubmit={submit}>
        {replyingTo && (
          <div className="replybar">
            <div className="replybar__body">
              <span className="replybar__who">Replying to {authorLabel(replyingTo.senderInboxId)}</span>
              <span className="replybar__text">{replyingTo.text}</span>
            </div>
            <button
              type="button"
              className="replybar__close"
              aria-label="Cancel reply"
              onClick={() => setReplyingTo(null)}
            >
              ✕
            </button>
          </div>
        )}
        {error && <p className="note note--error">{error}</p>}
        <div className="compose__row">
          <input
            ref={composerRef}
            className="input"
            placeholder="Write an encrypted message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <button className="btn btn--primary" disabled={sending || text.trim() === ""}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
      )}
    </>
  );
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  summarizeReactions,
  useInbox,
  type ChatMessage,
  type LookupResult,
  type ReactionEvent,
  type ReplyRef,
  type Thread,
} from "../xmtp/useInbox";
import { errorMessage, type XmtpClient } from "../xmtp/XmtpProvider";
import { shortAddress } from "../format";

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

export function Messenger({ client }: { client: XmtpClient }) {
  const inbox = useInbox(client);
  const { names, setName } = useContactNames(client.accountIdentifier?.identifier);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = inbox.threads.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="messenger">
      <aside className="sidebar">
        <Compose
          lookup={inbox.lookup}
          selfAddress={client.accountIdentifier?.identifier}
          onOpen={async (address) => {
            const thread = await inbox.openDm(address);
            setSelectedId(thread.id);
          }}
        />
        <h2 className="sidebar__title">Conversations</h2>
        {inbox.error && <p className="note note--error">{inbox.error}</p>}
        {inbox.loading ? (
          <p className="note">Syncing your inbox…</p>
        ) : inbox.threads.length === 0 ? (
          <p className="note">No conversations yet. Look up a wallet address above to start one.</p>
        ) : (
          <ul className="threads">
            {inbox.threads.map((t) => (
              <li key={t.id}>
                <button
                  className={`thread${t.id === selectedId ? " thread--active" : ""}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <span className="thread__top">
                    <span className="thread__name" title={t.peerAddress}>
                      {threadTitle(t, names)}
                    </span>
                    {t.last && <span className="thread__time">{timeLabel(t.last.sentAt)}</span>}
                  </span>
                  <span className="thread__preview">{t.last?.text ?? "No messages yet"}</span>
                </button>
              </li>
            ))}
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
          />
        ) : (
          <div className="chat__empty">
            <h2>Select or start a conversation</h2>
            <p>Messages are end-to-end encrypted with XMTP and tied to wallet addresses.</p>
          </div>
        )}
      </section>
    </div>
  );
}

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
          placeholder="Recipient wallet address (0x…)"
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
}: {
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
      </header>

      <div className="chat__messages">
        {messages === undefined ? (
          <p className="note">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="note">No messages yet. Say hello — it will be end-to-end encrypted.</p>
        ) : (
          messages.map((m) => {
            const mine = m.senderInboxId === selfInboxId;
            const chips = [...(summary.get(m.id) ?? [])];
            return (
              <div key={m.id} id={`msg-${m.id}`} className={`msg${mine ? " msg--me" : ""}`}>
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
                    <time>{timeLabel(m.sentAt)}</time>
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
            );
          })
        )}
        <div ref={endRef} />
      </div>

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
    </>
  );
}

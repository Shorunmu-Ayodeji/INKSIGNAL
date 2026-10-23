import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConsentState,
  ReactionAction,
  ReactionSchema,
  SortDirection,
  isReaction,
  isText,
  isTextReply,
  encodeText,
  type DecodedMessage,
  type Dm,
} from "@xmtp/browser-sdk";
import { isAddress } from "viem";
import { errorMessage, type XmtpClient } from "./XmtpProvider";
import { toIdentifier } from "./signer";
import { isEnsName, resolveEns } from "./names";

export interface ReplyRef {
  id: string;
  senderInboxId?: string;
  text?: string;
}

export interface ChatMessage {
  id: string;
  senderInboxId: string;
  text: string;
  sentAt: Date;
  sentAtNs: bigint;
  replyTo?: ReplyRef;
}

export interface ReactionEvent {
  id: string;
  messageId: string;
  senderInboxId: string;
  emoji: string;
  added: boolean;
  sentAtNs: bigint;
}

// emoji -> inbox ids currently reacting, per message id.
export type ReactionSummary = Map<string, Map<string, Set<string>>>;

export function summarizeReactions(events: ReactionEvent[] | undefined): ReactionSummary {
  const out: ReactionSummary = new Map();
  if (!events) return out;
  const ordered = [...events].sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : a.sentAtNs > b.sentAtNs ? 1 : 0));
  for (const e of ordered) {
    const byEmoji = out.get(e.messageId) ?? new Map<string, Set<string>>();
    const who = byEmoji.get(e.emoji) ?? new Set<string>();
    if (e.added) who.add(e.senderInboxId);
    else who.delete(e.senderInboxId);
    if (who.size > 0) byEmoji.set(e.emoji, who);
    else byEmoji.delete(e.emoji);
    out.set(e.messageId, byEmoji);
  }
  return out;
}

function toReactionEvent(m: DecodedMessage): ReactionEvent | null {
  if (!isReaction(m) || !m.content) return null;
  const r = m.content;
  if (r.action !== ReactionAction.Added && r.action !== ReactionAction.Removed) return null;
  if (!r.content) return null;
  return {
    id: m.id,
    messageId: r.reference,
    senderInboxId: m.senderInboxId,
    emoji: r.content,
    added: r.action === ReactionAction.Added,
    sentAtNs: m.sentAtNs,
  };
}

function mergeReactions(existing: ReactionEvent[], incoming: ReactionEvent[]): ReactionEvent[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()];
}

export interface Thread {
  id: string;
  dm: Dm;
  peerInboxId: string;
  peerAddress?: string;
  last?: ChatMessage;
  recent: ChatMessage[];
  createdAtNs: bigint;
  consent: ConsentState;
}

export type LookupResult =
  | { state: "invalid"; message: string }
  | { state: "unreachable"; address: string; name?: string }
  | { state: "reachable"; address: string; name?: string };

// Allowed threads are the inbox; Unknown ones are message requests; Denied ones are hidden.
export function partitionThreads(threads: Thread[]): { allowed: Thread[]; requests: Thread[]; blocked: Thread[] } {
  return {
    allowed: threads.filter((t) => t.consent === ConsentState.Allowed),
    requests: threads.filter((t) => t.consent === ConsentState.Unknown),
    blocked: threads.filter((t) => t.consent === ConsentState.Denied),
  };
}

function textOf(m: DecodedMessage | null | undefined): string | undefined {
  if (!m) return undefined;
  if (isText(m)) return m.content ?? undefined;
  if (isTextReply(m)) return m.content?.content;
  return undefined;
}

function toChat(m: DecodedMessage): ChatMessage | null {
  if (isText(m)) {
    return {
      id: m.id,
      senderInboxId: m.senderInboxId,
      text: m.content ?? "",
      sentAt: m.sentAt,
      sentAtNs: m.sentAtNs,
    };
  }
  if (isTextReply(m) && m.content) {
    const original = m.content.inReplyTo;
    return {
      id: m.id,
      senderInboxId: m.senderInboxId,
      text: m.content.content,
      sentAt: m.sentAt,
      sentAtNs: m.sentAtNs,
      replyTo: {
        id: m.content.referenceId,
        senderInboxId: original?.senderInboxId,
        text: textOf(original),
      },
    };
  }
  return null;
}

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : a.sentAtNs > b.sentAtNs ? 1 : 0));
}

function sortThreads(threads: Thread[]): Thread[] {
  const key = (t: Thread) => t.last?.sentAtNs ?? t.createdAtNs;
  return [...threads].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}

export function useInbox(client: XmtpClient) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [reactions, setReactions] = useState<Record<string, ReactionEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const threadsRef = useRef<Thread[]>([]);
  const addressCache = useRef(new Map<string, string>());

  const commitThreads = useCallback((next: Thread[]) => {
    const sorted = sortThreads(next);
    threadsRef.current = sorted;
    setThreads(sorted);
  }, []);

  const resolveAddresses = useCallback(
    async (inboxIds: string[]) => {
      const missing = inboxIds.filter((id) => !addressCache.current.has(id));
      if (missing.length === 0) return;
      const states = await client.preferences.fetchInboxStates(missing);
      for (const s of states) {
        const first = s.accountIdentifiers[0]?.identifier;
        if (first) addressCache.current.set(s.inboxId, first);
      }
    },
    [client],
  );

  const buildThread = useCallback(
    async (dm: Dm): Promise<Thread> => {
      const peerInboxId = await dm.peerInboxId();
      const recent = await dm.messages({ limit: 20n, direction: SortDirection.Descending });
      const chats = recent.map(toChat).filter((m): m is ChatMessage => m !== null);
      const last = chats[0];
      const consent = await dm.consentState();
      return {
        consent,
        id: dm.id,
        dm,
        peerInboxId,
        peerAddress: addressCache.current.get(peerInboxId),
        last,
        recent: chats,
        createdAtNs: dm.createdAtNs ?? 0n,
      };
    },
    [],
  );

  const refresh = useCallback(async () => {
    await client.conversations.sync();
    const dms = await client.conversations.listDms({
      consentStates: [ConsentState.Allowed, ConsentState.Unknown, ConsentState.Denied],
    });
    const peerIds = await Promise.all(dms.map((dm) => dm.peerInboxId()));
    await resolveAddresses(peerIds).catch(() => undefined);
    const built = await Promise.all(dms.map(buildThread));
    commitThreads(built);
  }, [client, resolveAddresses, buildThread, commitThreads]);

  useEffect(() => {
    let cancelled = false;
    let stream: { end: () => Promise<unknown> } | undefined;

    const onMessage = (m: DecodedMessage) => {
      const reaction = toReactionEvent(m);
      if (reaction) {
        setReactions((prev) => ({
          ...prev,
          [m.conversationId]: mergeReactions(prev[m.conversationId] ?? [], [reaction]),
        }));
        return;
      }
      const chat = toChat(m);
      if (!chat) return;

      setMessages((prev) =>
        prev[m.conversationId]
          ? { ...prev, [m.conversationId]: mergeMessages(prev[m.conversationId], [chat]) }
          : prev,
      );

      const known = threadsRef.current.find((t) => t.id === m.conversationId);
      if (known) {
        commitThreads(
          threadsRef.current.map((t) => {
            if (t.id !== known.id) return t;
            const recent = t.recent.some((r) => r.id === chat.id) ? t.recent : [chat, ...t.recent];
            return !t.last || chat.sentAtNs >= t.last.sentAtNs ? { ...t, last: chat, recent } : { ...t, recent };
          }),
        );
      } else {
        void refresh().catch((err) => setError(errorMessage(err)));
      }
    };

    // Fills any gap left while the stream was down: thread list plus already-open conversations.
    const resync = async () => {
      await refresh();
      await Promise.all(
        threadsRef.current.map(async (t) => {
          await t.dm.sync();
          const all = await t.dm.messages({ direction: SortDirection.Ascending });
          const chats = all.map(toChat).filter((m): m is ChatMessage => m !== null);
          const rxns = all.map(toReactionEvent).filter((e): e is ReactionEvent => e !== null);
          if (cancelled) return;
          setMessages((prev) =>
            prev[t.id] ? { ...prev, [t.id]: mergeMessages(prev[t.id], chats) } : prev,
          );
          setReactions((prev) =>
            prev[t.id] ? { ...prev, [t.id]: mergeReactions(prev[t.id], rxns) } : prev,
          );
        }),
      );
    };

    let retryTimer: number | undefined;
    let retryDelay = 2000;
    let starting = false;

    // Transient network drops end the subscription; reconnect with backoff instead of failing.
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
        if (isRetry) await resync();
        else await refresh();
        if (cancelled) return;
        setLoading(false);
        const s = await client.conversations.streamAllDmMessages({
          onValue: onMessage,
          onError: scheduleReconnect,
          onFail: scheduleReconnect,
        });
        if (cancelled) {
          void s.end();
          return;
        }
        stream = s;
        retryDelay = 2000;
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setLoading(false);
        if (isRetry || navigator.onLine === false) {
          scheduleReconnect();
        } else {
          setError(errorMessage(err));
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

    void start(false);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.clearTimeout(retryTimer);
      void stream?.end();
    };
  }, [client, refresh, commitThreads]);

  const lookup = useCallback(
    async (input: string): Promise<LookupResult> => {
      const raw = input.trim();
      let address = raw;
      let name: string | undefined;
      if (isEnsName(raw)) {
        const resolved = await resolveEns(raw);
        if (!resolved) return { state: "invalid", message: `Could not resolve “${raw}” to a wallet address.` };
        address = resolved;
        name = raw;
      }
      if (!isAddress(address)) {
        return {
          state: "invalid",
          message: "Enter a valid 0x wallet address or an ENS name (e.g. name.eth).",
        };
      }
      const result = await client.canMessage([toIdentifier(address)]);
      const reachable = [...result.values()].some(Boolean);
      return { state: reachable ? "reachable" : "unreachable", address, name };
    },
    [client],
  );

  const openDm = useCallback(
    async (address: string): Promise<Thread> => {
      const dm = await client.conversations.createDmWithIdentifier(toIdentifier(address));
      const peerInboxId = await dm.peerInboxId();
      addressCache.current.set(peerInboxId, address.toLowerCase());

      // Starting a conversation yourself is explicit consent.
      await dm.updateConsentState(ConsentState.Allowed);

      const existing = threadsRef.current.find((t) => t.id === dm.id);
      if (existing) {
        const updated = { ...existing, consent: ConsentState.Allowed };
        commitThreads(threadsRef.current.map((t) => (t.id === dm.id ? updated : t)));
        return updated;
      }

      const thread = await buildThread(dm);
      commitThreads([...threadsRef.current, thread]);
      return thread;
    },
    [client, buildThread, commitThreads],
  );

  const setConsent = useCallback(
    async (thread: Thread, state: ConsentState) => {
      await thread.dm.updateConsentState(state);
      commitThreads(threadsRef.current.map((t) => (t.id === thread.id ? { ...t, consent: state } : t)));
    },
    [commitThreads],
  );

  const loadMessages = useCallback(async (thread: Thread) => {
    await thread.dm.sync();
    const all = await thread.dm.messages({ direction: SortDirection.Ascending });
    const chats = all.map(toChat).filter((m): m is ChatMessage => m !== null);
    const rxns = all.map(toReactionEvent).filter((e): e is ReactionEvent => e !== null);
    setMessages((prev) => ({
      ...prev,
      [thread.id]: mergeMessages(prev[thread.id] ?? [], chats),
    }));
    setReactions((prev) => ({
      ...prev,
      [thread.id]: mergeReactions(prev[thread.id] ?? [], rxns),
    }));
  }, []);

  const react = useCallback(
    async (thread: Thread, message: ChatMessage, emoji: string, add: boolean) => {
      const id = await thread.dm.sendReaction({
        reference: message.id,
        referenceInboxId: message.senderInboxId,
        action: add ? ReactionAction.Added : ReactionAction.Removed,
        content: emoji,
        schema: ReactionSchema.Unicode,
      });
      const event: ReactionEvent = {
        id,
        messageId: message.id,
        senderInboxId: client.inboxId ?? "",
        emoji,
        added: add,
        sentAtNs: BigInt(Date.now()) * 1_000_000n,
      };
      setReactions((prev) => ({
        ...prev,
        [thread.id]: mergeReactions(prev[thread.id] ?? [], [event]),
      }));
    },
    [client],
  );

  const send = useCallback(
    async (thread: Thread, text: string, replyTo?: ChatMessage) => {
      const id = replyTo
        ? await thread.dm.sendReply({
            content: await encodeText(text),
            reference: replyTo.id,
            referenceInboxId: replyTo.senderInboxId,
          })
        : await thread.dm.sendText(text);
      const chat: ChatMessage = {
        id,
        senderInboxId: client.inboxId ?? "",
        text,
        sentAt: new Date(),
        sentAtNs: BigInt(Date.now()) * 1_000_000n,
        replyTo: replyTo
          ? { id: replyTo.id, senderInboxId: replyTo.senderInboxId, text: replyTo.text }
          : undefined,
      };
      setMessages((prev) => ({
        ...prev,
        [thread.id]: mergeMessages(prev[thread.id] ?? [], [chat]),
      }));
      commitThreads(
        threadsRef.current.map((t) =>
          t.id === thread.id ? { ...t, last: chat, recent: [chat, ...t.recent] } : t,
        ),
      );
    },
    [client, commitThreads],
  );

  const { allowed, requests, blocked } = partitionThreads(threads);

  return {
    threads: allowed,
    requests,
    blocked,
    unblock: (t: Thread) => setConsent(t, ConsentState.Unknown),
    messages,
    reactions,
    loading,
    error,
    lookup,
    openDm,
    loadMessages,
    send,
    react,
    accept: (t: Thread) => setConsent(t, ConsentState.Allowed),
    block: (t: Thread) => setConsent(t, ConsentState.Denied),
  };
}

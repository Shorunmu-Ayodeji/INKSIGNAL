import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConsentState,
  ReactionAction,
  ReactionSchema,
  SortDirection,
  encodeText,
  type DecodedMessage,
  type Dm,
} from "@xmtp/browser-sdk";
import { errorMessage, type XmtpClient } from "./XmtpProvider";
import { toIdentifier } from "./signer";
import { lookupRecipient } from "./lookup";
import { runDmStream } from "./dmStream";
import {
  mergeMessages,
  mergeReactions,
  partitionThreads,
  sortThreads,
  toChat,
  toReactionEvent,
  type ChatMessage,
  type ReactionEvent,
  type Thread,
} from "./inboxModel";

export { partitionThreads, summarizeReactions } from "./inboxModel";
export type {
  ChatMessage,
  LookupResult,
  ReactionEvent,
  ReactionSummary,
  ReplyRef,
  Thread,
} from "./inboxModel";

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

  const buildThread = useCallback(async (dm: Dm): Promise<Thread> => {
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
  }, []);

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
            return !t.last || chat.sentAtNs >= t.last.sentAtNs
              ? { ...t, last: chat, recent }
              : { ...t, recent };
          }),
        );
      } else {
        void refresh().catch((err) => setError(errorMessage(err)));
      }
    };

    // Fills any gap left while the stream was down: thread list plus already-open conversations.
    const resync = async (isCancelled: () => boolean) => {
      await refresh();
      await Promise.all(
        threadsRef.current.map(async (t) => {
          await t.dm.sync();
          const all = await t.dm.messages({ direction: SortDirection.Ascending });
          const chats = all.map(toChat).filter((m): m is ChatMessage => m !== null);
          const rxns = all.map(toReactionEvent).filter((e): e is ReactionEvent => e !== null);
          if (isCancelled()) return;
          setMessages((prev) => (prev[t.id] ? { ...prev, [t.id]: mergeMessages(prev[t.id], chats) } : prev));
          setReactions((prev) => (prev[t.id] ? { ...prev, [t.id]: mergeReactions(prev[t.id], rxns) } : prev));
        }),
      );
    };

    return runDmStream(client, {
      refresh,
      resync,
      onMessage,
      onReady: () => setLoading(false),
      onError: setError,
    });
  }, [client, refresh, commitThreads]);

  const lookup = useCallback((input: string) => lookupRecipient(client, input), [client]);

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

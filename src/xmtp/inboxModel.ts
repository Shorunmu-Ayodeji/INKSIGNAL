import {
  ConsentState,
  ReactionAction,
  isReaction,
  isText,
  isTextReply,
  type DecodedMessage,
  type Dm,
} from "@xmtp/browser-sdk";

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
  const ordered = [...events].sort((a, b) =>
    a.sentAtNs < b.sentAtNs ? -1 : a.sentAtNs > b.sentAtNs ? 1 : 0,
  );
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

export function toReactionEvent(m: DecodedMessage): ReactionEvent | null {
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

export function mergeReactions(existing: ReactionEvent[], incoming: ReactionEvent[]): ReactionEvent[] {
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
export function partitionThreads(threads: Thread[]): {
  allowed: Thread[];
  requests: Thread[];
  blocked: Thread[];
} {
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

export function toChat(m: DecodedMessage): ChatMessage | null {
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

export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : a.sentAtNs > b.sentAtNs ? 1 : 0));
}

export function sortThreads(threads: Thread[]): Thread[] {
  const key = (t: Thread) => t.last?.sentAtNs ?? t.createdAtNs;
  return [...threads].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}

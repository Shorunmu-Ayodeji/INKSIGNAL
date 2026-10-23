import type { ChatMessage, ReplyRef } from "../xmtp/useInbox";

export function QuoteBlock({
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
        document.getElementById(`msg-${reply.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    >
      <span className="quote__who">{author}</span>
      <span className="quote__text">{text ?? "Original message unavailable"}</span>
    </button>
  );
}

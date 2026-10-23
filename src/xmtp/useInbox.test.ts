import { describe, expect, it } from "vitest";
import { ConsentState } from "@xmtp/browser-sdk";
import { partitionThreads, summarizeReactions, type ReactionEvent, type Thread } from "./useInbox";
import { isEnsName } from "./names";

const ev = (id: string, who: string, added: boolean, ns: number, emoji = "👍", messageId = "m1"): ReactionEvent => ({
  id,
  messageId,
  senderInboxId: who,
  emoji,
  added,
  sentAtNs: BigInt(ns),
});

const thread = (id: string, consent: ConsentState) => ({ id, consent }) as unknown as Thread;

describe("summarizeReactions", () => {
  it("returns empty for no events", () => {
    expect(summarizeReactions(undefined).size).toBe(0);
  });

  it("aggregates reactors per emoji", () => {
    const s = summarizeReactions([ev("1", "a", true, 1), ev("2", "b", true, 2)]);
    expect([...s.get("m1")!.get("👍")!]).toEqual(["a", "b"]);
  });

  it("applies events in time order regardless of input order", () => {
    const s = summarizeReactions([ev("2", "a", false, 2), ev("1", "a", true, 1)]);
    expect(s.get("m1")!.size).toBe(0);
  });

  it("re-adding after removal counts", () => {
    const s = summarizeReactions([ev("1", "a", true, 1), ev("2", "a", false, 2), ev("3", "a", true, 3)]);
    expect(s.get("m1")!.get("👍")!.has("a")).toBe(true);
  });

  it("keeps messages and emoji separate", () => {
    const s = summarizeReactions([ev("1", "a", true, 1, "❤️", "m2"), ev("2", "a", true, 2)]);
    expect(s.get("m2")!.has("❤️")).toBe(true);
    expect(s.get("m1")!.has("❤️")).toBe(false);
  });
});

describe("partitionThreads", () => {
  it("splits allowed from requests and hides denied", () => {
    const { allowed, requests } = partitionThreads([
      thread("a", ConsentState.Allowed),
      thread("b", ConsentState.Unknown),
      thread("c", ConsentState.Denied),
    ]);
    expect(allowed.map((t) => t.id)).toEqual(["a"]);
    expect(requests.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("isEnsName", () => {
  it("accepts .eth names", () => {
    expect(isEnsName("vitalik.eth")).toBe(true);
    expect(isEnsName(" sub.name.ETH ")).toBe(true);
  });
  it("rejects addresses and other input", () => {
    expect(isEnsName("0x0000000000000000000000000000000000000000")).toBe(false);
    expect(isEnsName("foo.com")).toBe(false);
    expect(isEnsName("a b.eth")).toBe(false);
  });
});

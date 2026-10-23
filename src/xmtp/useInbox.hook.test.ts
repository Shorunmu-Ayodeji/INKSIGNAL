// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ConsentState } from "@xmtp/browser-sdk";
import { useInbox } from "./useInbox";
import type { XmtpClient } from "./XmtpProvider";

function mockDm(id: string, peer: string, consent: ConsentState) {
  let state = consent;
  return {
    id,
    createdAtNs: 1n,
    peerInboxId: async () => peer,
    messages: async () => [],
    sync: async () => undefined,
    consentState: async () => state,
    updateConsentState: vi.fn(async (s: ConsentState) => {
      state = s;
    }),
  };
}

function mockClient(dms: ReturnType<typeof mockDm>[]) {
  const end = vi.fn(async () => undefined);
  const listDms = vi.fn(async () => dms);
  const client = {
    inboxId: "me",
    canMessage: vi.fn(async (ids: unknown[]) => new Map([[String(ids.length), true]])),
    preferences: { fetchInboxStates: vi.fn(async () => []) },
    conversations: {
      sync: vi.fn(async () => undefined),
      listDms,
      streamAllDmMessages: vi.fn(async () => ({ end })),
      createDmWithIdentifier: vi.fn(async () => dms[0]),
    },
  };
  return { client: client as unknown as XmtpClient, raw: client, listDms };
}

describe("useInbox consent", () => {
  const setup = async () => {
    const dms = [
      mockDm("a", "peerA", ConsentState.Allowed),
      mockDm("b", "peerB", ConsentState.Unknown),
      mockDm("c", "peerC", ConsentState.Denied),
    ];
    const m = mockClient(dms);
    const hook = renderHook(() => useInbox(m.client));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return { ...m, dms, hook };
  };

  it("lists all consent states and partitions them", async () => {
    const { hook, listDms } = await setup();
    expect(listDms).toHaveBeenCalledWith({
      consentStates: [ConsentState.Allowed, ConsentState.Unknown, ConsentState.Denied],
    });
    expect(hook.result.current.threads.map((t) => t.id)).toEqual(["a"]);
    expect(hook.result.current.requests.map((t) => t.id)).toEqual(["b"]);
    expect(hook.result.current.blocked.map((t) => t.id)).toEqual(["c"]);
  });

  it("accept moves a request into the inbox", async () => {
    const { hook, dms } = await setup();
    await act(() => hook.result.current.accept(hook.result.current.requests[0]));
    expect(dms[1].updateConsentState).toHaveBeenCalledWith(ConsentState.Allowed);
    expect(hook.result.current.requests).toHaveLength(0);
    expect(hook.result.current.threads.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("block hides a thread and unblock returns it to requests", async () => {
    const { hook, dms } = await setup();
    await act(() => hook.result.current.block(hook.result.current.requests[0]));
    expect(dms[1].updateConsentState).toHaveBeenCalledWith(ConsentState.Denied);
    expect(hook.result.current.blocked.map((t) => t.id).sort()).toEqual(["b", "c"]);
    await act(() => hook.result.current.unblock(hook.result.current.blocked.find((t) => t.id === "c")!));
    expect(hook.result.current.requests.map((t) => t.id).sort()).toEqual(["c"]);
  });

  it("starting a conversation grants consent", async () => {
    const { hook, dms } = await setup();
    await act(async () => {
      await hook.result.current.openDm("0x0000000000000000000000000000000000000001");
    });
    expect(dms[0].updateConsentState).toHaveBeenCalledWith(ConsentState.Allowed);
  });

  it("ends the stream on unmount", async () => {
    const { hook, raw } = await setup();
    hook.unmount();
    const s = await raw.conversations.streamAllDmMessages.mock.results[0].value;
    expect(s.end).toHaveBeenCalled();
  });
});

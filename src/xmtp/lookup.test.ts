import { describe, expect, it, vi } from "vitest";

const resolveEns = vi.fn();
vi.mock("./names", async () => {
  const actual = await vi.importActual<typeof import("./names")>("./names");
  return { ...actual, resolveEns: (n: string) => resolveEns(n) };
});

import { lookupRecipient } from "./lookup";
import type { XmtpClient } from "./XmtpProvider";

const ADDR = "0x1111111111111111111111111111111111111111";

function client(reachable: boolean) {
  const canMessage = vi.fn(async () => new Map([[ADDR, reachable]]));
  return { c: { canMessage } as unknown as XmtpClient, canMessage };
}

describe("lookupRecipient", () => {
  it("rejects invalid input without hitting the network", async () => {
    const { c, canMessage } = client(true);
    const r = await lookupRecipient(c, "nope");
    expect(r.state).toBe("invalid");
    expect(canMessage).not.toHaveBeenCalled();
  });

  it("reports reachable and unreachable addresses", async () => {
    expect(await lookupRecipient(client(true).c, ` ${ADDR} `)).toEqual({
      state: "reachable",
      address: ADDR,
      name: undefined,
    });
    expect((await lookupRecipient(client(false).c, ADDR)).state).toBe("unreachable");
  });

  it("resolves ENS names and keeps the name", async () => {
    resolveEns.mockResolvedValueOnce(ADDR);
    const r = await lookupRecipient(client(true).c, "alice.eth");
    expect(r).toEqual({ state: "reachable", address: ADDR, name: "alice.eth" });
  });

  it("reports unresolvable ENS names as invalid", async () => {
    resolveEns.mockResolvedValueOnce(null);
    const { c, canMessage } = client(true);
    const r = await lookupRecipient(c, "ghost.eth");
    expect(r.state).toBe("invalid");
    expect(canMessage).not.toHaveBeenCalled();
  });
});

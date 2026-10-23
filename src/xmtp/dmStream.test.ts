// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDmStream, type DmStreamHandlers } from "./dmStream";
import type { XmtpClient } from "./XmtpProvider";

type StreamOpts = { onValue: (m: unknown) => void; onError: () => void; onFail: () => void };

function setup(streamImpl?: () => Promise<unknown>) {
  const end = vi.fn(async () => undefined);
  const opts: StreamOpts[] = [];
  const streamAllDmMessages = vi.fn(async (o: StreamOpts) => {
    opts.push(o);
    if (streamImpl) return streamImpl();
    return { end };
  });
  const client = { conversations: { streamAllDmMessages } } as unknown as XmtpClient;
  const h: DmStreamHandlers = {
    refresh: vi.fn(async () => undefined),
    resync: vi.fn(async () => undefined),
    onMessage: vi.fn(),
    onReady: vi.fn(),
    onError: vi.fn(),
  };
  return { client, h, end, opts, streamAllDmMessages };
}

describe("runDmStream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refreshes, starts streaming and clears errors", async () => {
    const t = setup();
    runDmStream(t.client, t.h);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.h.refresh).toHaveBeenCalledTimes(1);
    expect(t.h.onReady).toHaveBeenCalled();
    expect(t.streamAllDmMessages).toHaveBeenCalledTimes(1);
    expect(t.h.onError).toHaveBeenCalledWith(null);
  });

  it("reconnects with resync after a stream error", async () => {
    const t = setup();
    runDmStream(t.client, t.h);
    await vi.advanceTimersByTimeAsync(0);

    t.opts[0].onError();
    expect(t.end).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.h.resync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.h.resync).toHaveBeenCalledTimes(1);
    expect(t.streamAllDmMessages).toHaveBeenCalledTimes(2);

    // A successful reconnect resets the backoff to 2s.
    t.opts[1].onFail();
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.streamAllDmMessages).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.streamAllDmMessages).toHaveBeenCalledTimes(3);
  });

  it("surfaces the error on first-start failure when online", async () => {
    const t = setup(async () => {
      throw new Error("boom");
    });
    runDmStream(t.client, t.h);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.h.onError).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(t.h.onReady).toHaveBeenCalled();
  });

  it("retries silently when a retry attempt fails", async () => {
    let calls = 0;
    const t = setup(async () => {
      if (++calls === 2) throw new Error("down");
      return { end: async () => undefined };
    });
    runDmStream(t.client, t.h);
    await vi.advanceTimersByTimeAsync(0);
    t.opts[0].onError();
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.h.onError).not.toHaveBeenCalledWith(expect.stringContaining("down"));
    await vi.advanceTimersByTimeAsync(4000);
    expect(t.streamAllDmMessages).toHaveBeenCalledTimes(3);
  });

  it("reconnects immediately when the browser comes back online", async () => {
    const t = setup();
    runDmStream(t.client, t.h);
    await vi.advanceTimersByTimeAsync(0);
    t.opts[0].onError();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.h.resync).toHaveBeenCalledTimes(1);
  });

  it("stops everything on cleanup", async () => {
    const t = setup();
    const stop = runDmStream(t.client, t.h);
    await vi.advanceTimersByTimeAsync(0);
    t.opts[0].onError();
    stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(t.h.resync).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.h.resync).not.toHaveBeenCalled();
  });

  it("swallows only the 'Stream not found' unhandled rejection", async () => {
    const t = setup();
    const stop = runDmStream(t.client, t.h);
    const mk = (message: string) => {
      const e = new Event("unhandledrejection", { cancelable: true }) as Event & { reason: unknown };
      e.reason = new Error(message);
      return e;
    };
    const hit = mk('Stream "abc" not found');
    window.dispatchEvent(hit);
    expect(hit.defaultPrevented).toBe(true);
    const miss = mk("other");
    window.dispatchEvent(miss);
    expect(miss.defaultPrevented).toBe(false);
    stop();
  });
});

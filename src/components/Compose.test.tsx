// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Compose } from "./Compose";
import type { LookupResult } from "../xmtp/inboxModel";

const ADDR = "0x1111111111111111111111111111111111111111";

afterEach(cleanup);

function setup(result: LookupResult | Error, selfAddress?: string) {
  const lookup = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const onOpen = vi.fn(async () => undefined);
  render(<Compose lookup={lookup} selfAddress={selfAddress} onOpen={onOpen} />);
  const input = screen.getByLabelText("New message") as HTMLInputElement;
  const submit = (value: string) => {
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole("button"));
  };
  return { lookup, onOpen, input, submit };
}

describe("Compose", () => {
  it("disables Start while the input is empty", () => {
    setup({ state: "invalid", message: "x" });
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the conversation and clears the input when reachable", async () => {
    const t = setup({ state: "reachable", address: ADDR });
    t.submit("alice.eth");
    await waitFor(() => expect(t.onOpen).toHaveBeenCalledWith(ADDR));
    await waitFor(() => expect(t.input.value).toBe(""));
  });

  it("shows the invalid message and does not open", async () => {
    const t = setup({ state: "invalid", message: "Bad address" });
    t.submit("zzz");
    expect(await screen.findByText("Bad address")).toBeTruthy();
    expect(t.onOpen).not.toHaveBeenCalled();
  });

  it("explains unreachable wallets", async () => {
    const t = setup({ state: "unreachable", address: ADDR });
    t.submit(ADDR);
    expect(await screen.findByText(/hasn’t enabled XMTP/)).toBeTruthy();
    expect(t.onOpen).not.toHaveBeenCalled();
  });

  it("rejects the user's own address without a lookup", async () => {
    const t = setup({ state: "reachable", address: ADDR }, ADDR.toUpperCase().replace("0X", "0x"));
    t.submit(ADDR);
    expect(await screen.findByText("That is your own wallet address.")).toBeTruthy();
    expect(t.lookup).not.toHaveBeenCalled();
  });

  it("shows lookup errors", async () => {
    const t = setup(new Error("network down"));
    t.submit(ADDR);
    expect(await screen.findByText(/network down/)).toBeTruthy();
  });
});

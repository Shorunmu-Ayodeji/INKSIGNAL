import { isAddress } from "viem";
import type { XmtpClient } from "./XmtpProvider";
import { toIdentifier } from "./signer";
import { isEnsName, resolveEns } from "./names";
import type { LookupResult } from "./inboxModel";

export async function lookupRecipient(client: XmtpClient, input: string): Promise<LookupResult> {
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
}

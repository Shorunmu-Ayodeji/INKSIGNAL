import { IdentifierKind, type Identifier, type Signer } from "@xmtp/browser-sdk";
import { hexToBytes, type Address, type Hex } from "viem";

export function toIdentifier(address: string): Identifier {
  return {
    identifier: address.toLowerCase(),
    identifierKind: IdentifierKind.Ethereum,
  };
}

// Bridges the connected wagmi wallet to XMTP's EOA signer interface. The wallet
// signs XMTP's registration text with personal_sign; no key ever leaves it.
export function createWalletSigner(address: Address, signMessage: (message: string) => Promise<Hex>): Signer {
  return {
    type: "EOA",
    getIdentifier: () => toIdentifier(address),
    signMessage: async (message) => hexToBytes(await signMessage(message)),
  };
}

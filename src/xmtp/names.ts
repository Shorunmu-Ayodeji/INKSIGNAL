import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(import.meta.env.VITE_ENS_RPC_URL || undefined),
});

export function isEnsName(input: string): boolean {
  return /^[^\s.]+(\.[^\s.]+)*\.eth$/i.test(input.trim());
}

// ENS lives on Ethereum mainnet; resolution is read-only and independent of the connected chain.
export async function resolveEns(name: string): Promise<string | null> {
  try {
    return await ensClient.getEnsAddress({ name: normalize(name.trim()) });
  } catch {
    return null;
  }
}

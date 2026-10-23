import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { ink } from "viem/chains";

// Wallets are discovered through EIP-6963; `injected()` is the fallback for
// browsers whose wallet only exposes window.ethereum.
export const wagmiConfig = createConfig({
  chains: [ink],
  connectors: [injected()],
  transports: {
    [ink.id]: http(),
  },
  multiInjectedProviderDiscovery: true,
});

export { ink };

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

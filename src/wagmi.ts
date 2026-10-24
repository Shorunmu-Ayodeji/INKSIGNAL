import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { ink } from "viem/chains";

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

// Wallets are discovered through EIP-6963; `injected()` is the fallback for
// browsers whose wallet only exposes window.ethereum. WalletConnect covers
// mobile browsers, where no wallet is injected.
export const wagmiConfig = createConfig({
  chains: [ink],
  connectors: projectId ? [injected(), walletConnect({ projectId })] : [injected()],
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

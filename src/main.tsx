import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "./wagmi";
import { XmtpProvider } from "./xmtp/XmtpProvider";
import { App } from "./App";
import "./styles.css";

const queryClient = new QueryClient();

// StrictMode is intentionally not used: its double-mount would start and tear
// down the XMTP wasm client twice in development.
createRoot(document.getElementById("root")!).render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <XmtpProvider>
        <App />
      </XmtpProvider>
    </QueryClientProvider>
  </WagmiProvider>,
);

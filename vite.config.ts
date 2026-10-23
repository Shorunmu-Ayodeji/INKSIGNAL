import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// XMTP's browser SDK and wasm bindings rely on import.meta.url, so they must
// not be pre-bundled by Vite's dependency optimizer.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@xmtp/wasm-bindings", "@xmtp/browser-sdk"],
    include: ["@xmtp/proto"],
  },
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
  },
});

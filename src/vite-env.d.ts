/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XMTP_ENV?: "production" | "dev";
  readonly VITE_ENS_RPC_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

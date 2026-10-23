/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XMTP_ENV?: "production" | "dev";
  readonly VITE_ENS_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

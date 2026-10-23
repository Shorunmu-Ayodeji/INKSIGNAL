/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XMTP_ENV?: "production" | "dev";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

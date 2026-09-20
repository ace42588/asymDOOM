/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ASYM_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

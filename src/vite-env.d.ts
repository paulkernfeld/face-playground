/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MORPHCAST_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

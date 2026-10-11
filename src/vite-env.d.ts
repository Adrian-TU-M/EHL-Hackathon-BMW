/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ELEVENLABS_AGENT_ID?: string;
  readonly VITE_ELEVENLABS_PRESENTATION_AGENT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Customer Agent API; defaults to the Vite proxy path "/customer-api". */
  readonly VITE_CUSTOMER_API_URL?: string;
  readonly VITE_ELEVENLABS_AGENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

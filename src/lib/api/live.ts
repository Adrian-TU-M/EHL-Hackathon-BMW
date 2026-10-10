import type { Scope } from "../types";
export interface LiveScope extends Omit<Scope, "prompt" | "confirmedAt"> {
  topic: string;
}
export interface Source {
  id: string;
  brand: string;
  model: string;
  passage: string;
  source_uri: string;
  source_title: string;
  locator: string;
  categories: string[];
  country?: string;
  market: string;
  powertrain?: string;
  trim?: string;
  verified_on?: string;
  review_due_on?: string;
  caveats: string[];
  source_type: string;
  eligible_for_current_search?: boolean;
}
export interface Position {
  agent_id: string;
  stance: string;
  rationale: string;
  claims: { id: string; text: string; kind: string; evidence_ids: string[] }[];
}
export interface Recommendation {
  title: string;
  proposed_change: string;
  rationale: string;
  positive_effects: { description: string; uncertainty: string }[];
  negative_effects: { description: string; uncertainty: string }[];
  validation_needed: string[];
  evidence_ids: string[];
}
export interface Analysis {
  requested_evidence_ids: string[];
  run_id: string;
  analysis_id: string;
  scope: LiveScope;
  model: string;
  competitor_brand: string | null;
  competitor_model: string | null;
  position: Position;
  recommendations: Recommendation[];
  evidence: Source[];
  uncertainties: string[];
  research_steps: string[];
}
export interface Turn {
  agent_id: string;
  stage: string;
  position: Position;
  challenges: {
    target_agent_id: string;
    target_claim_id: string;
    question: string;
    evidence_ids: string[];
  }[];
  answered_claim_ids: string[];
}
export interface Debate {
  run_id: string;
  source_run_id: string;
  scope: LiveScope;
  model: string;
  turns: Turn[];
  evidence: Source[];
  limitations: string[];
  decision: string;
}
export interface Job<T> {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed";
  phase: string;
  error: string | null;
  result: T | null;
  request: { scope: LiveScope; source_run_id?: string };
}
export interface Runtime {
  analysis_ready: boolean;
  busy: boolean;
  model: string;
  ollama_url: string;
  ollama_server_running: boolean;
  model_installed: boolean;
  debate_ready: boolean;
  index_error: string | null;
  ollama_error: string | null;
}
const base = (import.meta.env.VITE_AGENT_API_URL || "").replace(/\/$/, "");
export class LiveApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${base}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      "Agent backend is not reachable. Start the backend on port 8001.",
    );
  }
  if (!response.ok)
    throw new LiveApiError(
      typeof body.detail === "string"
        ? body.detail
        : `Agent request failed (${response.status}). Check the scope and backend.`,
      response.status,
    );
  return body as T;
}
export const post = <T>(path: string, data: unknown) =>
  api<T>(path, { method: "POST", keepalive: true, body: JSON.stringify(data) });
export const brands = [
  { name: "Tesla", logo: "tesla.svg" },
  { name: "Mercedes-Benz", logo: "mercedes.svg" },
  { name: "BYD", logo: "byd.png" },
  { name: "Audi", logo: "audi.svg" },
  { name: "Volkswagen", logo: "volkswagen.png" },
  { name: "XPENG", logo: "xpeng.svg" },
  { name: "NIO", logo: "nio.svg" },
];

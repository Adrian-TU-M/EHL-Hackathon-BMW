import type { Scope } from "../types";
export type Role = "customer" | "market" | "competitor";
export interface SourceRecord {
  id: string;
  name: string;
  sha256: string;
  source_url?: string;
  domain: string;
  coverage: Record<string, unknown>;
  limitations: string[];
}
export interface SourceEvidence {
  id: string;
  source_id: string;
  domain: string;
  location: string;
  passage: string;
  kind: string;
  vehicle?: string;
  region?: string;
  country?: string;
  powertrain?: string;
  period?: string;
  published_at?: string;
  limitations: string[];
  classification_rows: number[];
  quantitative?: Record<string, unknown>;
  equipment_verified: boolean;
  excluded_reason?: string;
}
export interface AgendaTopic {
  id: string;
  label: string;
  area: string;
  question: string;
  evidence_ids: string[];
  counterevidence_ids: string[];
  ratings: Record<
    string,
    { value: number | null; evidence_ids: string[]; rationale: string }
  >;
  lower_score: number;
  upper_score: number;
  coverage: number;
  observation_count: number;
  denominator: number;
  exploratory: boolean;
  pinned: boolean;
  severe: boolean;
  eligible: boolean;
  rationale: string;
  limitations: string[];
}
export interface Claim {
  id: string;
  actor: Role;
  statement: string;
  kind: string;
  evidence_ids: string[];
  assumption_ids: string[];
  consequential: boolean;
  validation: string;
  issues: string[];
  semantic_check: string;
}
export interface AssumptionRecord {
  id: string;
  version: number;
  statement: string;
  author: string;
  scope: Scope;
  rationale: string;
  status: string;
  evidence_ids: string[];
  opposing_evidence_ids: string[];
  affected_claim_ids: string[];
  affected_alternative_ids: string[];
  validation_needed: string;
  material: boolean;
}
export interface DebateChallenge {
  id: string;
  actor: Role;
  target_actor: Role;
  target_claim_id: string;
  kind: string;
  question: string;
  consequence: string;
  status: string;
  response?: string;
  evidence_ids: string[];
}
export interface ModeratorEvent {
  id: string;
  session_id: string;
  run_id: string;
  topic_id?: string;
  sequence: number;
  timestamp: string;
  stage: string;
  actor: string;
  statement: string;
  evidence_ids: string[];
  assumption_versions: Record<string, number>;
  data: Record<string, unknown>;
}
export interface JudgeAssessment {
  summary: string;
  unresolved_issues: string[];
  scoring_inputs: Record<string, unknown>[];
  proposals: Record<string, unknown>[];
}
export interface JudgePacket {
  id: string;
  version: number;
  brief: {
    topic_id: string;
    question: string;
    scope: Scope;
    limitations: string[];
  };
  source_snapshot: string;
  source_inventory: SourceRecord[];
  evidence_index: Record<string, unknown>[];
  positions: {
    actor: Role;
    summary: string;
    abstention_reason?: string;
    counterevidence_ids: string[];
    uncertainties: string[];
    change_conditions: string[];
  }[];
  claims: Claim[];
  challenges: DebateChallenge[];
  alternatives: {
    id: string;
    title: string;
    description: string;
    tradeoff: string;
    assumption_ids: string[];
  }[];
  assumptions: AssumptionRecord[];
  unresolved_issues: string[];
  coverage_limitations: string[];
  transcript: ModeratorEvent[];
  closure_reason?: string;
  pm_challenges: string[];
}
export interface TopicOutcome {
  topic_id: string;
  version: number;
  closure_reason: string;
  packet: JudgePacket;
  assessment?: JudgeAssessment;
  assessment_valid: boolean;
  review_status: string;
  decisions: {
    version: number;
    status: string;
    rationale: string;
    at: string;
  }[];
  history: Record<string, unknown>[];
}
export interface ModeratorSession {
  id: string;
  run_id: string;
  parent_session_id?: string;
  mode: "deterministic" | "http";
  status:
    | "awaiting_confirmation"
    | "ready"
    | "running"
    | "paused"
    | "interrupted"
    | "complete"
    | "unavailable";
  agenda: {
    id: string;
    version: number;
    source_snapshot: string;
    scope: Scope;
    topics: AgendaTopic[];
    selected_ids: string[];
    confirmed_at?: string;
    warnings: string[];
    policy_version: string;
    semantic_refinement: string;
  };
  cursor: number;
  sequence: number;
  revision: number;
  generation: number;
  work?: {
    brief: JudgePacket["brief"];
    stage: string;
    claims: Claim[];
    challenges: DebateChallenge[];
    assessment?: JudgeAssessment;
    tokens: number;
    active_seconds: number;
    errors: string[];
    blocked_preference: boolean;
  };
  outcomes: TopicOutcome[];
  assumptions: AssumptionRecord[];
  assumption_history: AssumptionRecord[];
  limits: {
    call_seconds: number;
    topic_seconds: number;
    topic_tokens: number;
    session_tokens: number;
    reserve_fraction: number;
  };
  tokens: number;
  active_seconds: number;
  availability: string[];
}
export interface ModeratorExport {
  schema_version: number;
  session: ModeratorSession;
  events: ModeratorEvent[];
}
export type ModeratorControl =
  | "start"
  | "pause"
  | "resume"
  | "interrupt"
  | "challenge"
  | "skip"
  | "reorder"
  | "finish";

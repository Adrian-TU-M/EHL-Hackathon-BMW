export type Vehicle = "F70" | "G60" | "G70";
export type Market = "Europe" | "United States" | "China";
export type Powertrain = "Electric" | "Plug-in hybrid" | "Combustion";
export type Domain = "customer" | "market" | "competitor";
export type AgentId = Domain | "moderator" | "judge";
export type AgentState =
  | "idle"
  | "thinking"
  | "speaking"
  | "challenging"
  | "waiting"
  | "evaluating"
  | "paused"
  | "complete";
export type Topic =
  | "Displays"
  | "Charging"
  | "Seats"
  | "Trunk"
  | "Interior"
  | "Driving controls"
  | "Exterior";
export type DecisionStatus =
  | "Pending review"
  | "Approved"
  | "Rejected"
  | "Challenged"
  | "Deferred"
  | "Evidence requested";
export interface Scope {
  vehicle: Vehicle;
  market: Market;
  powertrain: Powertrain;
  horizon: number;
  prompt: string;
  confirmedAt?: string;
}
export interface QuantitativeClaim {
  numerator: number;
  denominator: number;
  unit: string;
  filters: string[];
  period: string;
  method: string;
  limitations: string;
}
export interface Evidence {
  id: string;
  domain: Domain;
  source: string;
  location: string;
  publishedAt: string;
  provenance: "synthetic";
  vehicle: Vehicle;
  market: Market;
  powertrain: Powertrain;
  category: Topic;
  type: "Complaint" | "Request" | "Positive" | "Signal";
  passage: string;
  quantitative?: QuantitativeClaim;
  exclusionReason?: string;
}
export interface Finding {
  id: string;
  title: string;
  detail: string;
  topic: Topic;
  evidenceIds: string[];
  uncertainty: string;
}
export type Criterion = "need" | "severity" | "gap" | "future" | "feasibility";
export type Weights = Record<Criterion, number>;
export interface Alternative {
  title: string;
  impact: number;
  risk: number;
  effort: string;
  uncertainty: string;
}
export interface RequirementVersion {
  version: number;
  description: string;
  status: DecisionStatus;
  at: string;
  rationale: string;
}
export interface Requirement {
  id: string;
  vehicle: Vehicle;
  market: Market;
  powertrain: Powertrain;
  topic: Topic;
  title: string;
  description: string;
  findingIds: string[];
  evidenceIds: string[];
  criteria: Record<Criterion, number | null>;
  rationale: string;
  evidenceLevel: "Illustrative" | "Limited" | "Moderate" | "Strong";
  assumptions: string[];
  uncertainties: string[];
  impact: number;
  risk: number;
  effort: "Low" | "Medium" | "High" | "Unknown";
  alternatives: Alternative[];
  status: DecisionStatus;
  version: number;
  approvedVersion?: number;
  decisionRationale?: string;
  history: RequirementVersion[];
}
export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: AgentId | "PM" | "System";
  action: string;
  category: "Scope" | "Council" | "Decision" | "Evidence" | "Scoring";
  requirementId?: string;
  version?: number;
  before?: string;
  after?: string;
  evidenceIds: string[];
  rationale: string;
}
export type Stage =
  | "topic"
  | "perspectives"
  | "challenge"
  | "assessment"
  | "revision"
  | "proposal"
  | "review";
export interface CouncilEvent {
  id: string;
  stage: Stage;
  actor: AgentId;
  statement: string;
  evidenceIds: string[];
  assumption?: string;
  /** Live agent turn still being generated; the council waits on it. */
  pending?: boolean;
  /** Produced by a live backend agent (e.g. "ollama:qwen3:8b"), not the scripted demo. */
  model?: string;
  /** Deterministic evidence summary for a live turn (records on the topic, of total; thin flag). */
  evidenceBase?: string;
  /** Live debate turn: whom it answers and the stance taken. */
  respondingTo?: string;
  stance?: "agree" | "partly_agree" | "disagree" | "outside_evidence" | "none";
}
export interface CouncilState {
  status: "idle" | "running" | "paused" | "interrupted" | "complete";
  cursor: number;
  elapsedMs: number;
  topic: Topic;
  events: CouncilEvent[];
  discussion: CouncilMessage[];
  handoff: "pending" | "approved" | "review_later" | "rejected";
  challenge?: string;
  run: number;
  /** The customer turns come from the live Customer Agent backend. */
  liveCustomer?: boolean;
}
export interface CouncilMessage {
  id: string;
  actor: "PM" | "judge";
  text: string;
  timestamp: string;
}
export interface Scenario {
  id: string;
  name: string;
  shortName: string;
  weights: Weights;
  assumption: string;
}
export interface DecisionInput {
  requirementId: string;
  expectedVersion: number;
  status: DecisionStatus;
  rationale: string;
  description?: string;
}
export interface AnalysisSnapshot {
  moderator?: import("../council/contracts").ModeratorExport;
  scope: Scope;
  requirements: Requirement[];
  evidence: Evidence[];
  findings: Finding[];
  audit: AuditEvent[];
  weights: Weights;
  council: CouncilState;
}

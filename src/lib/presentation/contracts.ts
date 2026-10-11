export type Audience = "executive" | "finance" | "engineering" | "sales";
export const audienceLabels: Record<Audience, string> = {
  executive: "Executive leadership",
  finance: "Finance",
  engineering: "Engineering",
  sales: "Sales & marketing",
};
export interface FinancialInput {
  value: number | null;
  origin: "sourced" | "pm_estimate" | "synthetic" | "unknown";
  reference: string;
}
export interface FinancialPlan {
  pilot: FinancialInput;
  development: FinancialInput;
  rollout: FinancialInput;
  annual_opex: FinancialInput;
  eligible_volume: FinancialInput;
  contribution: FinancialInput;
  adoption: FinancialInput[];
  discount_rate: FinancialInput;
}
export interface PresentationBrief {
  presenter_name?: string;
  presenter_role?: string;
  meeting_date?: string;
  title: string;
  audience: Audience;
  minutes: number;
  currency: "USD" | "EUR";
  emphasis: string;
  constraints: string;
  funding_structure: "staged" | "upfront";
  financials: FinancialPlan;
}
export interface ScenarioResult {
  name: string;
  benefits: number[];
  cash_flows: number[];
  total_benefit: number;
  total_cost: number;
  net_value: number;
  roi: number | null;
  npv: number;
  break_even_year: number | null;
}
export interface BusinessCase {
  currency: string;
  investment: number | null;
  initial_ask: number | null;
  scenarios: ScenarioResult[];
  missing: string[];
  assumptions: Record<string, unknown>;
  limitations: string[];
  argument: {
    recommendation: string;
    customer_outcomes: string[];
    alternatives: string[];
    dependencies: string[];
    validation_gates: string[];
    objections: string[];
  } | null;
}
export interface SourcePassage {
  id: string;
  source: string;
  location: string;
  passage: string;
  provenance: string;
  limitations: string[];
}
export interface ApprovedDecision {
  id: string;
  version: number;
  title: string;
  description: string;
  pm_rationale: string;
  rationale: string;
  evidence_ids: string[];
  assumptions: string[];
  uncertainties: string[];
  effort: string;
  risk: number | null;
  criteria: Record<string, number | null>;
  alternatives: Record<string, unknown>[];
  debate: Record<string, unknown>[];
  findings: Record<string, unknown>[];
  history: Record<string, unknown>[];
}
export interface ApprovedDecisionSnapshot {
  schema_version: number;
  kind: "isolated_demo" | "dashboard_demo" | "council";
  source_id: string;
  source_hash: string;
  captured_at: string;
  scope: Record<string, unknown>;
  decisions: ApprovedDecision[];
  evidence: SourcePassage[];
  weights: Record<string, number>;
  synthetic: boolean;
  limitations: string[];
}
export interface OutlineItem {
  role?: string;
  section?: string;
  id: string;
  title: string;
  purpose: string;
  decision_ids: string[];
}
export type ThemeId =
  | "legacy-v1"
  | "premium-v1"
  | "bmw-executive-v1"
  | "bmw-executive-v2"
  | "bmw-cinematic-v1";
export interface SlideContentItem {
  label: string;
  detail: string;
  owner: string;
  timing: string;
  dependency: string;
  condition: string;
  source_id: string;
}
export interface SlideContent {
  kind:
    | "problem"
    | "evidence"
    | "portfolio"
    | "journey"
    | "comparison"
    | "responsibilities"
    | "roadmap"
    | "risks";
  items: SlideContentItem[];
}
export interface SlideSpec {
  role?: string;
  section?: string;
  id: string;
  title: string;
  takeaway: string;
  layout:
    | "cover"
    | "evidence"
    | "portfolio"
    | "comparison"
    | "financial"
    | "roadmap"
    | "risk"
    | "closing"
    | "appendix";
  points: string[];
  layout_id?: string | null;
  content?: SlideContent | null;
  notes: string;
  decision_ids: string[];
  evidence_ids: string[];
  locked: boolean;
  synthetic: boolean;
}
export interface DeckDocument {
  theme_id?: ThemeId;
  audience: Audience;
  slides: SlideSpec[];
  complete: boolean;
}
export interface RevisionProposal {
  id: string;
  expected_revision: number;
  audience: Audience;
  instruction: string;
  before: SlideSpec;
  after: SlideSpec;
  status: "pending" | "applied" | "discarded";
}
export interface GenerationJob {
  id: string;
  key: string;
  operation: "outline" | "slides" | "variant" | "revision";
  audience: Audience;
  expected_revision: number;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  progress: number;
  message: string;
  error: string | null;
}
export interface RehearsalSession {
  id: string;
  persona: "cfo" | "engineering" | "executive" | "sales";
  audience: Audience;
  deck_revision: number;
  messages: { role: string; text: string }[];
  feedback: string[];
  complete: boolean;
}
export interface AudienceOutline {
  items: OutlineItem[];
  approved: boolean;
}
export interface DeckRevision {
  audience_outlines?: Partial<Record<Audience, AudienceOutline>>;
  revision: number;
  at: string;
  reason: string;
  snapshot: ApprovedDecisionSnapshot;
  brief: PresentationBrief;
  business_case: BusinessCase;
  outline: OutlineItem[];
  decks: Record<string, DeckDocument>;
}
export interface Presentation {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  mode: "demo" | "ollama";
  snapshot: ApprovedDecisionSnapshot;
  brief: PresentationBrief;
  business_case: BusinessCase;
  outline: OutlineItem[];
  outline_approved: boolean;
  audience_outlines?: Partial<Record<Audience, AudienceOutline>>;
  decks: Partial<Record<Audience, DeckDocument>>;
  dossiers: Record<string, unknown>[];
  proposals: RevisionProposal[];
  jobs: GenerationJob[];
  history: DeckRevision[];
  rehearsals: RehearsalSession[];
  voice_messages: { id: string; role: string; text: string }[];
  events: {
    sequence: number;
    at: string;
    stage: string;
    message: string;
    rationale?: string;
  }[];
  finalized_revision: number | null;
  stale: boolean;
  update_available: boolean;
  review_findings: string[];
}
export interface PresentationList {
  presentations: {
    id: string;
    title: string;
    revision: number;
    mode: string;
    synthetic: boolean;
    source_kind: string;
    updated_at: string;
  }[];
  sessions: {
    id: string;
    status: string;
    approved_count: number;
    proposal_count?: number;
    mode?: string;
    scope?: { vehicle: string; market: string };
    created_at?: string;
  }[];
}

export function departmentOutline(
  p: Presentation,
  audience: Audience,
): AudienceOutline {
  return (
    p.audience_outlines?.[audience] ?? {
      items: audience === p.brief.audience ? p.outline : [],
      approved: audience === p.brief.audience && p.outline_approved,
    }
  );
}

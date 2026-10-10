import type { Source } from "./live";
export type MarketTopic =
  | "Electrification"
  | "Charging"
  | "Digital experience"
  | "Regional demand"
  | "Feature trends";
export interface MarketSeries {
  id: string;
  market: string;
  model: string;
  level: "group" | "model";
  title: string;
  unit: string;
  evidence_id: string;
  yoy: number | null;
  points: {
    year: number;
    value: number;
    kind: "observed" | "supplied" | "planning";
  }[];
}
export interface MarketSignal {
  id: string;
  title: string;
  topic: MarketTopic;
  market: string;
  geography: string;
  period: string;
  kind: string;
  headline: string;
  unit: string;
  summary: string;
  implication: string;
  evidence_id: string;
  published_on: string;
  verified_on: string;
}
export interface MarketDashboard {
  as_of: string;
  series: MarketSeries[];
  signals: MarketSignal[];
  evidence: Source[];
  coverage: string[];
  features: MarketFeature[];
  source_checks: Record<string, SourceCheck>;
}

export interface MarketFeature {
  id: string;
  title: string;
  label: string;
  summary: string;
  question: string;
  evidence_ids: string[];
  examples: { evidence_id: string; status: string; geography: string }[];
  study_ids: string[];
  feedback_query: string;
}
export interface SourceCheck {
  checked_at: string;
  status: "text_matched" | "needs_review" | "blocked" | "unavailable";
  detail: string;
}

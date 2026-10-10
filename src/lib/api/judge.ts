import type {
  AnalysisSnapshot,
  Criterion,
  DecisionInput,
  Weights,
} from "../types";

export interface ArgumentAssessment {
  argument_id: string;
  support: number | null;
  relevance: number | null;
  influence: number | null;
  verdict: string;
  explanation: string;
  citations: { evidence_id: string; quote: string }[];
  assumptions: string[];
  issues: string[];
}
export interface FeatureAssessment {
  feature_id: string;
  feature_version: number;
  recommendation: "recommend" | "revise" | "defer" | "do_not_recommend";
  rationale: string;
  criteria: Record<
    Criterion,
    { value: number | null; argument_ids: string[]; rationale: string }
  >;
  priority: number | null;
  coverage: number;
  evidence_strength:
    "Illustrative" | "Limited" | "Moderate" | "Strong" | "Unknown";
  benefits: string[];
  drawbacks: string[];
  risks: string[];
  assumptions: string[];
  uncertainties: string[];
  alternatives: string[];
  proposed_description: string | null;
  consequential_uncertainty: boolean;
}
export interface JudgeAssessment {
  model?: string | null;
  provider?: string | null;
  id: string;
  created_at: string;
  arguments: ArgumentAssessment[];
  features: FeatureAssessment[];
  weights: Weights;
  constraints: string[];
  ranked_feature_ids: string[];
  next_action: "continue" | "request_clarification" | "pause_for_pm";
  execution: "live" | "demo";
  input_digest: string;
  clarification_requests: string[];
  proposed_priorities: {
    weights: Weights;
    constraints: string[];
    rationale: string;
  } | null;
}
export interface JudgeCouncil {
  input_mode?: "team" | "context" | "demo";
  id: string;
  analysis_id: string;
  mode: "manual" | "auto";
  status: "running" | "paused" | "interrupted" | "complete";
  stage: string;
  revision: number;
  round: number;
  checkpoint: { stage: string; reason: string } | null;
  execution: "live" | "demo";
  assessment: JudgeAssessment | null;
  decisions?: {
    feature_id: string;
    version: number;
    action: string;
    rationale: string;
    assessment_id: string;
    timestamp: string;
  }[];
  request: {
    background?: string;
    scope: {
      vehicle: string;
      market: string;
      powertrain: string;
      horizon: number;
      prompt: string;
    };
    features: {
      id: string;
      version: number;
      title: string;
      description: string;
      topic: string;
    }[];
    arguments: {
      id: string;
      agent: string;
      feature_ids: string[];
      statement: string;
      evidence_ids: string[];
      assumptions: string[];
    }[];
    evidence: {
      id: string;
      source: string;
      location: string;
      passage: string;
      provenance: string;
      source_url?: string | null;
      published_at?: string;
    }[];
    weights: Weights;
    constraints: string[];
  };
  events: {
    id: string;
    sequence: number;
    actor: string;
    stage: string;
    statement: string;
    evidence_ids: string[];
    timestamp: string;
  }[];
}

const base = "/api/judge";
async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let detail = `Judge service returned ${response.status}`;
    try {
      const error = await response.json();
      if (typeof error.detail === "string") detail = error.detail;
      else if (Array.isArray(error.detail))
        detail = error.detail.map((e: { msg: string }) => e.msg).join("; ");
    } catch {
      /* retain HTTP status */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}
export function judgeRequest(snapshot: AnalysisSnapshot) {
  const { vehicle, market, powertrain, horizon, prompt } = snapshot.scope;
  return {
    scope: { vehicle, market, powertrain, horizon, prompt },
    background: snapshot.judgeBackground ?? "",
    features: snapshot.requirements.map(
      ({ id, version, title, description, topic }) => ({
        id,
        version,
        title,
        description,
        topic,
      }),
    ),
    arguments: snapshot.requirements.flatMap((feature) =>
      (["customer", "market", "competitor"] as const).flatMap((domain) => {
        const sources = snapshot.evidence.filter(
          (e) =>
            feature.evidenceIds.includes(e.id) &&
            e.domain === domain &&
            !e.exclusionReason,
        );
        return sources.length
          ? [
              {
                id: `input-${feature.id}-v${feature.version}-${domain}`,
                agent: domain,
                feature_ids: [feature.id],
                statement:
                  `Supplied ${domain} evidence for ${feature.title}:\n` +
                  sources.map((e) => `${e.source}: ${e.passage}`).join("\n"),
                evidence_ids: sources.map((e) => e.id),
                assumptions: [],
              },
            ]
          : [];
      }),
    ),
    evidence: snapshot.evidence.map((e) => ({
      id: e.id,
      domain: e.domain,
      source: e.source,
      location: e.location,
      published_at: e.publishedAt,
      passage: e.passage,
      provenance: e.provenance,
      source_url: e.sourceUrl ?? null,
      exclusion_reason: e.exclusionReason ?? null,
      quantitative: e.quantitative ?? null,
    })),
    weights: snapshot.weights,
    constraints: [],
  };
}
export const judgeApi = {
  create: (
    snapshot: AnalysisSnapshot,
    mode: "manual" | "auto",
    signal?: AbortSignal,
    externalProcessingApproved = false,
  ) =>
    request<JudgeCouncil>(
      `/analyses/${encodeURIComponent(snapshot.scope.confirmedAt ?? "local")}/councils`,
      {
        request: {
          ...judgeRequest(snapshot),
          external_processing_approved: externalProcessingApproved,
        },
        mode,
      },
      signal,
    ),
  control: (
    view: JudgeCouncil,
    action: "continue" | "pause" | "resume" | "interrupt",
    rationale: string,
    signal?: AbortSignal,
  ) =>
    request<JudgeCouncil>(
      `/councils/${view.id}/control`,
      { action, expected_revision: view.revision, rationale },
      signal,
    ),
  message: (
    view: JudgeCouncil,
    content: string,
    id: string,
    signal?: AbortSignal,
  ) =>
    request<JudgeCouncil>(
      `/councils/${view.id}/messages`,
      { id, content, expected_revision: view.revision },
      signal,
    ),
  confirm: (view: JudgeCouncil, rationale: string, signal?: AbortSignal) =>
    request<JudgeCouncil>(
      `/councils/${view.id}/priorities/confirm`,
      {
        expected_revision: view.revision,
        assessment_id: view.assessment?.id,
        rationale,
      },
      signal,
    ),
  decide: (view: JudgeCouncil, input: DecisionInput, signal?: AbortSignal) => {
    const actions: Record<string, string> = {
      Approved: "approve",
      Rejected: "reject",
      Deferred: "defer",
    };
    const original = view.request.features.find(
      (f) => f.id === input.requirementId,
    );
    const edited =
      input.description !== undefined &&
      input.description.trim() !== original?.description;
    const action = edited ? "edit" : actions[input.status];
    if (!action)
      throw new Error(
        "Use PM chat to challenge or request evidence; choose approve, reject, defer, or edit here.",
      );
    return request<JudgeCouncil>(
      `/councils/${view.id}/decisions`,
      {
        id: input.idempotencyKey ?? crypto.randomUUID(),
        feature_id: input.requirementId,
        expected_version: input.expectedVersion,
        assessment_id: input.expectedAssessmentId ?? view.assessment?.id,
        action,
        rationale: input.rationale,
        description: input.description,
      },
      signal,
    );
  },
};

/** Finite, side-effect-free SSE replay. Apply chunks as received; sequence IDs
 * allow reconnect without replaying commands or duplicating transcript rows. */
export async function replayJudgeCouncil(
  id: string,
  after: number,
  onEvent: (event: JudgeCouncil["events"][number]) => void,
  onSnapshot: (view: JudgeCouncil) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`${base}/councils/${id}/events?after=${after}`, {
    signal,
  });
  if (!response.ok || !response.body)
    throw new Error(
      `Unable to reconnect to Judge council (${response.status}).`,
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cursor = after;
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder
        .decode(chunk.value, { stream: !chunk.done })
        .replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = block.split("\n");
        const kind = lines.find((line) => line.startsWith("event: "))?.slice(7);
        const data = lines
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (!data) continue;
        if (kind === "snapshot") onSnapshot(JSON.parse(data));
        if (kind === "council") {
          const event = JSON.parse(data) as JudgeCouncil["events"][number];
          if (event.sequence > cursor) {
            cursor = event.sequence;
            onEvent(event);
          }
        }
      }
      if (chunk.done) break;
    }
  } finally {
    await reader.cancel();
  }
}

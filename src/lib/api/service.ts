import type {
  AnalysisSnapshot,
  CouncilEvent,
  DecisionInput,
  Evidence,
  Requirement,
  Scope,
} from "../types";
import { createFixtures } from "../mock-data";
import { buildCouncilEvents } from "../council/machine";
/** Implement this boundary with authenticated HTTP/SSE for real backend integration.
 * Retrieval authorization belongs on the server, never in a client domain filter. */
export interface IntelligenceService {
  createAnalysis(
    scope: Scope,
    signal?: AbortSignal,
  ): Promise<Pick<AnalysisSnapshot, "evidence" | "findings" | "requirements">>;
  listEvidence(scope: Scope, signal?: AbortSignal): Promise<Evidence[]>;
  streamCouncil(
    requirement: Requirement,
    run: number,
    signal?: AbortSignal,
  ): AsyncIterable<CouncilEvent>;
  saveDecision(input: DecisionInput): Promise<void>;
}
export const demoService: IntelligenceService = {
  async createAnalysis(scope, signal) {
    signal?.throwIfAborted();
    return createFixtures(scope);
  },
  async listEvidence(scope, signal) {
    signal?.throwIfAborted();
    return createFixtures(scope).evidence;
  },
  async *streamCouncil(requirement, run, signal) {
    for (const event of buildCouncilEvents(requirement, run)) {
      signal?.throwIfAborted();
      yield event;
    }
  },
  async saveDecision(input) {
    if (!input.rationale.trim())
      throw new Error("A decision rationale is required.");
  },
};
export const intelligenceService: IntelligenceService = demoService;

/** Production-only operations: implement with backend authorization, transactions,
 * version guards and idempotency. They are intentionally not faked as secure APIs. */
export interface ProductionIntelligenceService extends IntelligenceService {
  getAnalysis(
    analysisId: string,
    signal?: AbortSignal,
  ): Promise<AnalysisSnapshot>;
  commitDecision(
    analysisId: string,
    input: DecisionInput,
    idempotencyKey: string,
  ): Promise<{
    requirement: Requirement;
    audit: AnalysisSnapshot["audit"][number];
  }>;
  excludeEvidence(
    analysisId: string,
    evidenceId: string,
    rationale: string,
    idempotencyKey: string,
  ): Promise<{
    evidence: Evidence;
    reopenedRequirements: Requirement[];
    audit: AnalysisSnapshot["audit"][number];
  }>;
  saveWeights(
    analysisId: string,
    weights: AnalysisSnapshot["weights"],
    rationale: string,
  ): Promise<AnalysisSnapshot["audit"][number]>;
  controlCouncil(
    runId: string,
    action: "pause" | "resume" | "interrupt" | "challenge",
    rationale?: string,
  ): Promise<AnalysisSnapshot["council"]>;
  listAudit(
    analysisId: string,
    signal?: AbortSignal,
  ): Promise<AnalysisSnapshot["audit"]>;
}

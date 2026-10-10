import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  AnalysisSnapshot,
  CouncilEvent,
  CouncilState,
  DecisionInput,
  Scope,
  Topic,
  Weights,
} from "../lib/types";
import { defaultScope } from "../lib/mock-data";
import { initialCouncil, advanceCouncil } from "../lib/council/machine";
import { intelligenceService } from "../lib/api/service";
import { scenarios } from "../lib/scoring";
import { auditEvent } from "../lib/audit";
import { judgeApi } from "../lib/api/judge";
import type { JudgeCouncil } from "../lib/api/judge";
interface AppStore extends AnalysisSnapshot {
  started: boolean;
  persistenceError?: string;
  startAnalysis: (scope: Scope) => Promise<void>;
  decide: (input: DecisionInput) => Promise<void>;
  setWeights: (weights: Weights, reason: string) => void;
  excludeEvidence: (id: string, reason: string) => void;
  startCouncil: (topic: Topic) => Promise<void>;
  controlCouncil: (
    action: "pause" | "resume" | "interrupt" | "challenge",
    reason?: string,
  ) => void;
  tickCouncil: () => void;
  applyJudgeCouncil: (view: JudgeCouncil) => void;
}
const storage = createJSONStorage<AppStore>(() => ({
  getItem(name) {
    try {
      const raw = localStorage.getItem(name);
      if (raw) JSON.parse(raw);
      return raw;
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      localStorage.setItem(name, value);
    } catch {
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event("bmw-storage-error"));
    }
  },
  removeItem(name) {
    try {
      localStorage.removeItem(name);
    } catch {
      /* session continues in memory */
    }
  },
}));
export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      scope: defaultScope,
      started: false,
      evidence: [],
      findings: [],
      requirements: [],
      audit: [],
      weights: scenarios[0].weights,
      council: initialCouncil,
      judgeCouncil: undefined,
      applyJudgeCouncil(view) {
        view = structuredClone(view);
        set(state => {
          if (view.analysis_id !== (state.scope.confirmedAt ?? "local"))
            throw new Error("This Judge response belongs to an earlier analysis.");
          if (state.judgeCouncil?.id === view.id && state.judgeCouncil.revision > view.revision) return state;
          if (!state.judgeCouncil && Object.keys(state.weights).some(key => state.weights[key as keyof Weights] !== view.request.weights[key as keyof Weights]))
            throw new Error("PM priorities changed during evaluation. Start a new Judge council.");
          for (const feature of view.request.features) {
            const current = state.requirements.find(r => r.id === feature.id);
            if (!current || current.version !== feature.version || current.description !== feature.description)
              throw new Error("Features changed during evaluation. Start a new Judge council with the latest versions.");
          }
          const previousEvents = new Set(state.judgeCouncil?.id === view.id ? state.judgeCouncil.events.map(e => e.id) : []);
          const fresh = view.events.filter(e => !previousEvents.has(e.id));
          const changedAssessment = !!view.assessment && state.judgeCouncil?.assessment?.id !== view.assessment.id;
          return {
            judgeCouncil: view,
            weights: view.request.weights,
            requirements: state.requirements.map(r => {
              const assessment = view.assessment?.features.find(f => f.feature_id === r.id);
              if (!assessment) return r;
              const invalidate = changedAssessment && r.status === "Approved";
              const decision = view.decisions?.filter(d => d.feature_id === r.id && d.version === r.version && d.assessment_id === view.assessment?.id).at(-1);
              const recordedStatus = decision?.action === "approve" ? "Approved" as const : decision?.action === "reject" ? "Rejected" as const : decision?.action === "defer" ? "Deferred" as const : undefined;
              return { ...r,
                criteria: Object.fromEntries(Object.entries(assessment.criteria).map(([key, value]) => [key, value.value])) as typeof r.criteria,
                rationale: assessment.rationale,
                evidenceLevel: assessment.evidence_strength,
                assumptions: assessment.assumptions, uncertainties: assessment.uncertainties,
                status: recordedStatus ?? (invalidate ? "Pending review" as const : r.status),
                approvedVersion: recordedStatus === "Approved" ? r.version : recordedStatus || invalidate ? undefined : r.approvedVersion,
              };
            }),
            audit: [...state.audit, ...fresh.map(event => ({
              ...auditEvent({ actor: event.actor as "PM", action: `Judge council · ${event.stage}`,
                category: "Council", evidenceIds: event.evidence_ids, rationale: event.statement }),
              timestamp: event.timestamp,
            })), ...(changedAssessment ? [auditEvent({ actor: "judge", action: "Judge assessment recorded",
              category: "Scoring", evidenceIds: [], rationale: JSON.stringify(view.assessment) })] : [])],
          };
        });
      },
      async startAnalysis(scope) {
        const fixtures = await intelligenceService.createAnalysis(scope);
        const confirmed = { ...scope, confirmedAt: new Date().toISOString() };
        set({
          scope: confirmed,
          started: true,
          ...fixtures,
          weights: scenarios[0].weights,
          council: initialCouncil,
          judgeCouncil: undefined,
          audit: [
            auditEvent({
              actor: "PM",
              action: "Analysis scope confirmed",
              category: "Scope",
              after: JSON.stringify(confirmed),
              evidenceIds: [],
              rationale:
                scope.prompt ||
                "Explore customer priorities with balanced weights.",
            }),
          ],
        });
      },
      async decide(input) {
        if (!input.rationale.trim())
          throw new Error("Add a rationale before recording a decision.");
        const existing = get().requirements.find(
          (r) => r.id === input.requirementId,
        );
        if (!existing || existing.version !== input.expectedVersion)
          throw new Error(
            "This requirement has changed. Close and reopen it to review the latest version.",
          );
        if (input.description !== undefined && !input.description.trim())
          throw new Error("The requirement description cannot be empty.");
        const live = get().judgeCouncil;
        let updatedCouncil: JudgeCouncil | undefined;
        if (live?.request.features.some(f => f.id === input.requirementId)) {
          if (!live.assessment || live.status !== "complete")
            throw new Error("Finish the Judge council and review its latest assessment before deciding.");
          if (input.expectedAssessmentId !== live.assessment.id)
            throw new Error("The Judge assessment changed. Close and reopen the review to inspect the latest assessment.");
          updatedCouncil = await judgeApi.decide(live, input);
          if (get().judgeCouncil?.id !== live.id)
            throw new Error("Analysis inputs changed while recording the decision. Refresh the council before reviewing again.");
        } else await intelligenceService.saveDecision(input);
        set((state) => {
          const original = state.requirements.find(
            (r) => r.id === input.requirementId,
          );
          if (!original || original.version !== input.expectedVersion)
            throw new Error("Version conflict: review the latest requirement.");
          const edited =
            input.description !== undefined &&
            input.description.trim() !== original.description;
          const version = original.version + (edited ? 1 : 0);
          const status = edited ? "Pending review" : input.status;
          const updated = {
            ...original,
            description: input.description?.trim() ?? original.description,
            version,
            status,
            approvedVersion: status === "Approved" ? version : undefined,
            decisionRationale: input.rationale.trim(),
            history: [
              ...original.history,
              {
                version: original.version,
                description: original.description,
                status: original.status,
                at: new Date().toISOString(),
                rationale: input.rationale.trim(),
              },
            ],
          };
          const event = auditEvent({
            actor: "PM",
            action: edited
              ? "Requirement revised"
              : status === "Pending review"
                ? "Requirement reopened"
                : `Requirement ${status.toLowerCase()}`,
            category: "Decision",
            requirementId: original.id,
            version,
            before: `v${original.version} · ${original.status} · ${original.description}`,
            after: `v${version} · ${status} · ${updated.description}`,
            evidenceIds: original.evidenceIds,
            rationale: input.rationale.trim(),
          });
          return {
            requirements: state.requirements.map((r) =>
              r.id === original.id ? updated : r,
            ),
            audit: [...state.audit, event],
          };
        });
        if (updatedCouncil) get().applyJudgeCouncil(updatedCouncil);
      },
      setWeights(weights, reason) {
        set((state) => ({
          weights,
          judgeCouncil: undefined,
          audit: [
            ...state.audit,
            auditEvent({
              actor: "PM",
              action: "Prioritization weights updated",
              category: "Scoring",
              before: JSON.stringify(state.weights),
              after: JSON.stringify(weights),
              evidenceIds: [],
              rationale: reason,
            }),
          ],
        }));
      },
      excludeEvidence(id, reason) {
        if (!reason.trim())
          throw new Error("An exclusion needs an explanation.");
        set((state) => ({
          judgeCouncil: undefined,
          evidence: state.evidence.map((e) =>
            e.id === id ? { ...e, exclusionReason: reason.trim() } : e,
          ),
          requirements: state.requirements.map((r) =>
            r.evidenceIds.includes(id)
              ? {
                  ...r,
                  version: r.version + 1,
                  status: "Pending review",
                  approvedVersion: undefined,
                  history: [
                    ...r.history,
                    {
                      version: r.version,
                      description: r.description,
                      status: r.status,
                      at: new Date().toISOString(),
                      rationale: `Evidence ${id} excluded: ${reason.trim()}`,
                    },
                  ],
                }
              : r,
          ),
          audit: [
            ...state.audit,
            auditEvent({
              actor: "PM",
              action: "Evidence excluded; linked requirements reopened",
              category: "Evidence",
              before: "Included in supporting evidence",
              after: "Excluded from active support",
              evidenceIds: [id],
              rationale: reason.trim(),
            }),
          ],
        }));
      },
      async startCouncil(topic) {
        const state = get();
        const requirement = state.requirements.find((r) => r.topic === topic);
        if (!requirement) return;
        const run = state.council.run + 1;
        const events: CouncilEvent[] = [];
        for await (const event of intelligenceService.streamCouncil(
          requirement,
          run,
        ))
          events.push(event);
        const council: CouncilState = {
          status: "running",
          cursor: 0,
          elapsedMs: 0,
          topic,
          events,
          run,
        };
        set((s) => ({
          council,
          audit: [
            ...s.audit,
            auditEvent({
              actor: "moderator",
              action: `Council run ${run} started`,
              category: "Council",
              requirementId: requirement.id,
              version: requirement.version,
              evidenceIds: requirement.evidenceIds,
              rationale: events[0].statement,
            }),
          ],
        }));
      },
      controlCouncil(action, reason) {
        set((state) => {
          if (
            state.council.status === "idle" ||
            state.council.status === "complete"
          )
            return state;
          if (action === "challenge" && !reason?.trim()) return state;
          const status =
            action === "resume"
              ? "running"
              : action === "interrupt"
                ? "interrupted"
                : "paused";
          return {
            council: {
              ...state.council,
              status,
              challenge:
                action === "challenge" ? reason : state.council.challenge,
            },
            audit: [
              ...state.audit,
              auditEvent({
                actor: "PM",
                action: `Council ${action}`,
                category: "Council",
                evidenceIds: [],
                rationale:
                  reason || `PM requested ${action} at the current stage.`,
              }),
            ],
          };
        });
      },
      tickCouncil() {
        set((state) => {
          const council = advanceCouncil(state.council);
          if (council === state.council) return state;
          const event = council.events[council.cursor];
          return {
            council,
            audit: [
              ...state.audit,
              auditEvent({
                actor: event.actor,
                action: `Council · ${event.stage}`,
                category: "Council",
                evidenceIds: event.evidenceIds,
                rationale: event.statement,
              }),
            ],
          };
        });
      },
    }),
    {
      name: "bmw-next-demo-v1",
      version: 1,
      storage,
      merge: (persisted, current) => {
        const p = persisted as Partial<AppStore> | undefined;
        if (
          !p ||
          !p.scope ||
          !Array.isArray(p.requirements) ||
          !Array.isArray(p.audit) ||
          !p.council
        )
          return current;
        return {
          ...current,
          ...p,
          council: {
            ...p.council,
            status:
              p.council.status === "running" ? "paused" : p.council.status,
          },
        };
      },
    },
  ),
);

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  AnalysisSnapshot,
  CouncilMessage,
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
  recordCouncilMessage: (message: Omit<CouncilMessage, "timestamp">) => void;
  setCouncilHandoff: (
    handoff: "pending" | "approved" | "review_later" | "rejected",
  ) => void;
  deferCouncilReview: () => void;
  tickCouncil: () => void;
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
      async startAnalysis(scope) {
        const fixtures = await intelligenceService.createAnalysis(scope);
        const confirmed = { ...scope, confirmedAt: new Date().toISOString() };
        set({
          scope: confirmed,
          started: true,
          ...fixtures,
          weights: scenarios[0].weights,
          council: initialCouncil,
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
        await intelligenceService.saveDecision(input);
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
      },
      setWeights(weights, reason) {
        set((state) => ({
          weights,
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
      recordCouncilMessage(message) {
        const requirement = get().requirements.find(
          (r) => r.topic === get().council.topic,
        );
        const saved: CouncilMessage = {
          ...message,
          timestamp: new Date().toISOString(),
        };
        set((state) => {
          if (state.council.discussion.some((item) => item.id === saved.id))
            return state;
          return {
            council: {
              ...state.council,
              discussion: [...state.council.discussion, saved].slice(-40),
            },
            audit: [
              ...state.audit,
              auditEvent({
                actor: saved.actor,
                action:
                  saved.actor === "PM"
                    ? "PM discussed recommendation with Judge"
                    : "Judge explained recommendation to PM",
                category: "Council",
                requirementId: requirement?.id,
                version: requirement?.version,
                evidenceIds: requirement?.evidenceIds ?? [],
                rationale: saved.text,
              }),
            ],
          };
        });
      },
      setCouncilHandoff(handoff) {
        set((state) => ({
          council: { ...state.council, handoff },
        }));
      },
      deferCouncilReview() {
        const state = get();
        const requirement = state.requirements.find(
          (r) => r.topic === state.council.topic,
        );
        if (!requirement) return;
        set((current) => ({
          council: { ...current.council, handoff: "review_later" },
          audit: [
            ...current.audit,
            auditEvent({
              actor: "PM",
              action: "PM deferred Judge recommendation for later review",
              category: "Council",
              requirementId: requirement.id,
              version: requirement.version,
              evidenceIds: requirement.evidenceIds,
              rationale: "PM selected Review later at the Judge handoff.",
            }),
          ],
        }));
      },
      excludeEvidence(id, reason) {
        if (!reason.trim())
          throw new Error("An exclusion needs an explanation.");
        set((state) => ({
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
          discussion: [],
          handoff: "pending",
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
            discussion: p.council.discussion ?? [],
            handoff: p.council.handoff ?? "pending",
            status:
              p.council.status === "running" ? "paused" : p.council.status,
          },
        };
      },
    },
  ),
);

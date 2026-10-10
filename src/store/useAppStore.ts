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
import { customerBackendAvailable, fetchCustomerPerspective } from "../lib/api/customer";
import type { CustomerEvidence, CustomerPerspectiveRequest } from "../lib/api/customer";
import { scenarios } from "../lib/scoring";
import { auditEvent } from "../lib/audit";
/** Customer Intelligence filters; shared so the Council page can reuse the same scope. */
export interface CustomerScopeFilters {
  vehicle: string;
  market: string;
  powertrain: string;
  source: string;
  category: string;
  feedbackType: string;
  query: string;
}
interface AppStore extends AnalysisSnapshot {
  started: boolean;
  customerFilters?: CustomerScopeFilters;
  /** Feedback records cited by the live Customer Agent in the council (real BMW data). */
  councilEvidence: CustomerEvidence[];
  setCustomerFilters: (filters: CustomerScopeFilters) => void;
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
  requestCustomerTurn: (run: number, eventId: string, req: CustomerPerspectiveRequest) => Promise<void>;
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
      councilEvidence: [],
      setCustomerFilters(customerFilters) {
        set({ customerFilters });
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
        // Customer turns come from the live Customer Agent when its backend is up;
        // the other agents stay scripted. The council waits on pending turns.
        const live = await customerBackendAvailable();
        const turns: { id: string; req: CustomerPerspectiveRequest }[] = [];
        if (live) {
          const customerScope = { vehicle: requirement.vehicle, market: requirement.market, powertrain: null };
          events.forEach((e, i) => {
            if (e.actor !== "customer" || !["perspectives", "challenge", "revision"].includes(e.stage)) return;
            const prev = events[i - 1];
            const stage = e.stage as CustomerPerspectiveRequest["stage"];
            // The discussion so far (scripted turns), so the customer argues with what was actually said.
            const context = events
              .slice(0, i)
              .filter((x) => x.actor !== "customer")
              .map((x) => ({ actor: x.actor, statement: x.statement }));
            turns.push({
              id: e.id,
              req: {
                scope: customerScope,
                topic,
                stage,
                question: `How should the next ${requirement.vehicle} improve ${topic.toLowerCase()} for customers in ${requirement.market}?`,
                challenge: stage === "perspectives" ? "" : (prev?.statement ?? ""),
                context,
              },
            });
            events[i] = { ...e, pending: true, statement: "", evidenceIds: [], assumption: undefined };
          });
        }
        const council: CouncilState = {
          status: "running",
          cursor: 0,
          elapsedMs: 0,
          topic,
          events,
          discussion: [],
          handoff: "pending",
          run,
          liveCustomer: live,
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
        turns.forEach((t) => get().requestCustomerTurn(run, t.id, t.req));
      },
      async requestCustomerTurn(run, eventId, req) {
        const patch = (fields: Partial<CouncilEvent>, cited: CustomerEvidence[] = []) =>
          set((s) => {
            if (s.council.run !== run) return s; // a newer run replaced this one
            const known = new Set(s.councilEvidence.map((e) => e.id));
            return {
              council: { ...s.council, events: s.council.events.map((e) => (e.id === eventId ? { ...e, ...fields, pending: false } : e)) },
              councilEvidence: [...s.councilEvidence, ...cited.filter((e) => !known.has(e.id))],
            };
          });
        try {
          const turn = await fetchCustomerPerspective(req);
          const notes = [turn.assumption, ...turn.uncertainties].filter(Boolean).join(" ");
          const reply = turn.counterQuestion ? `${turn.statement} ${turn.counterQuestion}` : turn.statement;
          patch(
            {
              statement: turn.recommendation ? `${reply} Recommendation: ${turn.recommendation}` : reply,
              evidenceBase: turn.evidenceBase || undefined,
              respondingTo: turn.respondingTo || undefined,
              stance: turn.stance,
              evidenceIds: turn.evidenceIds,
              assumption: notes || "Based on supplied BMW customer feedback; shares describe the feedback, not all customers.",
              model: turn.model,
            },
            turn.evidence,
          );
        } catch (e) {
          patch({
            statement: "The Customer Agent could not respond for this turn.",
            evidenceIds: [],
            assumption: `Customer Agent error: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
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
          let events = state.council.events;
          if (action === "challenge" && state.council.liveCustomer) {
            // The live Customer Agent answers the PM's challenge right after the current turn.
            const requirement = state.requirements.find((r) => r.topic === state.council.topic);
            const id = `run-${state.council.run}-pm-challenge-${events.length}`;
            const at = state.council.cursor + 1;
            events = [...events.slice(0, at), { id, stage: "challenge", actor: "customer", statement: "", evidenceIds: [], pending: true }, ...events.slice(at)];
            const run = state.council.run;
            queueMicrotask(() =>
              get().requestCustomerTurn(run, id, {
                scope: { vehicle: requirement?.vehicle ?? state.scope.vehicle, market: requirement?.market ?? state.scope.market, powertrain: null },
                topic: state.council.topic,
                stage: "challenge",
                challenge: reason ?? "",
                context: [
                  ...state.council.events
                    .slice(0, state.council.cursor + 1)
                    .filter((x) => !x.pending && x.statement)
                    .map((x) => ({ actor: x.actor, statement: x.statement })),
                  { actor: "PM", statement: reason ?? "" },
                ],
              }),
            );
          }
          return {
            council: {
              ...state.council,
              events,
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
          councilEvidence: Array.isArray(p.councilEvidence) ? p.councilEvidence : [],
          council: {
            ...p.council,
            events: p.council.events.map((e) =>
              e.pending ? { ...e, pending: false, statement: "This live Customer Agent turn was interrupted by a page reload.", assumption: "Start a new discussion to regenerate it." } : e,
            ),
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

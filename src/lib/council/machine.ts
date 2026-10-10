import type {
  AgentId,
  AgentState,
  CouncilEvent,
  CouncilState,
  Requirement,
  Stage,
} from "../types";
export const stages: { id: Stage; label: string }[] = [
  { id: "topic", label: "Topic" },
  { id: "perspectives", label: "Perspectives" },
  { id: "challenge", label: "Challenge" },
  { id: "assessment", label: "Assessment" },
  { id: "revision", label: "Revision" },
  { id: "proposal", label: "Proposal" },
  { id: "review", label: "PM review" },
];
export const MAX_DURATION_MS = 120000;
export const initialCouncil: CouncilState = {
  status: "idle",
  cursor: -1,
  elapsedMs: 0,
  topic: "Displays",
  events: [],
  run: 0,
};
export function buildCouncilEvents(
  requirement: Requirement,
  run: number,
): CouncilEvent[] {
  const [customer1, customer2, market, competitor] = requirement.evidenceIds;
  const base: Omit<CouncilEvent, "id">[] = [
    {
      stage: "topic",
      actor: "moderator",
      statement: `Our question: how should the next ${requirement.vehicle} improve ${requirement.topic.toLowerCase()} for ${requirement.market}? We will hear three perspectives, one challenge round, then an assessment.`,
      evidenceIds: [],
    },
    {
      stage: "perspectives",
      actor: "customer",
      statement: `The demo statements point to a clear friction: ${requirement.title.toLowerCase()}. Prioritize an understandable everyday experience, while preserving the qualities customers already appreciate.`,
      evidenceIds: [customer1, customer2],
      assumption:
        "Demo records are illustrative, not a representative customer sample.",
    },
    {
      stage: "perspectives",
      actor: "market",
      statement:
        "This need could remain relevant over the planning horizon. The direction is plausible, but a market forecast cannot be inferred from our illustrative trend series.",
      evidenceIds: [market],
      assumption: "Future demand and expectations are uncertain.",
    },
    {
      stage: "perspectives",
      actor: "competitor",
      statement:
        "The comparison suggests a possible experience gap. Before recommending feature parity, compare equivalent models, configurations and regional availability.",
      evidenceIds: [competitor],
      assumption:
        "Competitor comparisons are hypothetical and need public-source validation.",
    },
    {
      stage: "challenge",
      actor: "competitor",
      statement:
        "I challenge the implied prevalence of this need. Two synthetic statements cannot establish how many customers experience it. Would a targeted usability study change our priority?",
      evidenceIds: [customer1, customer2],
    },
    {
      stage: "challenge",
      actor: "customer",
      statement:
        "Agreed on the limitation. The provisional requirement addresses an observable type of friction; its scale is unknown. A customer study should test severity and frequency independently.",
      evidenceIds: [customer1],
    },
    {
      stage: "assessment",
      actor: "judge",
      statement:
        "Provisional assessment: the customer-facing requirement is coherent, but evidence is illustrative. Keep prevalence, competitive advantage and feasibility unresolved. Human validation is required before approval.",
      evidenceIds: requirement.evidenceIds,
      assumption:
        "The judge is fallible. Its rubric and assessment remain open to challenge.",
    },
    {
      stage: "revision",
      actor: "moderator",
      statement:
        "One targeted clarification: can we retain a lower-effort alternative while validating the need? Record both approaches; do not resolve the disagreement by inventing certainty.",
      evidenceIds: [],
    },
    {
      stage: "revision",
      actor: "customer",
      statement:
        "Yes. Compare improving the existing interaction with a broader redesign. Customer testing should establish whether the smaller change resolves the friction.",
      evidenceIds: [customer2],
    },
    {
      stage: "proposal",
      actor: "judge",
      statement: `Proposed requirement: ${requirement.description} Keep the alternatives and uncertainties visible in the decision record.`,
      evidenceIds: requirement.evidenceIds,
    },
    {
      stage: "review",
      actor: "moderator",
      statement:
        "The council has completed its bounded discussion. The proposal is ready for your review. No requirement has been approved automatically.",
      evidenceIds: requirement.evidenceIds,
    },
  ];
  return base.map((event, i) => ({ ...event, id: `run-${run}-event-${i}` }));
}
export function advanceCouncil(
  state: CouncilState,
  elapsedMs = 4200,
): CouncilState {
  if (state.status !== "running") return state;
  // A live agent turn is still being generated: wait for it (waiting time is not counted).
  if (state.events[state.cursor + 1]?.pending) return state;
  if (state.elapsedMs + elapsedMs > MAX_DURATION_MS)
    return { ...state, status: "paused", elapsedMs: MAX_DURATION_MS };
  const cursor = Math.min(state.cursor + 1, state.events.length - 1);
  return {
    ...state,
    cursor,
    elapsedMs: state.elapsedMs + elapsedMs,
    status: cursor === state.events.length - 1 ? "complete" : "running",
  };
}
export function avatarState(state: CouncilState, agent: AgentId): AgentState {
  if (state.status === "paused" || state.status === "interrupted")
    return "paused";
  if (state.status === "complete") return "complete";
  const event = state.events[state.cursor];
  if (!event) return "idle";
  if (state.events[state.cursor + 1]?.pending && state.events[state.cursor + 1].actor === agent)
    return "thinking";
  if (event.actor !== agent) return "waiting";
  return event.stage === "challenge"
    ? "challenging"
    : agent === "judge"
      ? "evaluating"
      : "speaking";
}

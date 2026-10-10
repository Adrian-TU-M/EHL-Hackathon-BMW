import type { AgentId, AgentState, CouncilState } from "../types";
export const initialCouncil: CouncilState = {
  status: "idle",
  cursor: -1,
  elapsedMs: 0,
  topic: "Displays",
  events: [],
  run: 0,
};
export function avatarState(state: CouncilState, agent: AgentId): AgentState {
  if (state.status === "paused" || state.status === "interrupted")
    return "paused";
  if (state.status === "complete") return "complete";
  const event = state.events[state.cursor];
  if (!event) return "idle";
  if (event.actor !== agent) return "waiting";
  return event.stage === "challenge"
    ? "challenging"
    : agent === "judge"
      ? "evaluating"
      : "speaking";
}

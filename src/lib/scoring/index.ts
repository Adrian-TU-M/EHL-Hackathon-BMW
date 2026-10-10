import type { Criterion, Requirement, Scenario, Weights } from "../types";
export const criterionLabels: Record<Criterion, string> = {
  need: "Customer need",
  severity: "Issue severity",
  gap: "Competitive gap",
  future: "Future relevance",
  feasibility: "Ease of implementation",
};
export const scenarios: Scenario[] = [
  {
    id: "balanced",
    name: "Balanced strategy",
    shortName: "Balanced",
    weights: { need: 30, severity: 25, gap: 15, future: 20, feasibility: 10 },
    assumption:
      "Present customer friction and future relevance receive a balanced emphasis.",
  },
  {
    id: "customer",
    name: "Customer experience",
    shortName: "Customer first",
    weights: { need: 40, severity: 35, gap: 5, future: 10, feasibility: 10 },
    assumption:
      "Reducing reported friction matters more than adding novel capabilities.",
  },
  {
    id: "innovation",
    name: "Future innovation",
    shortName: "Future focused",
    weights: { need: 15, severity: 10, gap: 25, future: 45, feasibility: 5 },
    assumption:
      "Digital expectations evolve quickly; future signals receive more emphasis.",
  },
  {
    id: "effort",
    name: "Low-effort improvements",
    shortName: "Lower effort",
    weights: { need: 20, severity: 15, gap: 5, future: 10, feasibility: 50 },
    assumption:
      "Lower estimated effort is preferred; effort remains an unvalidated qualitative assessment.",
  },
];
export function scoreRequirement(
  requirement: Pick<Requirement, "criteria">,
  weights: Weights,
) {
  let sum = 0,
    known = 0,
    total = 0;
  for (const key of Object.keys(weights) as Criterion[]) {
    const weight = Math.max(0, weights[key]);
    total += weight;
    const value = requirement.criteria[key];
    if (value !== null && Number.isFinite(value)) {
      known += weight;
      sum += (Math.min(5, Math.max(0, value)) / 5) * weight;
    }
  }
  return {
    score: known ? Math.round((100 * sum) / known) : null,
    coverage: total ? Math.round((100 * known) / total) : 0,
  };
}
export function ranked(requirements: Requirement[], weights: Weights) {
  return [...requirements].sort(
    (a, b) =>
      (scoreRequirement(b, weights).score ?? -1) -
      (scoreRequirement(a, weights).score ?? -1),
  );
}

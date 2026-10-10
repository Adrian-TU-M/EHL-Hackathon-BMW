import type { Evidence, Market, Scope, Topic } from "../types";
export const studyCategories: Topic[] = ["Displays", "Seats", "Interior"];
const responses: Record<Market, number[][]> = {
  Europe: [
    [2, 3, 3, 2, 4, 3, 2, 3],
    [4, 3, 4, 3, 5, 4, 3, 4],
    [4, 4, 3, 4, 5, 4, 4, 3],
  ],
  "United States": [
    [3, 3, 2, 4, 3, 3, 2, 4],
    [4, 4, 4, 3, 5, 4, 4, 3],
    [3, 4, 3, 4, 4, 3, 4, 4],
  ],
  China: [
    [3, 4, 3, 3, 4, 3, 2, 4],
    [3, 3, 4, 3, 4, 3, 3, 4],
    [4, 4, 5, 3, 4, 4, 4, 4],
  ],
};
export function studyRows(market: Market) {
  return studyCategories.map((category, i) => ({
    category,
    values: responses[market][i],
    mean: Number(
      (
        responses[market][i].reduce((a, b) => a + b, 0) /
        responses[market][i].length
      ).toFixed(2),
    ),
    id: `DEMO-S-${market.replace(/\s/g, "")}-${i + 1}`,
  }));
}
export function createStudyEvidence(scope: Scope): Evidence[] {
  return (Object.keys(responses) as Market[]).flatMap((market) =>
    studyRows(market).map((row) => ({
      id: row.id,
      domain: "customer",
      source: "Synthetic satisfaction-study examples",
      location: `${market} / ${row.category} / eight invented 1-5 ratings`,
      publishedAt: "2026-09-10",
      provenance: "synthetic",
      vehicle: scope.vehicle,
      market,
      powertrain: scope.powertrain,
      category: row.category,
      type: "Signal",
      passage: `Illustrative ${row.category.toLowerCase()} satisfaction: ${row.mean}/5, calculated from eight invented ratings [${row.values.join(", ")}]. No real customer study or population inference is represented.`,
      quantitative: {
        numerator: row.values.reduce((a, b) => a + b, 0),
        denominator: row.values.length,
        unit: "rating points / synthetic responses",
        filters: [scope.vehicle, market, scope.powertrain, row.category],
        period: "Synthetic fixture / September 2026",
        method:
          "Arithmetic mean of eight explicitly listed 1-5 demo ratings; no weighting or confidence interval.",
        limitations:
          "Small invented sample. Regional differences are illustrative, not statistically meaningful or evidence about actual customers.",
      },
    })),
  );
}

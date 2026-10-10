/** Demo fallback for the Customer Intelligence page when the backend is unreachable.
 * Built from the existing synthetic fixtures (src/lib/mock-data) and always flagged
 * `dataSource: "demo"` so demo numbers are never shown as real ones. */
import { createFixtures } from "../mock-data";
import type { Evidence, Market, Powertrain, Vehicle } from "../types";
import type { CustomerDataSource, CustomerEvidence, CustomerFilters, FeatureRanking, FeatureRow, QuantitativeClaim } from "./customer";

const TYPE_OF: Record<string, string> = { Positive: "Likes", Complaint: "Difficult to Use", Request: "Wants" };
const DEMO_MARKETS: Market[] = ["Europe", "United States", "China"];
const LIMITS =
  "Synthetic demo fixtures: hand-written statements that illustrate the workflow. They are not BMW feedback and say nothing about prevalence.";

function fixtureRecords(f: CustomerFilters): CustomerEvidence[] {
  const markets = f.market === "All" ? DEMO_MARKETS : DEMO_MARKETS.filter((m) => m === f.market);
  const powertrains: Powertrain[] =
    f.powertrain === "All" ? ["Electric", "Plug-in hybrid", "Combustion"] : [f.powertrain as Powertrain];
  const out: CustomerEvidence[] = [];
  for (const market of markets)
    for (const powertrain of powertrains) {
      const { evidence } = createFixtures({ vehicle: f.vehicle as Vehicle, market, powertrain, horizon: 4, prompt: "" });
      evidence
        .filter((e: Evidence) => e.domain === "customer" && e.type !== "Signal")
        .forEach((e) =>
          out.push({
            id: `${e.id}-${market.slice(0, 2).toUpperCase()}-${powertrain.slice(0, 1)}`,
            domain: "customer",
            source: e.source,
            location: e.location,
            publishedAt: e.publishedAt,
            provenance: "synthetic",
            vehicle: e.vehicle,
            market,
            country: "",
            powertrain,
            category: e.category,
            theme: e.category,
            topic: e.category,
            subcategories: [e.category],
            type: e.type === "Positive" ? "Positive" : e.type === "Request" ? "Request" : "Complaint",
            feedbackTypes: [TYPE_OF[e.type] ?? "Unclassified"],
            passage: e.passage,
            classificationRows: 1,
            channel: "Demo fixtures",
            severity: null,
            quantitative: null,
          }),
        );
    }
  return out.filter((e) => f.category === "All" || e.category === f.category);
}

function side(records: CustomerEvidence[], polarities: string[]): FeatureRow[] {
  const byCategory = new Map<string, CustomerEvidence[]>();
  records
    .filter((r) => polarities.includes(r.type))
    .forEach((r) => byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]));
  return [...byCategory]
    .map(([category, rs]) => ({
      category,
      theme: category,
      records: rs.length,
      byType: rs.reduce<Record<string, number>>((acc, r) => {
        r.feedbackTypes.forEach((t) => (acc[t] = (acc[t] ?? 0) + 1));
        return acc;
      }, {}),
    }))
    .sort((a, b) => b.records - a.records || a.category.localeCompare(b.category));
}

export function demoFeatures(f: CustomerFilters): FeatureRanking {
  const records = fixtureRecords(f);
  return {
    filters: f,
    dataSource: "demo",
    records: records.length,
    dislikes: side(records, ["Complaint"]),
    likes: side(records, ["Positive", "Request"]),
    coverage: {
      feedbackRows: records.length,
      uniqueRecords: records.length,
      uniqueCustomers: null,
      customersIdentifiable: false,
      byPolarity: {},
      byPowertrain: {},
      byChannel: {},
      studies: [],
      available: [],
      warnings: ["Customer Agent backend is unreachable: showing synthetic DEMO data, not BMW feedback."],
    },
  };
}

function claim(f: CustomerFilters, numerator: number, denominator: number): QuantitativeClaim {
  return {
    numerator,
    denominator,
    unit: "synthetic demo records",
    sourceId: "src/lib/mock-data (synthetic)",
    filters: Object.entries(f).map(([k, v]) => `${k}=${v}`),
    market: f.market,
    period: "not applicable (synthetic)",
    method: "Demo records matching the selection ÷ all demo records in scope.",
    limitations: LIMITS,
  };
}

export const demoCustomerSource: CustomerDataSource = {
  mode: "demo",
  async features(f) {
    return demoFeatures(f);
  },
  async drilldown(f, { type }) {
    const all = fixtureRecords({ ...f, category: "All" }).length;
    const items = fixtureRecords(f).filter((r) => !type || r.type === type || r.feedbackTypes.includes(type));
    return {
      category: f.category === "All" ? null : f.category,
      theme: f.category === "All" ? null : f.category,
      type: type ?? null,
      claim: claim(f, items.length, all),
      subcategories: [],
      studyRefs: [],
      quotes: { total: items.length, offset: 0, items: items.slice(0, 30) },
    };
  },
};

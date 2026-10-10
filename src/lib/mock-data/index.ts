import { createStudyEvidence } from "./studies";
import type { Evidence, Finding, Requirement, Scope, Topic } from "../types";
export const vehicleNames = {
  F70: "1 Series",
  G60: "5 Series",
  G70: "7 Series",
};
export const defaultScope: Scope = {
  vehicle: "G60",
  market: "Europe",
  powertrain: "Electric",
  horizon: 4,
  prompt: "",
};
export const topics: Topic[] = [
  "Displays",
  "Charging",
  "Seats",
  "Trunk",
  "Interior",
  "Driving controls",
  "Exterior",
];
const passages: Record<Topic, [string, string, string]> = {
  Displays: [
    "I have to look away from the road to find the temperature control.",
    "Let me pin the controls I use every day to one place.",
    "The large display is clear and the navigation is easy to read.",
  ],
  Charging: [
    "A stop looked available in the route planner, but the chargers were occupied.",
    "I would like a clearer arrival-charge estimate before choosing a stop.",
    "Planning a long electric trip is simple when charging information is current.",
  ],
  Seats: [
    "The rear seat needs more support on longer journeys.",
    "Give rear passengers simpler climate and comfort controls.",
    "The cabin feels quiet and comfortable on motorway journeys.",
  ],
  Trunk: [
    "The opening makes it awkward to load a large suitcase.",
    "Show whether my regular luggage will fit before I order.",
    "Everyday shopping fits comfortably in the luggage compartment.",
  ],
  Interior: [
    "My phone and keys do not have a natural place to sit.",
    "I want storage that is easy to reach without looking.",
    "The cabin materials feel considered and pleasant to touch.",
  ],
  "Driving controls": [
    "The assistance settings take too many steps to change.",
    "Make assistance status and handover instructions clearer.",
    "The steering response feels composed and predictable.",
  ],
  Exterior: [
    "It is difficult to judge the front corners in a tight parking space.",
    "Make low-speed maneuvering easier to understand.",
    "The exterior proportions feel confident and well balanced.",
  ],
};
const titles: Record<Topic, [string, string]> = {
  Displays: [
    "Everyday controls, one step away",
    "Give drivers persistent, quickly accessible climate and essential controls with clear feedback, minimizing visual search during normal use.",
  ],
  Charging: [
    "Confidence at every charging stop",
    "Make journey planning communicate charging availability, arrival charge uncertainty, and an understandable fallback stop.",
  ],
  Seats: [
    "Comfort for every passenger",
    "Improve perceived rear-seat support and make comfort adjustments easy to discover on longer journeys.",
  ],
  Trunk: [
    "A more useful luggage experience",
    "Make everyday loading easier and communicate luggage-space usability through practical customer scenarios.",
  ],
  Interior: [
    "A place for the everyday",
    "Provide intuitive, accessible storage for phones, keys and small personal items without creating cabin clutter.",
  ],
  "Driving controls": [
    "Assistance that feels intuitive",
    "Make assistance status, settings and transitions easy to understand and control with minimal distraction.",
  ],
  Exterior: [
    "Clarity in close quarters",
    "Help drivers judge vehicle boundaries and maneuver confidently in constrained parking environments.",
  ],
};
export function createFixtures(scope: Scope) {
  const available = topics.filter(
    (t) => t !== "Charging" || scope.powertrain !== "Combustion",
  );
  const evidence: Evidence[] = available.flatMap((category, i) =>
    passages[category].map((passage, j) => ({
      id: `DEMO-C${i + 1}${j + 1}`,
      domain: "customer" as const,
      source: "Synthetic customer feedback collection",
      location: `Fixture record ${i * 3 + j + 1} · one distinct demo record`,
      publishedAt: "2026-09-01",
      provenance: "synthetic" as const,
      vehicle: scope.vehicle,
      market: scope.market,
      powertrain: scope.powertrain,
      category,
      type: (["Complaint", "Request", "Positive"] as const)[j],
      passage,
    })),
  );
  available.forEach((category, i) => {
    evidence.push({
      id: `DEMO-M${i + 1}`,
      domain: "market",
      source: "Illustrative market outlook",
      location: `Scenario note ${i + 1}`,
      publishedAt: "2026-09-15",
      provenance: "synthetic",
      ...scope,
      category,
      type: "Signal",
      passage: `Assumption: customers in ${scope.market} may place greater value on ${category.toLowerCase()} over the next ${scope.horizon} years. This has not been validated against the supplied studies or sales files.`,
    });
    evidence.push({
      id: `DEMO-K${i + 1}`,
      domain: "competitor",
      source: "Illustrative comparison matrix",
      location: `Comparator scenario ${i + 1} · unnamed reference vehicles`,
      publishedAt: "2026-09-18",
      provenance: "synthetic",
      ...scope,
      category,
      type: "Signal",
      passage: `A hypothetical peer offers a more discoverable ${category.toLowerCase()} experience. Real model, trim, market and equipment availability need verification before this is used for a product decision.`,
    });
  });
  const findings: Finding[] = available.map((topic, i) => ({
    id: `F-${String(i + 1).padStart(3, "0")}`,
    topic,
    title: titles[topic][0],
    detail: titles[topic][1],
    evidenceIds: [`DEMO-C${i + 1}1`, `DEMO-C${i + 1}2`],
    uncertainty:
      "Synthetic statements illustrate the workflow; they do not establish prevalence among BMW customers.",
  }));
  const criteria = [
    [5, 5, 3, 4, 4],
    [5, 4, 4, 5, 2],
    [4, 3, 3, 3, 2],
    [3, 3, 2, 3, 4],
    [3, 2, 2, 3, 5],
    [4, 4, 3, 4, null],
    [2, 3, 3, 3, 3],
  ];
  const requirements: Requirement[] = available.map((topic, i) => {
    const originalIndex = topics.indexOf(topic),
      c = criteria[originalIndex];
    return {
      id: `REQ-${String(i + 1).padStart(3, "0")}`,
      vehicle: scope.vehicle,
      market: scope.market,
      powertrain: scope.powertrain,
      topic,
      title: titles[topic][0],
      description: titles[topic][1],
      findingIds: [findings[i].id],
      evidenceIds: [
        `DEMO-C${i + 1}1`,
        `DEMO-C${i + 1}2`,
        `DEMO-M${i + 1}`,
        `DEMO-K${i + 1}`,
      ],
      criteria: {
        need: c[0],
        severity: c[1],
        gap: c[2],
        future: c[3],
        feasibility: c[4],
      },
      rationale:
        "Illustrative 0–5 rubric values emphasize reported friction, severity and future relevance. These assessments require validation with real evidence.",
      evidenceLevel: "Illustrative",
      assumptions: [
        "The demo feedback represents a relevant customer need.",
        "Customer expectations remain relevant over the selected planning horizon.",
      ],
      uncertainties: [
        "No real customer sample has been analyzed.",
        "Implementation effort needs an engineering review.",
      ],
      impact: [5, 5, 4, 3, 3, 4, 3][originalIndex],
      risk: [2, 4, 3, 2, 1, 4, 2][originalIndex],
      effort:
        c[4] === null
          ? "Unknown"
          : (c[4] ?? 0) >= 4
            ? "Low"
            : (c[4] ?? 0) >= 3
              ? "Medium"
              : "High",
      alternatives: [
        {
          title: "Improve the current experience",
          impact: 3,
          risk: 2,
          effort: "Lower",
          uncertainty: "May leave the underlying need partly unresolved.",
        },
        {
          title: "Explore a redesigned experience",
          impact: 5,
          risk: 4,
          effort: "Higher",
          uncertainty: "Requires customer validation and feasibility work.",
        },
        {
          title: "Retain and monitor",
          impact: 1,
          risk: 2,
          effort: "Low",
          uncertainty: "The customer friction could persist.",
        },
      ],
      status: "Pending review",
      version: 1,
      history: [],
    };
  });
  return {
    evidence: [...evidence, ...createStudyEvidence(scope)],
    findings,
    requirements,
  };
}
export const marketSeries = [
  {
    year: "2024",
    Europe: 92,
    "United States": 67,
    China: 105,
    kind: "Historical demo",
  },
  {
    year: "2025",
    Europe: 99,
    "United States": 70,
    China: 101,
    kind: "Historical demo",
  },
  {
    year: "2026",
    Europe: 103,
    "United States": 73,
    China: 103,
    kind: "Assumption",
  },
  {
    year: "2027",
    Europe: 109,
    "United States": 76,
    China: 107,
    kind: "Assumption",
  },
  {
    year: "2028",
    Europe: 116,
    "United States": 80,
    China: 112,
    kind: "Assumption",
  },
  {
    year: "2029",
    Europe: 124,
    "United States": 84,
    China: 117,
    kind: "Assumption",
  },
  {
    year: "2030",
    Europe: 132,
    "United States": 89,
    China: 122,
    kind: "Future demo figure",
  },
];

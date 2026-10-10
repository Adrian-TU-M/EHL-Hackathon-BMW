import { beforeEach, describe, expect, it } from "vitest";
import { createFixtures, defaultScope } from "../src/lib/mock-data";
import { scenarios, scoreRequirement } from "../src/lib/scoring";
import {
  advanceCouncil,
  buildCouncilEvents,
  initialCouncil,
  MAX_DURATION_MS,
} from "../src/lib/council/machine";
import { useAppStore } from "../src/store/useAppStore";
import { createReport } from "../src/lib/export/report";
const fixtures = createFixtures(defaultScope);
describe("Transparent prioritization", () => {
  it("does not convert unknown criteria into zero", () => {
    const r = {
      criteria: {
        need: 5,
        severity: null,
        gap: null,
        future: null,
        feasibility: null,
      },
    };
    expect(scoreRequirement(r, scenarios[0].weights)).toEqual({
      score: 100,
      coverage: 30,
    });
  });
  it("returns an unknown score for all-unknown inputs or all-zero weights", () => {
    expect(
      scoreRequirement(
        {
          criteria: {
            need: null,
            severity: null,
            gap: null,
            future: null,
            feasibility: null,
          },
        },
        scenarios[0].weights,
      ).score,
    ).toBeNull();
    expect(
      scoreRequirement(fixtures.requirements[0], {
        need: 0,
        severity: 0,
        gap: 0,
        future: 0,
        feasibility: 0,
      }),
    ).toEqual({ score: null, coverage: 0 });
  });
  it("uses a deterministic weighted mean", () => {
    expect(
      scoreRequirement(fixtures.requirements[0], scenarios[0].weights),
    ).toEqual({ score: 88, coverage: 100 });
  });
});
describe("Scope and source lineage", () => {
  it("removes charging requirements for combustion powertrains", () => {
    const data = createFixtures({
      ...defaultScope,
      vehicle: "F70",
      powertrain: "Combustion",
    });
    expect(data.requirements.some((r) => r.topic === "Charging")).toBe(false);
    expect(data.evidence.some((e) => e.category === "Charging")).toBe(false);
  });
  it("every requirement references existing evidence and findings in the same scope", () => {
    for (const r of fixtures.requirements) {
      for (const id of r.evidenceIds)
        expect(fixtures.evidence.find((e) => e.id === id)?.category).toBe(
          r.topic,
        );
      for (const id of r.findingIds)
        expect(fixtures.findings.find((f) => f.id === id)).toBeDefined();
    }
  });
});
describe("Bounded council", () => {
  it("keeps the prescribed sequence and completes without approving requirements", () => {
    let c = {
      ...initialCouncil,
      status: "running" as const,
      events: buildCouncilEvents(fixtures.requirements[0], 1),
    } as typeof initialCouncil;
    for (let i = 0; i < 50; i++) c = advanceCouncil(c);
    expect(c.status).toBe("complete");
    expect(c.events[c.cursor].stage).toBe("review");
    expect(c.events.filter((e) => e.stage === "challenge")).toHaveLength(2);
    expect(c.elapsedMs).toBeLessThan(MAX_DURATION_MS);
    expect(fixtures.requirements[0].status).toBe("Pending review");
  });
  it("does not advance while paused or interrupted", () => {
    for (const status of ["paused", "interrupted"] as const) {
      const state = { ...initialCouncil, status, cursor: 3 };
      expect(advanceCouncil(state)).toBe(state);
    }
  });
  it("pauses at the deterministic duration cap", () => {
    expect(
      advanceCouncil({
        ...initialCouncil,
        status: "running",
        elapsedMs: MAX_DURATION_MS - 1000,
        events: buildCouncilEvents(fixtures.requirements[0], 1),
      }).status,
    ).toBe("paused");
  });
});
describe("Human review and audit", () => {
  beforeEach(async () => {
    await useAppStore.getState().startAnalysis(defaultScope);
  });
  it("requires a rationale and rejects stale versions", async () => {
    await expect(
      useAppStore
        .getState()
        .decide({
          requirementId: "REQ-001",
          expectedVersion: 1,
          status: "Approved",
          rationale: "",
        }),
    ).rejects.toThrow("rationale");
    await expect(
      useAppStore
        .getState()
        .decide({
          requirementId: "REQ-001",
          expectedVersion: 9,
          status: "Approved",
          rationale: "Reviewed.",
        }),
    ).rejects.toThrow("changed");
  });
  it("invalidates approval on significant edit and records before/after", async () => {
    const store = useAppStore.getState();
    await store.decide({
      requirementId: "REQ-001",
      expectedVersion: 1,
      status: "Approved",
      rationale: "Demo approval after review.",
    });
    expect(useAppStore.getState().requirements[0].approvedVersion).toBe(1);
    await store.decide({
      requirementId: "REQ-001",
      expectedVersion: 1,
      status: "Approved",
      description: "An edited customer requirement.",
      rationale: "Clarified the outcome.",
    });
    const state = useAppStore.getState();
    expect(state.requirements[0].version).toBe(2);
    expect(state.requirements[0].status).toBe("Pending review");
    expect(state.requirements[0].approvedVersion).toBeUndefined();
    expect(state.audit.at(-1)?.before).toContain("Approved");
    expect(state.audit.at(-1)?.after).toContain("v2");
  });
  it("excluding evidence reopens linked requirements and preserves lineage", () => {
    const state = useAppStore.getState();
    state.excludeEvidence("DEMO-C11", "Not suitable for this decision.");
    const result = useAppStore.getState();
    expect(result.evidence[0].exclusionReason).toBeTruthy();
    expect(result.requirements[0].version).toBe(2);
    expect(result.requirements[0].evidenceIds).toContain("DEMO-C11");
    expect(result.audit.at(-1)?.category).toBe("Evidence");
  });
  it("creates an actual multi-page PDF with the current decision snapshot", async () => {
    const doc = createReport(useAppStore.getState());
    expect(doc.getNumberOfPages()).toBeGreaterThan(4);
    const output = doc.output();
    expect(output.startsWith("%PDF-")).toBe(true);
    expect(output).toContain("BMW NEXT");
    expect(output).toContain("SYNTHETIC DEMO");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultScope } from "../src/lib/mock-data";
import { useAppStore } from "../src/store/useAppStore";
import { judgeRequest, replayJudgeCouncil } from "../src/lib/api/judge";
import type { JudgeCouncil } from "../src/lib/api/judge";

function council(): JudgeCouncil {
  const state = useAppStore.getState();
  const request = judgeRequest(state);
  const unknownCriterion = () => ({ value: null, argument_ids: [] as string[], rationale: "Unknown" });
  return {
    id: "backend-1",
    analysis_id: state.scope.confirmedAt!,
    mode: "manual",
    status: "complete",
    stage: "review",
    revision: 1,
    round: 1,
    checkpoint: { stage: "review", reason: "PM review required" },
    execution: "demo",
    request,
    events: [],
    assessment: {
      id: "assessment-1",
      created_at: new Date().toISOString(),
      weights: state.weights,
      constraints: [],
      arguments: [],
      features: request.features.map((f) => ({
        feature_id: f.id,
        feature_version: f.version,
        recommendation: "defer",
        rationale: "Evidence has not been verified",
        evidence_strength: "Unknown",
        priority: null,
        coverage: 0,
        criteria: { need: unknownCriterion(), severity: unknownCriterion(), gap: unknownCriterion(), future: unknownCriterion(), feasibility: unknownCriterion() },
        benefits: [],
        drawbacks: [],
        risks: [],
        assumptions: [],
        uncertainties: ["Missing evidence"],
        alternatives: [],
        proposed_description: null,
        consequential_uncertainty: true,
      })),
      ranked_feature_ids: request.features.map((f) => f.id),
      next_action: "pause_for_pm",
      execution: "demo",
      input_digest: "fixture",
      clarification_requests: [],
      proposed_priorities: null,
    },
  };
}

describe("Python Judge frontend boundary", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await useAppStore.getState().startAnalysis(defaultScope);
  });
  it("sends only the Judge contract and preserves source provenance and exclusions", () => {
    useAppStore.getState().excludeEvidence("DEMO-C11", "Wrong scope");
    const request = judgeRequest(useAppStore.getState());
    expect(request.scope).not.toHaveProperty("confirmedAt");
    expect(request.evidence[0].provenance).toBe("synthetic");
    expect(request.evidence[0].exclusion_reason).toBe("Wrong scope");
    expect(request.features[0].version).toBe(2);
  });
  it("applies unknown scores without auto approval and records the assessment", () => {
    useAppStore.getState().applyJudgeCouncil(council());
    const state = useAppStore.getState();
    expect(state.requirements[0].criteria.need).toBeNull();
    expect(state.requirements[0].evidenceLevel).toBe("Unknown");
    expect(state.requirements[0].status).toBe("Pending review");
    expect(state.audit.at(-1)?.action).toBe("Judge assessment recorded");
  });
  it("rejects a decision made from an older Judge assessment before sending it", async () => {
    const view = council();
    useAppStore.getState().applyJudgeCouncil(view);
    await expect(useAppStore.getState().decide({ requirementId: view.request.features[0].id,
      expectedVersion: 1, expectedAssessmentId: "older-assessment", status: "Approved", rationale: "Reviewed" }))
      .rejects.toThrow("assessment changed");
  });
  it("rejects a stale feature snapshot and an earlier analysis", () => {
    const view = council();
    view.request.features[0].version = 99;
    expect(() => useAppStore.getState().applyJudgeCouncil(view)).toThrow(
      "Features changed",
    );
    view.analysis_id = "earlier-analysis";
    expect(() => useAppStore.getState().applyJudgeCouncil(view)).toThrow(
      "earlier analysis",
    );
  });
  it("does not duplicate audit events on replay or regress a newer revision", () => {
    const view = council();
    view.events = [
      {
        id: "1",
        sequence: 1,
        stage: "assessment",
        actor: "judge",
        statement: "Assess evidence",
        evidence_ids: [],
        timestamp: new Date().toISOString(),
      },
    ];
    useAppStore.getState().applyJudgeCouncil(view);
    const count = useAppStore.getState().audit.length;
    useAppStore.getState().applyJudgeCouncil(view);
    expect(useAppStore.getState().audit).toHaveLength(count);
    view.revision = 0;
    useAppStore.getState().applyJudgeCouncil(view);
    expect(useAppStore.getState().judgeCouncil?.revision).toBe(1);
  });
  it("invalidates approval on a fresh assessment and records confirmed backend decisions", () => {
    const view = council();
    useAppStore.getState().applyJudgeCouncil(view);
    useAppStore.setState((state) => ({
      requirements: state.requirements.map((r) => ({
        ...r,
        status: "Approved",
        approvedVersion: r.version,
      })),
    }));
    const updated = structuredClone(view);
    updated.assessment!.id = "assessment-2";
    updated.revision++;
    useAppStore.getState().applyJudgeCouncil(updated);
    expect(
      useAppStore.getState().requirements[0].approvedVersion,
    ).toBeUndefined();
    updated.decisions = [
      {
        feature_id: updated.request.features[0].id,
        version: 1,
        action: "approve",
        rationale: "Reviewed",
        assessment_id: "assessment-2",
        timestamp: new Date().toISOString(),
      },
    ];
    useAppStore.getState().applyJudgeCouncil(updated);
    expect(useAppStore.getState().requirements[0].status).toBe("Approved");
  });
  it("parses split SSE chunks incrementally and ignores replayed sequences", async () => {
    const encoder = new TextEncoder();
    const view = council();
    const event = {
      id: "1",
      sequence: 1,
      stage: "topic",
      actor: "moderator",
      statement: "Start",
      evidence_ids: [],
      timestamp: "2026-10-10",
    };
    const content = `event: council\ndata: ${JSON.stringify(event)}\n\nevent: council\ndata: ${JSON.stringify(event)}\n\nevent: snapshot\ndata: ${JSON.stringify(view)}\n\n`;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(content.slice(0, 35)));
        controller.enqueue(encoder.encode(content.slice(35)));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const onEvent = vi.fn(),
      onSnapshot = vi.fn();
    await replayJudgeCouncil("backend-1", 0, onEvent, onSnapshot);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith(view);
    vi.unstubAllGlobals();
  });
});

import { test, expect, type Page } from "@playwright/test";

const scope = {
  vehicle: "G60",
  market: "Europe",
  powertrain: "Electric",
  horizon: 4,
  prompt: "Improve this car overall",
};
const topics = ["Controls", "Charging", "Seats"].map((label) => ({
  id: `topic-${label.toLowerCase()}`,
  label,
  area: label,
  question: `How should BMW improve ${label.toLowerCase()}?`,
  eligible: true,
  evidence_ids: [],
  ratings: {},
  limitations: [],
}));
const criteria = Object.fromEntries(
  ["need", "severity", "gap", "future", "feasibility"].map((key) => [
    key,
    {
      value: key === "feasibility" ? null : 3,
      rationale: "Fixture source supports a bounded pilot.",
      argument_ids: [],
    },
  ]),
);
const assessment = {
  id: "judge-fixture",
  model: "qwen3:8b",
  arguments: [],
  features: [
    {
      feature_id: "controls",
      feature_version: 1,
      recommendation: "defer",
      rationale: "Validate the control layout before a production decision.",
      proposed_description: "Test a persistent control strip with drivers.",
      criteria,
      priority: 60,
      coverage: 90,
      evidence_strength: "Limited",
      benefits: ["Could make essential functions easier to find."],
      risks: ["Production feasibility has not been established."],
      drawbacks: [],
      uncertainties: ["A driver study is needed."],
      alternatives: ["Retain the present controls until the pilot concludes."],
    },
  ],
};
function fixture() {
  const events = ["customer", "market", "competitor", "judge"].map(
    (actor, index) => ({
      id: `turn-${index}`,
      session_id: "vehicle-fixture",
      run_id: "run-fixture",
      topic_id: topics[0].id,
      sequence: index + 1,
      timestamp: "2026-10-11T12:00:00Z",
      stage: actor === "judge" ? "assessment" : "perspectives",
      actor,
      statement: `${actor} published a source-grounded position about this car.`,
      evidence_ids: [],
      data: {},
      assumption_versions: {},
    }),
  );
  const outcome = {
    topic_id: topics[0].id,
    version: 1,
    assessment_valid: true,
    review_status: "Pending review",
    closure_reason: "unresolved_disagreement",
    decisions: [] as {
      status: string;
      rationale: string;
      version: number;
      at: string;
    }[],
    packet: { brief: { question: topics[0].question, scope } },
    assessment: { native_assessment: assessment, summary: "Saved verdict" },
  };
  const session = {
    id: "vehicle-fixture",
    run_id: "run-fixture",
    mode: "ollama",
    status: "running",
    agenda: {
      scope,
      topics,
      selected_ids: topics.map((t) => t.id),
      confirmed_at: "2026-10-11T12:00:00Z",
      source_snapshot: "fixture",
      warnings: [],
    },
    work: { stage: "challenges", brief: { topic_id: topics[1].id } },
    cursor: 1,
    sequence: 4,
    revision: 1,
    outcomes: [outcome],
    assumptions: [],
    active_seconds: 600,
  };
  return { session, events };
}

async function setup(page: Page, openSaved = true) {
  const data = fixture();
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  let messages: { id: string; actor: string; text: string }[] = [];
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/customer-api/"),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== "GET")
        requests.push({ path, body: request.postDataJSON() });
      if (path.endsWith("/events"))
        return route.fulfill({
          contentType: "text/event-stream",
          body: data.events
            .map((e) => `event: council\ndata: ${JSON.stringify(e)}\n\n`)
            .join(""),
        });
      if (path === "/api/moderator/health")
        return route.fulfill({
          json: { available: true, model: "qwen3:8b", limitations: [] },
        });
      if (path === "/api/moderator/sessions")
        return route.fulfill({ json: { sessions: [] } });
      if (path === "/api/moderator/vehicle-debates")
        return route.fulfill({ status: 201, json: data.session });
      if (path.endsWith("/export"))
        return route.fulfill({ json: { schema_version: 1, ...data } });
      if (path === "/api/moderator/sessions/vehicle-fixture")
        return route.fulfill({ json: data.session });
      if (path.endsWith("/discussion/conversation"))
        return route.fulfill({
          json: {
            assessment_id: assessment.id,
            agent_id: "agent-fixture",
            bridge: "saved_verdict_context",
            context: { assessment_id: assessment.id },
            messages: [],
          },
        });
      if (path.endsWith("/discussion")) {
        if (request.method() === "POST") {
          const body = request.postDataJSON();
          messages = [
            ...messages,
            { id: body.id, actor: "PM", text: body.content },
            {
              id: "reply-fixture",
              actor: "judge",
              text: "The feasibility is unknown. Validate the control layout with drivers before approval.",
            },
          ];
        }
        return route.fulfill({
          json: { assessment_id: assessment.id, messages },
        });
      }
      if (path.endsWith("/review")) {
        const body = request.postDataJSON();
        data.session.outcomes[0].review_status = body.status;
        data.session.outcomes[0].decisions.push({
          status: body.status,
          rationale: body.rationale,
          version: 1,
          at: "2026-10-11",
        });
        data.session.revision++;
        return route.fulfill({ json: data.session });
      }
      return route.fulfill({ status: 404, json: { detail: "Fixture only" } });
    },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start Product Analysis", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await page.goto(
    openSaved ? "/council?session=vehicle-fixture" : "/council?new=1",
  );
  return { requests, data };
}

test("PM starts the full vehicle agenda once, with no topic selection step", async ({
  page,
}) => {
  const { requests } = await setup(page, false);
  await expect(
    page.getByRole("heading", { name: "One car. Five perspectives." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start car debate" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Start car debate" }).click();
  await expect(page).toHaveURL(/session=vehicle-fixture/);
  const starts = requests.filter((r) => r.path.endsWith("vehicle-debates"));
  expect(starts).toHaveLength(1);
  expect(starts[0].body).not.toHaveProperty("selected_ids");
  await page.getByRole("tab", { name: "Full agenda" }).click();
  for (const t of topics)
    await expect(page.locator(".vc-agenda")).toContainText(t.label);
});

test("live table, chronological transcript, Jury conversation and real decision share one session", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { requests } = await setup(page);
  const transcript = page.getByRole("log", { name: "Council transcript" });
  await expect(transcript).toContainText("customer published");
  await expect(transcript).toContainText("competitor published");
  expect(requests).toHaveLength(0);
  const chamber = page.getByRole("region", { name: "Live council chamber" });
  expect((await chamber.boundingBox())!.height).toBeGreaterThan(430);
  expect((await chamber.boundingBox())!.y).toBeLessThan(
    (await transcript.boundingBox())!.y,
  );
  await page.screenshot({
    path: "test-results/vehicle-council-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: /Talk to Jury/ }).click();
  await expect(
    page.getByRole("button", { name: "Start voice discussion" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ask local Qwen directly in text" })
    .click();
  await page
    .getByLabel("Your question", { exact: true })
    .fill("What should we validate next?");
  await page.getByRole("button", { name: "Ask Jury", exact: true }).click();
  await expect(page.locator(".judge-message-list")).toContainText(
    "The feasibility is unknown",
  );
  const message = requests.find((r) => r.path.endsWith("/discussion"))!;
  expect(message.body.assessment_id).toBe(assessment.id);
  expect(requests.filter((r) => r.path.endsWith("/voice"))).toHaveLength(0);
  await page.screenshot({
    path: "test-results/jury-conversation-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("link", { name: "Review decisions", exact: true })
    .click();
  await expect(page).toHaveURL(/decisions\?session=vehicle-fixture/);
  await expect(page.locator(".decision-card")).toContainText(
    "Test a persistent control strip",
  );
  await expect(page.locator(".requirement-card")).toHaveCount(0);
  await page.getByLabel("Compare priorities").selectOption("Customer first");
  await expect(page.locator(".decision-card")).toContainText("Pending review");
  await page
    .getByRole("button", { name: "Review decision", exact: true })
    .click();
  await page.getByLabel("Decision", { exact: true }).selectOption("Deferred");
  await page
    .getByLabel("Rationale", { exact: true })
    .fill("Run the customer pilot before approval.");
  await page.getByRole("button", { name: "Save PM decision" }).click();
  await expect(page.locator(".decision-card")).toContainText("Deferred");
  expect(requests.filter((r) => r.path.endsWith("/review"))).toHaveLength(1);
  await page.reload();
  await expect(page.locator(".decision-card")).toContainText("Deferred");
  await page.screenshot({
    path: "test-results/live-decisions-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("council and Jury remain usable on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(
    page.getByRole("log", { name: "Council transcript" }),
  ).toContainText("market published");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: /Talk to Jury/ }).click();
  await expect(
    page.getByRole("button", { name: "Start voice discussion" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/jury-conversation-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

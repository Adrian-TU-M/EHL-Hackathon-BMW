import { test, expect, type Page } from "@playwright/test";

const sessionId = "layout-fixture-session";
const scope = {
  vehicle: "G60",
  market: "Europe",
  powertrain: "Electric",
  horizon: 3,
  prompt: "",
};
const topic = {
  id: "connected-services",
  label: "Connected services",
  area: "Connectivity",
  question: "Should BMW make software updates easier to understand?",
  evidence_ids: [],
  counterevidence_ids: [],
  ratings: {},
  lower_score: 20,
  upper_score: 80,
  coverage: 25,
  observation_count: 3,
  denominator: 10,
  exploratory: false,
  pinned: false,
  severe: false,
  eligible: true,
  rationale: "Test evidence only",
  limitations: [],
};
function fixture(status: "running" | "complete") {
  return {
    id: sessionId,
    run_id: "fixture-run",
    mode: "ollama",
    status,
    agenda: {
      id: "fixture-agenda",
      version: 1,
      source_snapshot: "fixture-snapshot",
      scope,
      topics: [topic],
      selected_ids: [topic.id],
      confirmed_at: "2026-10-11T12:00:00Z",
      warnings: [],
      policy_version: "test",
      semantic_refinement: "",
    },
    cursor: 0,
    sequence: 2,
    revision: 1,
    generation: 1,
    work:
      status === "running"
        ? {
            brief: {
              topic_id: topic.id,
              question: topic.question,
              scope,
              limitations: [],
            },
            stage: "challenges",
            claims: [],
            challenges: [],
            tokens: 300,
            active_seconds: 120,
            errors: [],
            blocked_preference: false,
          }
        : undefined,
    outcomes: [],
    assumptions: [],
    assumption_history: [],
    tokens: 300,
    active_seconds: 120,
    limits: {
      call_seconds: 300,
      topic_seconds: 1800,
      topic_tokens: 10000,
      session_tokens: 60000,
      reserve_fraction: 0.15,
    },
    availability: [],
  };
}
const events = [
  {
    id: "fixture-event-1",
    session_id: sessionId,
    run_id: "fixture-run",
    topic_id: topic.id,
    sequence: 1,
    timestamp: "2026-10-11T12:01:00Z",
    stage: "perspectives",
    actor: "customer",
    statement:
      "Customers need a clear explanation of what each update changes.",
    evidence_ids: [],
    assumption_versions: {},
    data: {},
  },
  {
    id: "fixture-event-2",
    session_id: sessionId,
    run_id: "fixture-run",
    topic_id: topic.id,
    sequence: 2,
    timestamp: "2026-10-11T12:02:00Z",
    stage: "challenge",
    actor: "competitor",
    statement:
      "What evidence shows that simpler updates would close a competitive gap?",
    evidence_ids: [],
    assumption_versions: {},
    data: {},
  },
];
async function setup(
  page: Page,
  status: "running" | "complete",
  listAvailable = true,
) {
  const mutations: string[] = [];
  const session = fixture(status);
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/customer-api/"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== "GET") mutations.push(url.pathname);
      if (url.pathname.endsWith("/events")) {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: events
            .map(
              (event) => `event: council\ndata: ${JSON.stringify(event)}\n\n`,
            )
            .join(""),
        });
      } else if (url.pathname.endsWith("/export")) {
        await route.fulfill({ json: { schema_version: 1, session, events } });
      } else if (url.pathname === `/api/moderator/sessions/${sessionId}`) {
        await route.fulfill({ json: session });
      } else if (url.pathname === "/api/moderator/sessions") {
        await route.fulfill(
          listAvailable
            ? {
                json: {
                  sessions: [
                    {
                      id: sessionId,
                      status,
                      scope,
                      topic_label: topic.label,
                      sequence: 2,
                      outcome_count: 0,
                      selected_count: 1,
                      stage: "challenges",
                      created_at: "2026-10-11",
                      updated_at: "2026-10-11",
                      mode: "ollama",
                      native_assessment_count: 0,
                      has_native_assessment: false,
                    },
                  ],
                },
              }
            : { status: 404, json: { detail: "Not found" } },
        );
      } else if (url.pathname === "/api/moderator/health") {
        await route.fulfill({
          json: {
            available: true,
            model: "qwen3:8b",
            mode: "ollama",
            limitations: [],
          },
        });
      } else {
        // Never forward a test request to the real backend or trigger local inference.
        await route.fulfill({
          status: 404,
          json: { detail: "No test fixture" },
        });
      }
    },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start Product Analysis", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm scope & begin" }).click();
  await page.goto("/council");
  return mutations;
}

test("saved debate opens actual arguments above the frozen agenda without starting inference", async ({
  page,
}) => {
  const mutations = await setup(page, "running");
  await page.getByRole("button", { name: /Open debate/ }).click();
  await expect(page).toHaveURL(new RegExp(`session=${sessionId}`));
  await expect(
    page.getByRole("heading", { name: "The council is in session." }),
  ).toBeVisible();
  const stream = page.getByRole("region", { name: "Published live debate" });
  await expect(stream).toContainText(events[0].statement);
  await expect(stream).toContainText(events[1].statement);
  await expect(stream).toContainText("several minutes");
  await expect(
    page.getByRole("button", { name: "Pause discussion", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".moderator-agenda-panel")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator(".moderator-judge-focus")).toContainText(
    "Evidence before a verdict.",
  );
  expect(mutations).toEqual([]);
  await page.screenshot({
    path: "test-results/council-live-focus.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(stream).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("older backend supports opening a saved link and never presents a missing Judge as success", async ({
  page,
}) => {
  const mutations = await setup(page, "complete", false);
  await page
    .getByText("Open a saved session by link or ID", { exact: true })
    .click();
  await page
    .getByLabel("Saved council link or session ID")
    .fill(`http://127.0.0.1:5173/council?session=${sessionId}`);
  await page.getByRole("button", { name: "Open session", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Discussion closed. Review needed." }),
  ).toBeVisible();
  await expect(page.locator(".moderator-judge-focus")).toContainText(
    "Assessment unavailable.",
  );
  await expect(
    page.getByRole("region", { name: "Published live debate" }),
  ).toContainText(events[1].statement);
  expect(mutations).toEqual([]);
});
